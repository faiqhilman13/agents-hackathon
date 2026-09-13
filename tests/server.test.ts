import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import type { Providers } from '../server/providers';
import { normalizeUrl, type Brief, type Capture, type Research, type ResearchInput, type Source } from '../shared/schema';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const capture: Capture = {
  url: 'https://example.com/research/article',
  title: 'A test article',
  text: [
    'This captured article contains enough readable text for a meaningful source digest.',
    'It describes evidence, limitations, and several concrete implications for a careful reader.',
    'The final sentence makes the fixture longer than the minimum research threshold.'
  ].join(' '),
  selection: '',
  authors: ['Ada Example'],
  description: 'This captured article contains enough readable text for a meaningful source digest.',
  capturedAt: '2026-09-13T00:00:00.000Z',
  coverage: 'page'
};

function input(overrides: Partial<ResearchInput> = {}): ResearchInput {
  return { requestId: randomUUID(), capture, question: '', collection: 'Reading list', enrich: false, ...overrides };
}

function fakeProviders(overrides: Partial<Providers> = {}): Providers {
  const result: Brief = {
    title: capture.title,
    overview: {text:'The original describes a careful result.',sourceIds:['S0']},
    takeaways: [{text:'The result remains bounded by the supplied source.',sourceIds:['S0']}],
    connections: [], questions: [], tags: []
  };
  return {
    resolve: async value => value,
    plan: async () => ['careful external evidence'],
    search: async () => [],
    synthesize: async () => result,
    ...overrides
  };
}

async function eventually<T>(read: () => T, accept: (value: T) => boolean, timeout = 2500): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the expected state.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(providers: Providers = fakeProviders()) {
  const dir = mkdtempSync(join(tmpdir(), 'margin-test-'));
  const built = createApp(dir, { providers, recover: false });
  const server = await new Promise<Server>(resolve => {
    const listening = built.app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ...built,
    base,
    async request(path: string, init: RequestInit = {}) {
      return fetch(base + path, {
        ...init,
        headers: {Authorization:`Bearer ${built.config.token}`, ...init.headers}
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      built.store.close();
      rmSync(dir, {recursive:true, force:true});
    }
  };
}

test('research continues after the submitting HTTP response has closed', async () => {
  const gate = deferred<Capture>();
  const run = await fixture(fakeProviders({resolve: async () => gate.promise}));
  try {
    const response = await run.request('/api/research', {
      method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(input())
    });
    assert.equal(response.status, 202);
    const accepted = await response.json() as Research;
    assert.equal(accepted.status, 'queued');
    await eventually(() => run.store.get(accepted.id), item => item?.status === 'running');

    gate.resolve(capture);
    const completed = await eventually(() => run.store.get(accepted.id), item => item?.status === 'complete');
    assert.equal(completed?.stage, 'Research ready to discuss');
    assert.equal(completed?.progress, 100);
  } finally {
    gate.resolve(capture);
    await run.close();
  }
});

test('a persisted queued job resumes when the local server restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'margin-recovery-test-'));
  try {
    const beforeRestart = new Store(dir);
    const interrupted = beforeRestart.create(input()).item;
    beforeRestart.update(interrupted.id, {status:'running', stage:'Writing the research brief'});
    const waiting = beforeRestart.create(input()).item;
    beforeRestart.close();

    const restarted = createApp(dir, {providers:fakeProviders(), recover:true});
    try {
      const completed = await eventually(() => restarted.store.get(waiting.id), item => item?.status === 'complete');
      assert.equal(completed?.stage, 'Research ready to discuss');
      const failed = restarted.store.get(interrupted.id);
      assert.equal(failed?.status, 'failed');
      assert.equal(failed?.stage, 'Interrupted');
      assert.match(failed?.error || '', /server stopped.*retry/i);
    } finally {
      restarted.store.close();
    }
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});

test('repeated request IDs are idempotent', async () => {
  const gate = deferred<Capture>();
  const run = await fixture(fakeProviders({resolve: async () => gate.promise}));
  try {
    const body = JSON.stringify(input());
    const first = await run.request('/api/research', {method:'POST',headers:{'Content-Type':'application/json'},body});
    const firstItem = await first.json() as Research;
    const second = await run.request('/api/research', {method:'POST',headers:{'Content-Type':'application/json'},body});
    const secondItem = await second.json() as Research;

    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal(secondItem.id, firstItem.id);
    assert.equal(run.store.list().length, 1);
  } finally {
    gate.resolve(capture);
    await eventually(() => run.store.list()[0], item => item?.status === 'complete');
    await run.close();
  }
});

test('a failed synthesis is saved and clearly labelled as extractive', async () => {
  const run = await fixture(fakeProviders({synthesize: async () => { throw new Error('provider offline'); }}));
  try {
    run.config.save({llmKey:'test-key'});
    const response = await run.request('/api/research', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input())
    });
    const accepted = await response.json() as Research;
    const completed = await eventually(() => run.store.get(accepted.id), item => item?.status === 'complete');

    assert.equal(completed?.mode, 'extractive');
    assert.ok(completed?.brief);
    assert.ok(completed?.warnings.some(warning => /Synthesis was unavailable.*provider offline/.test(warning)));
  } finally {
    await run.close();
  }
});

test('an explicit saved-research question uses only deduplicated local library originals', async () => {
  let planCalls = 0;
  let searchCalls = 0;
  let synthesisSources: Source[] = [];
  const providers = fakeProviders({
    plan: async () => { planCalls++; return ['should not run']; },
    search: async () => { searchCalls++; return []; },
    synthesize: async (_current, _question, sources) => {
      synthesisSources = sources;
      return {
        title: 'Connected to saved research',
        overview: {text:'The current article asks a question about saved research.',sourceIds:['S0']},
        takeaways: [],
        connections: sources.slice(1).map(source => ({
          title: `Connection to ${source.title}`,
          relationship: 'context' as const,
          text: 'This saved source provides relevant local context.',
          sourceIds: ['S0', source.id]
        })),
        questions: [],
        tags: []
      };
    }
  });
  const run = await fixture(providers);
  try {
    run.config.save({exaKey:'test-exa-key', llmKey:'test-llm-key'});
    const saveBrief = (title:string, url:string) => {
      const savedCapture:Capture = {...capture,title,url,text:`${title} contains locally saved evidence that can be compared with another research article.`};
      const item = run.store.create(input({capture:savedCapture})).item;
      return run.store.update(item.id, {
        status:'complete', mode:'synthesis', stage:'Saved to your library', progress:100,
        inLibrary:true,
        sources:[{id:'S0',title,url,text:savedCapture.text,kind:'original'}],
        brief:{title,overview:{text:`A saved overview for ${title}.`,sourceIds:['S0']},takeaways:[],connections:[],questions:[],tags:['local']}
      });
    };

    const saved = [
      saveBrief('Saved alpha', 'https://saved.example/alpha'),
      saveBrief('Saved beta', 'https://saved.example/beta'),
      saveBrief('Saved alpha duplicate', 'https://saved.example/alpha?utm_source=duplicate'),
      saveBrief('Saved gamma', 'https://saved.example/gamma'),
      saveBrief('Saved delta beyond the cap', 'https://saved.example/delta')
    ];
    const legacy = {...saved[4]} as Partial<Research>;
    delete legacy.inLibrary;
    run.store.db.prepare('UPDATE research SET data=? WHERE id=?').run(JSON.stringify(legacy), saved[4].id);
    const unsaved = saveBrief('Unsaved draft', 'https://saved.example/draft');
    run.store.update(unsaved.id, {inLibrary:false});
    const demoResponse = await run.request('/api/demo', {method:'POST'});
    assert.equal(demoResponse.status, 200);
    const demo = await demoResponse.json() as Research;

    const currentCapture:Capture = {...capture,title:'Current question',url:'https://current.example/article'};
    const response = await run.request('/api/research', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(input({capture:currentCapture,question:'How does this connect to my saved research?',enrich:true}))
    });
    assert.equal(response.status, 202);
    const current = await response.json() as Research;
    await eventually(() => run.store.get(current.id), item => item?.status === 'complete');

    assert.equal(planCalls, 0);
    assert.equal(searchCalls, 0);
    assert.equal(synthesisSources[0]?.id, 'S0');
    assert.equal(synthesisSources[0]?.url, currentCapture.url);
    const related = synthesisSources.slice(1);
    assert.equal(related.length, 3);
    assert.ok(related.every(source => source.kind === 'related' && source.reason?.startsWith('Saved brief: ')));
    assert.equal(new Set(related.map(source => normalizeUrl(source.url))).size, related.length);
    assert.ok(related.every(source => source.url !== demo.input.capture.url));
    assert.ok(related.every(source => source.url !== currentCapture.url));
    assert.ok(related.every(source => source.url !== unsaved.input.capture.url));
    assert.ok(related.some(source => normalizeUrl(source.url) === normalizeUrl(saved[4].input.capture.url)));
    assert.ok(related.every(source => saved.some(entry => normalizeUrl(entry.input.capture.url) === normalizeUrl(source.url))));
  } finally {
    await run.close();
  }
});

test('a completed draft enters the library only through the explicit save action', async () => {
  const run = await fixture();
  try {
    const response = await run.request('/api/research', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input())
    });
    const accepted = await response.json() as Research;
    const completed = await eventually(() => run.store.get(accepted.id), item => item?.status === 'complete');
    assert.equal(completed?.inLibrary, false);

    const savedResponse = await run.request(`/api/research/${accepted.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({inLibrary:true})
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json() as Research;
    assert.equal(saved.inLibrary, true);

    const removal = await run.request(`/api/research/${accepted.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({inLibrary:false})
    });
    assert.equal(removal.status, 400);
    assert.equal(run.store.get(accepted.id)?.inLibrary, true);
  } finally {
    await run.close();
  }
});

test('the assistant saves a brief only after an explicit save_brief action', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let completionCalls = 0;
  const run = await fixture();
  globalThis.fetch = (async (request, init) => {
    if (String(request).startsWith(run.base)) return originalFetch(request, init);
    completionCalls++;
    assert.equal(String(request), 'https://mock.provider.test/v1/chat/completions');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({action:'save_brief'})}}]}), {
      status:200, headers:{'Content-Type':'application/json'}
    });
  }) as typeof fetch;
  try {
    run.config.save({llmKey:'test-only-key',llmBaseUrl:'https://mock.provider.test/v1'});
    const response = await run.request('/api/research', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input())
    });
    const accepted = await response.json() as Research;
    await eventually(() => run.store.get(accepted.id), item => item?.status === 'complete');
    assert.equal(run.store.get(accepted.id)?.inLibrary, false);

    const chatResponse = await run.request(`/api/research/${accepted.id}/chat`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:'Save this brief to my library.'})
    });
    assert.equal(chatResponse.status, 200);
    const saved = await chatResponse.json() as Research;
    assert.equal(saved.inLibrary, true);
    assert.equal(saved.messages?.at(-1)?.role, 'assistant');
    assert.match(saved.messages?.at(-1)?.text || '', /Saved this research brief to your library/);
    assert.equal(completionCalls, 1);
  } finally {
    await run.close();
  }
});

test('cancelling active research cannot be overwritten by a late provider result', async () => {
  const gate = deferred<Capture>();
  const run = await fixture(fakeProviders({resolve: async () => gate.promise}));
  try {
    const response = await run.request('/api/research', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input())
    });
    const accepted = await response.json() as Research;
    await eventually(() => run.store.get(accepted.id), item => item?.status === 'running');

    const cancelled = await run.request(`/api/research/${accepted.id}/cancel`, {method:'POST'});
    assert.equal(cancelled.status, 200);
    gate.resolve(capture);
    await new Promise(resolve => setTimeout(resolve, 50));

    const final = run.store.get(accepted.id);
    assert.equal(final?.status, 'cancelled');
    assert.equal(final?.stage, 'Cancelled');
    assert.notEqual(final?.progress, 100);
  } finally {
    gate.resolve(capture);
    await run.close();
  }
});

test('notes and favorite state survive a database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'margin-store-test-'));
  try {
    const first = new Store(dir);
    const {item} = first.create(input({collection:'Methods'}));
    assert.equal(item.inLibrary, false);
    first.update(item.id, {notes:'Compare the sample sizes.', favorite:true, inLibrary:true});
    first.close();

    const reopened = new Store(dir);
    try {
      const saved = reopened.get(item.id);
      assert.equal(saved?.notes, 'Compare the sample sizes.');
      assert.equal(saved?.favorite, true);
      assert.equal(saved?.collection, 'Methods');
      assert.equal(saved?.inLibrary, true);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});

test('pairing is local-only and protected routes require the paired token', async () => {
  const run = await fixture();
  try {
    const noPage = await fetch(run.base + '/api/connection');
    assert.equal(noPage.status, 403);

    const foreign = await fetch(run.base + '/api/status', {headers:{Origin:'https://attacker.example'}});
    assert.equal(foreign.status, 403);

    const paired = await fetch(run.base + '/api/connection', {headers:{Referer:'http://localhost:4317/'}});
    assert.equal(paired.status, 200);
    assert.equal((await paired.json() as {token:string}).token, run.config.token);

    const unauthorized = await fetch(run.base + '/api/settings');
    assert.equal(unauthorized.status, 401);

    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    const authorized = await run.request('/api/settings', {headers:{Origin:extensionOrigin}});
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get('access-control-allow-origin'), extensionOrigin);

    const malformedExtension = await run.request('/api/settings', {headers:{Origin:'chrome-extension://not-an-extension-id'}});
    assert.equal(malformedExtension.status, 403);
  } finally {
    await run.close();
  }
});
