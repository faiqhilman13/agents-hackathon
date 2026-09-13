import assert from 'node:assert/strict';
import test from 'node:test';
import { arxivId, normalizeUrl, publicUrl, type Brief, type Capture, type Research } from '../shared/schema';
import { chat } from '../server/chat';
import { extractiveBrief, providers, uniqueSources, validateCitations } from '../server/providers';

const original: Capture = {
  url: 'https://arxiv.org/abs/2401.01234v2',
  title: 'Original paper',
  text: 'Original source text with enough content to represent the captured paper.',
  selection: '',
  authors: ['Ada Example'],
  description: '',
  capturedAt: '2026-09-13T00:00:00.000Z',
  coverage: 'abstract',
  arxivId: '2401.01234v2'
};

test('accepts only public HTTP(S) URLs', () => {
  for (const value of [
    'http://localhost:4317/private',
    'http://127.0.0.1/private',
    'http://10.0.0.8/private',
    'http://172.16.2.1/private',
    'http://192.168.1.2/private',
    'http://169.254.1.1/private',
    'http://[::1]/private',
    'https://user:password@example.com/article',
    'file:///etc/passwd',
    'javascript:alert(1)'
  ]) assert.equal(publicUrl(value), false, value);

  assert.equal(publicUrl('https://example.com/article'), true);
  assert.equal(publicUrl('http://news.example.org:8080/story'), true);
});

test('canonicalizes tracking links and arXiv variants', () => {
  assert.equal(
    normalizeUrl('https://Example.com/path/?utm_source=mail&id=7&fbclid=tracking#section'),
    'https://example.com/path/?id=7'
  );
  assert.equal(normalizeUrl('https://export.arxiv.org/pdf/2401.01234v2.pdf'), 'https://arxiv.org/abs/2401.01234v2');
  assert.equal(arxivId('https://arxiv.org/html/2401.01234v3'), '2401.01234v3');
  assert.equal(arxivId('https://example.com/abs/2401.01234'), undefined);
});

test('deduplicates equivalent source URLs and assigns stable citation IDs', () => {
  const sources = uniqueSources(original, [
    { title: 'Same paper PDF', url: 'https://arxiv.org/pdf/2401.01234.pdf', text: 'duplicate', kind: 'related' },
    { title: 'Tracked result', url: 'https://example.com/study?utm_campaign=one', text: 'first', kind: 'related' },
    { title: 'Same tracked result', url: 'https://example.com/study?utm_campaign=two#results', text: 'duplicate', kind: 'related' },
    { title: 'Independent result', url: 'https://example.net/context', text: 'second', kind: 'related' }
  ]);

  assert.deepEqual(sources.map(source => [source.id, source.title]), [
    ['S0', 'Original paper'],
    ['S1', 'Tracked result'],
    ['S2', 'Independent result']
  ]);
  assert.equal(sources[0].kind, 'original');
});

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    title: 'Research brief',
    overview: { text: 'What the original says.', sourceIds: ['S0'] },
    takeaways: [{ text: 'A finding from the original.', sourceIds: ['S0'] }],
    connections: [{
      title: 'External context',
      relationship: 'context',
      text: 'A comparison supported by both documents.',
      sourceIds: ['S0', 'S1']
    }],
    questions: [],
    tags: [],
    ...overrides
  };
}

const citationSources = uniqueSources(original, [
  { title: 'Related study', url: 'https://example.net/related', text: 'Related evidence.', kind: 'related' }
]);

test('validates the original-versus-external citation boundary', () => {
  assert.equal(validateCitations(brief(), citationSources).title, 'Research brief');

  assert.throws(
    () => validateCitations(brief({overview:{text:'Mixed overview.',sourceIds:['S0','S1']}}), citationSources),
    /Original-source findings mixed in outside sources/
  );
  assert.throws(
    () => validateCitations(brief({connections:[{title:'Unsupported',relationship:'context',text:'One-sided.',sourceIds:['S1']}]}), citationSources),
    /both sources/
  );
  assert.throws(
    () => validateCitations(brief({takeaways:[{text:'Invented.',sourceIds:['S9']}]}), citationSources),
    /unknown citation/
  );
});

test('an extractive selection digest never leaks conflicting page-description text', () => {
  const selection = {
    ...original,
    url: 'https://example.com/long-article',
    coverage: 'selection' as const,
    selection: 'The selected passage says the observed effect was small and uncertain.',
    text: 'The selected passage says the observed effect was small and uncertain. Follow-up measurements did not resolve that uncertainty.',
    description: 'The full page claims the effect was large, definitive, and ready for immediate adoption.'
  };

  const digest = extractiveBrief(selection);
  const presented = [digest.overview.text, ...digest.takeaways.map(item => item.text)].join(' ');
  assert.match(presented, /small and uncertain/);
  assert.doesNotMatch(presented, /large, definitive|immediate adoption/);
  assert.ok([digest.overview, ...digest.takeaways].every(item => item.sourceIds.length === 1 && item.sourceIds[0] === 'S0'));
});

test('synthesis drops impossible connections without weakening original-source citation checks', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const modelReply = {
    title: 'Model tried to rename the source',
    overview: {text:'A useful overview grounded in the supplied original.',sourceIds:['S0']},
    takeaways: [{text:'A useful takeaway grounded in the supplied original.',sourceIds:['S0']}],
    connections: [{title:'Spurious connection',relationship:'context',text:'There is no external source for this.',sourceIds:['S0']}],
    questions: ['What should be tested next?'],
    tags: ['evidence']
  };
  let calls = 0;
  globalThis.fetch = (async (request) => {
    calls++;
    assert.equal(String(request), 'https://mock.provider.test/v1/chat/completions');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(modelReply)}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;

  const settings = {exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://mock.provider.test/v1',model:'mock-model'};
  const sources = uniqueSources(original, []);
  const result = await providers.synthesize(original, '', sources, settings, new AbortController().signal);
  assert.equal(result.title, original.title);
  assert.equal(result.overview.text, 'A useful overview grounded in the supplied original.');
  assert.deepEqual(result.takeaways, [{text:'A useful takeaway grounded in the supplied original.',sourceIds:['S0']}]);
  assert.deepEqual(result.connections, []);
  assert.equal(calls, 1);
});

test('synthesis repairs one invalid citation draft with the original evidence attached', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const related = {id:'S1',title:'Related evidence',url:'https://example.net/related',text:'A separate related source.',kind:'related' as const};
  const sources = [...uniqueSources(original, []), related];
  const invalidDraft = {
    title: 'First draft',
    overview: {text:'This overview improperly mixes the two sources.',sourceIds:['S0','S1']},
    takeaways: [{text:'A valid original takeaway.',sourceIds:['S0']}],
    connections: [], questions: [], tags: []
  };
  const repairedDraft = {
    title: 'Repaired draft',
    overview: {text:'This overview is grounded only in the original.',sourceIds:['S0']},
    takeaways: [{text:'This takeaway is also grounded in the original.',sourceIds:['S0']}],
    connections: [], questions: [], tags: []
  };
  const replies = [invalidDraft, repairedDraft];
  const requests: {messages:{content:string}[];reasoning?:{enabled:boolean}}[] = [];
  globalThis.fetch = (async (request, init) => {
    assert.equal(String(request), 'https://openrouter.ai/api/v1/chat/completions');
    requests.push(JSON.parse(String(init?.body)));
    const content = replies.shift();
    if (!content) throw new Error('Unexpected extra provider call.');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;

  const settings = {exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-v4-flash-0731'};
  const result = await providers.synthesize(original, 'Compare the evidence.', sources, settings, new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.reasoning?.enabled === false));
  assert.equal(result.title, original.title);
  assert.equal(result.overview.text, repairedDraft.overview.text);
  const repairPayload = JSON.parse(requests[1].messages[1].content) as {
    invalidDraft:unknown; validationError:string; sources:{id:string;text:string;title:string}[]
  };
  assert.deepEqual(repairPayload.invalidDraft, invalidDraft);
  assert.match(repairPayload.validationError, /Original-source findings mixed in outside sources/);
  assert.equal(repairPayload.sources[0].id, 'S0');
  assert.equal(repairPayload.sources[0].title, original.title);
  assert.equal(repairPayload.sources[0].text, original.text);
});

test('reasoning is omitted outside the exact OpenRouter DeepSeek model combination', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requestBodies: Record<string,unknown>[] = [];
  const validDraft = {
    title:original.title,
    overview:{text:'A valid original-only overview.',sourceIds:['S0']},
    takeaways:[{text:'A valid original-only takeaway.',sourceIds:['S0']}],
    connections:[],questions:[],tags:[]
  };
  globalThis.fetch = (async (_request, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(validDraft)}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;
  const sources = uniqueSources(original, []);

  await providers.synthesize(original, '', sources, {
    exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://openrouter.ai/api/v1',model:'another/model'
  }, new AbortController().signal);
  await providers.synthesize(original, '', sources, {
    exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://compatible.example/v1',model:'deepseek/deepseek-v4-flash-0731'
  }, new AbortController().signal);

  assert.equal(requestBodies.length, 2);
  assert.ok(requestBodies.every(body => !Object.hasOwn(body, 'reasoning')));
});

test('OpenRouter DeepSeek chat disables reasoning for both planning and answering', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requestBodies: {reasoning?:{enabled:boolean}}[] = [];
  const replies = [
    {action:'answer'},
    {text:'The answer is grounded in the original source.',sourceIds:['S0']}
  ];
  globalThis.fetch = (async (request, init) => {
    assert.equal(String(request), 'https://openrouter.ai/api/v1/chat/completions');
    requestBodies.push(JSON.parse(String(init?.body)));
    const content = replies.shift();
    if (!content) throw new Error('Unexpected extra chat completion.');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;
  const sources = uniqueSources(original, []);
  const item:Research = {
    id:'current',requestId:'00000000-0000-4000-8000-000000000001',status:'complete',
    stage:'Research ready to discuss',progress:100,createdAt:'2026-09-13T00:00:00.000Z',updatedAt:'2026-09-13T00:00:00.000Z',
    input:{requestId:'00000000-0000-4000-8000-000000000001',capture:original,question:'',collection:'Reading list',enrich:false},
    sources,brief:{title:original.title,overview:{text:'Original overview.',sourceIds:['S0']},takeaways:[],connections:[],questions:[],tags:[]},
    mode:'synthesis',warnings:[],notes:'',favorite:false,collection:'Reading list',inLibrary:false
  };
  const result = await chat(item, 'Explain the original.', {
    exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-v4-flash-0731'
  }, new AbortController().signal);

  assert.equal(result.text, 'The answer is grounded in the original source.');
  assert.equal(requestBodies.length, 2);
  assert.ok(requestBodies.every(body => body.reasoning?.enabled === false));
});

test('synthesis stops after one unsuccessful repair attempt', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const related = {id:'S1',title:'Related evidence',url:'https://example.net/related',text:'A separate related source.',kind:'related' as const};
  const sources = [...uniqueSources(original, []), related];
  const replies = [
    {
      title:'Invalid first draft',overview:{text:'Mixed overview.',sourceIds:['S0','S1']},
      takeaways:[{text:'Valid takeaway.',sourceIds:['S0']}],connections:[],questions:[],tags:[]
    },
    {
      title:'Invalid repair',overview:{text:'Valid overview.',sourceIds:['S0']},
      takeaways:[{text:'Still mixed.',sourceIds:['S0','S1']}],connections:[],questions:[],tags:[]
    }
  ];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    const content = replies.shift();
    if (!content) throw new Error('A third completion must never be attempted.');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;

  const settings = {exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://mock.provider.test/v1',model:'mock-model'};
  await assert.rejects(
    providers.synthesize(original, '', sources, settings, new AbortController().signal),
    /Original-source findings mixed in outside sources/
  );
  assert.equal(calls, 2);
});

test('a provider HTTP failure is not retried as a structured-output repair', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('temporarily unavailable', {status:503});
  }) as typeof fetch;
  const settings = {exaKey:'',llmKey:'test-only-key',llmBaseUrl:'https://mock.provider.test/v1',model:'mock-model'};

  await assert.rejects(
    providers.synthesize(original, '', uniqueSources(original, []), settings, new AbortController().signal),
    /Language model returned 503/
  );
  assert.equal(calls, 1);
});
