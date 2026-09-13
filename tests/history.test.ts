import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { recentReads, type RecentRead } from '../server/library';
import { providers, type Providers } from '../server/providers';
import type { Brief, Capture, Research, ResearchInput, Source } from '../shared/schema';

// Reading memory (ported from Cortex Layer 2): recent reads steer synthesis, and related
// sources that strongly overlap a recent read are flagged with fromHistory/readContext.
// Every test uses a temporary store and fake or intercepted providers.

const capture: Capture = {
  url: 'https://example.com/research/article',
  title: 'How to be ambitious',
  text: 'This captured article discusses ambition, bounded rationality, and how people choose problems slightly beyond their reach. '.repeat(3),
  selection: '',
  authors: [],
  description: '',
  capturedAt: '2026-09-13T00:00:00.000Z',
  coverage: 'page'
};

function input(overrides: Partial<ResearchInput> = {}): ResearchInput {
  return { requestId: randomUUID(), capture, question: '', collection: 'Reading list', enrich: true, ...overrides };
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

function related(title: string, url: string, text: string): Omit<Source, 'id'> {
  return { title, url, text, kind: 'related' };
}

function briefCiting(ids: string[]): Brief {
  return {
    title: capture.title,
    overview: { text: 'The original describes how ambition works.', sourceIds: ['S0'] },
    takeaways: [{ text: 'Ambition behaves like a habit of choosing problems.', sourceIds: ['S0'] }],
    connections: ids.map(id => ({ title: `Connection ${id}`, relationship: 'context' as const, text: 'Adds useful context.', sourceIds: ['S0', id] })),
    questions: [],
    tags: []
  };
}

function withApp(providerSet: Providers) {
  const dir = mkdtempSync(join(tmpdir(), 'margin-history-test-'));
  const built = createApp(dir, { providers: providerSet, recover: false });
  return {
    ...built,
    close() {
      built.store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seedRead(run: ReturnType<typeof withApp>, title: string, url: string, mode: Research['mode'] = 'synthesis') {
  const { item } = run.store.create(input({ capture: { ...capture, title, url } }));
  return run.store.update(item.id, { status: 'complete', mode, stage: 'Research ready to discuss', progress: 100 });
}

async function runJob(run: ReturnType<typeof withApp>) {
  const { item } = run.store.create(input());
  run.queue.kick();
  const done = await eventually(() => run.store.get(item.id), value => value?.status === 'complete' || value?.status === 'failed');
  assert.equal(done?.status, 'complete', done?.error);
  return done!;
}

test('recentReads lists distinct recent pages newest first, excluding the current page and demos', () => {
  const entry = (id: string, url: string, title: string, mode: Research['mode'] = 'synthesis') =>
    ({ id, mode, createdAt: '2026-09-13T00:00:00.000Z', input: { capture: { url, title } } }) as unknown as Research;
  const library = [
    entry('current', 'https://example.com/research/article', 'Current page'),
    entry('same-page', 'https://example.com/research/article/?utm_source=newsletter', 'Same page again'),
    entry('demo', 'https://demo.example/page', 'Demo', 'demo'),
    entry('newest', 'https://a.example/1', 'Newest read'),
    entry('duplicate', 'https://a.example/1#section', 'Duplicate of newest'),
    ...Array.from({ length: 25 }, (_, i) => entry(`older-${i}`, `https://b.example/${i}`, `Read ${i}`))
  ];

  const reads = recentReads(library, 'current', 'https://example.com/research/article');

  assert.equal(reads.length, 20);
  assert.deepEqual(reads.slice(0, 3).map(read => read.title), ['Newest read', 'Read 0', 'Read 1']);
  assert.equal(reads[0].url, 'https://a.example/1');
  assert.ok(!reads.some(read => /Current page|Same page again|Demo|Duplicate/.test(read.title)));
});

test('research passes recent reads to synthesis and flags related sources that overlap them', async () => {
  let synthesisReads: RecentRead[] | undefined;
  const overlapCalls: string[] = [];
  const run = withApp({
    resolve: async value => value,
    plan: async () => ['bounded rationality ambition gardening'],
    search: async () => [
      related('Bounded rationality revisited', 'https://papers.example/bounded', 'A review of bounded rationality and ambition in decision making.'),
      related('Gardening for ambitious beginners', 'https://garden.example/tips', 'Practical gardening advice with a note on ambition.'),
      related('Herbert Simon on bounded rationality', 'https://example.org/simon', 'Simon introduced bounded rationality to describe ambition under limits.')
    ],
    synthesize: async (_capture, _question, sources, _settings, _signal, reads) => {
      synthesisReads = reads;
      return briefCiting(sources.slice(1).map(source => source.id));
    },
    historyOverlap: async (source, reads) => {
      overlapCalls.push(source.title);
      return source.title.startsWith('Bounded') ? reads.findIndex(read => read.title.startsWith('Herbert Simon')) : null;
    }
  });
  try {
    run.config.save({ exaKey: 'test-exa-key', llmKey: 'test-llm-key' });
    seedRead(run, 'Herbert Simon on bounded rationality', 'https://example.org/simon');
    seedRead(run, 'Aggregation theory explained', 'https://example.net/aggregation');
    seedRead(run, 'An illustrative example', 'https://demo.example/page', 'demo');

    const done = await runJob(run);

    assert.deepEqual(synthesisReads?.map(read => read.title), ['Aggregation theory explained', 'Herbert Simon on bounded rationality']);
    const byTitle = new Map(done.sources.map(source => [source.title, source]));
    assert.equal(done.sources.find(source => source.id === 'S0')?.fromHistory, undefined);
    assert.equal(byTitle.get('Bounded rationality revisited')?.fromHistory, true);
    assert.equal(byTitle.get('Bounded rationality revisited')?.readContext, 'You read Herbert Simon on bounded rationality recently.');
    assert.equal(byTitle.get('Gardening for ambitious beginners')?.fromHistory, false);
    assert.equal(byTitle.get('Gardening for ambitious beginners')?.readContext, undefined);
    // An exact page match is flagged without asking the model.
    assert.equal(byTitle.get('Herbert Simon on bounded rationality')?.fromHistory, true);
    assert.equal(byTitle.get('Herbert Simon on bounded rationality')?.readContext, 'You read Herbert Simon on bounded rationality recently.');
    assert.deepEqual([...overlapCalls].sort(), ['Bounded rationality revisited', 'Gardening for ambitious beginners']);
    // Reading memory never promotes a draft into the library.
    assert.equal(done.inLibrary, false);
  } finally {
    run.close();
  }
});

test('a failed overlap check never fails research and leaves the source unflagged', async () => {
  const run = withApp({
    resolve: async value => value,
    plan: async () => ['bounded rationality'],
    search: async () => [related('Bounded rationality revisited', 'https://papers.example/bounded', 'Bounded rationality in practice.')],
    synthesize: async (_capture, _question, sources) => briefCiting(sources.slice(1).map(source => source.id)),
    historyOverlap: async () => { throw new Error('provider offline'); }
  });
  try {
    run.config.save({ exaKey: 'test-exa-key', llmKey: 'test-llm-key' });
    seedRead(run, 'Herbert Simon on bounded rationality', 'https://example.org/simon');

    const done = await runJob(run);

    const source = done.sources.find(item => item.id === 'S1');
    assert.equal(source?.fromHistory, false);
    assert.equal(source?.readContext, undefined);
  } finally {
    run.close();
  }
});

test('without recent reads, or without a language model, no overlap check runs', async () => {
  let overlapCalls = 0;
  let synthesisReads: RecentRead[] | undefined;
  const providerSet: Providers = {
    resolve: async value => value,
    plan: async () => ['bounded rationality'],
    search: async () => [related('Bounded rationality revisited', 'https://papers.example/bounded', 'Bounded rationality in practice.')],
    synthesize: async (_capture, _question, sources, _settings, _signal, reads) => {
      synthesisReads = reads;
      return briefCiting(sources.slice(1).map(source => source.id));
    },
    historyOverlap: async () => { overlapCalls++; return 0; }
  };

  const empty = withApp(providerSet);
  try {
    empty.config.save({ exaKey: 'test-exa-key', llmKey: 'test-llm-key' });
    const done = await runJob(empty);
    assert.deepEqual(synthesisReads, []);
    assert.ok(!('fromHistory' in done.sources.find(source => source.id === 'S1')!));
  } finally {
    empty.close();
  }

  const noModel = withApp(providerSet);
  try {
    noModel.config.save({ exaKey: 'test-exa-key' });
    seedRead(noModel, 'Herbert Simon on bounded rationality', 'https://example.org/simon');
    const done = await runJob(noModel);
    assert.equal(done.mode, 'extractive');
    assert.ok(done.sources.every(source => !('fromHistory' in source)));
  } finally {
    noModel.close();
  }

  assert.equal(overlapCalls, 0);
});

type ModelRequest = { max_tokens: number; reasoning?: unknown; messages: { content: string }[] };

function interceptModel(replies: string[]) {
  const originalFetch = globalThis.fetch;
  const requests: ModelRequest[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as ModelRequest);
    const content = replies[Math.min(requests.length, replies.length) - 1];
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = originalFetch; } };
}

test('the synthesis prompt includes recent reads only when there are some', async () => {
  const model = interceptModel([JSON.stringify(briefCiting([]))]);
  try {
    const settings = { exaKey: '', llmKey: 'test-only-key', llmBaseUrl: 'https://mock.provider.test/v1', model: 'mock-model' };
    const sources: Source[] = [{ id: 'S0', title: capture.title, url: capture.url, text: capture.text, kind: 'original' }];
    const reads: RecentRead[] = [{ title: 'Herbert Simon on bounded rationality', url: 'https://example.org/simon', readAt: '2026-09-12T00:00:00.000Z' }];

    await providers.synthesize(capture, '', sources, settings, new AbortController().signal);
    await providers.synthesize(capture, '', sources, settings, new AbortController().signal, reads);

    const [withoutReads, withReads] = model.requests.map(request => ({
      system: request.messages[0].content,
      payload: JSON.parse(request.messages[1].content) as Record<string, unknown>
    }));
    assert.ok(!withoutReads.system.includes('recently read'));
    assert.ok(!('recentReads' in withoutReads.payload));
    assert.match(withReads.system, /Prefer sources that extend or challenge what they already know\. Deprioritize sources that merely duplicate what they have already read\./);
    assert.deepEqual(withReads.payload.recentReads, ['Herbert Simon on bounded rationality']);
  } finally {
    model.restore();
  }
});

test('historyOverlap asks for a small JSON verdict and maps the read number safely', async () => {
  const model = interceptModel([
    '{"overlap":true,"readNumber":2}',
    '{"overlap":true,"readNumber":"1"}',
    '{"overlap":true,"readNumber":9}',
    '{"overlap":false,"readNumber":null}',
    'not json'
  ]);
  try {
    const settings = { exaKey: '', llmKey: 'test-only-key', llmBaseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash-0731' };
    const reads: RecentRead[] = [
      { title: 'First read', url: 'https://a.example/1', readAt: '' },
      { title: 'Second read', url: 'https://a.example/2', readAt: '' }
    ];
    const source: Source = { id: 'S1', title: 'Related', url: 'https://r.example/x', text: 'Related text', kind: 'related' };
    const signal = new AbortController().signal;

    const results: (number | null)[] = [];
    for (let i = 0; i < 4; i++) results.push(await providers.historyOverlap!(source, reads, settings, signal));
    assert.deepEqual(results, [1, 0, null, null]);
    // Unreadable output surfaces as an error; the research queue treats that as "no overlap".
    await assert.rejects(providers.historyOverlap!(source, reads, settings, signal));

    assert.equal(model.requests[0].max_tokens, 200);
    assert.deepEqual(model.requests[0].reasoning, { enabled: false });
    assert.deepEqual(JSON.parse(model.requests[0].messages[1].content).recentReads, [
      { number: 1, title: 'First read' },
      { number: 2, title: 'Second read' }
    ]);

    assert.equal(await providers.historyOverlap!(source, [], settings, signal), null);
    assert.equal(model.requests.length, 5, 'no model request is made without recent reads');
  } finally {
    model.restore();
  }
});
