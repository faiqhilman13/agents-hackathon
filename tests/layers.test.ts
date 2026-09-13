import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { askLibrary, bridgeReads, findGaps, pickSources, weeklyReflection, type JsonModel } from '../server/layers';
import type { RecentRead } from '../server/library';
import type { Providers } from '../server/providers';
import type { Brief, Capture, Research, Source } from '../shared/schema';

// Reading layers 1, 3, 5, 6, 7 with fake model and search functions. No provider is contacted.

const settings = { exaKey: 'test-exa', llmKey: 'test-llm', llmBaseUrl: 'https://mock.provider.test/v1', model: 'mock-model' };
const signal = new AbortController().signal;

const capture: Capture = {
  url: 'https://example.com/ambition', title: 'How to be ambitious',
  text: 'Ambition is a habit of choosing problems slightly beyond your reach, with bounded rationality shaping the choice. '.repeat(3),
  selection: '', authors: [], description: '', capturedAt: '2026-09-13T00:00:00.000Z', coverage: 'page'
};
const brief: Brief = {
  title: capture.title,
  overview: { text: 'The essay argues ambition is a habit of problem choice.', sourceIds: ['S0'] },
  takeaways: [{ text: 'Choose problems slightly beyond reach.', sourceIds: ['S0'] }],
  connections: [], questions: [], tags: ['ambition']
};

function record(id: string, title: string, url: string, overrides: Partial<Research> = {}): Research {
  const now = overrides.createdAt || '2026-09-12T00:00:00.000Z';
  return {
    id, requestId: randomUUID(), status: 'complete', stage: 'Research ready to discuss', progress: 100, createdAt: now, updatedAt: now,
    input: { requestId: randomUUID(), capture: { ...capture, title, url, text: `${title} discusses ambition and bounded rationality in detail.` }, question: '', collection: 'Reading list', enrich: true },
    sources: [], mode: 'synthesis', warnings: [], notes: '', favorite: false, collection: 'Reading list', inLibrary: false,
    brief: { ...brief, title, overview: { text: `${title} overview about ambition.`, sourceIds: ['S0'] } },
    ...overrides
  };
}

function fakeJson(reply: (system: string, payload: any) => unknown) {
  const calls: { system: string; payload: any; maxTokens?: number }[] = [];
  const json: JsonModel = async (system, payload, _settings, _signal, maxTokens) => {
    calls.push({ system, payload, maxTokens });
    return reply(system, payload);
  };
  return { json, calls };
}

test('Layer 1: pickSources keeps up to three valid related picks with distinct roles', async () => {
  const sources: Source[] = [
    { id: 'S0', title: capture.title, url: capture.url, text: capture.text, kind: 'original' },
    { id: 'S1', title: 'Simon on bounded rationality', url: 'https://a.example/simon', text: 'Simon text', kind: 'related' },
    { id: 'S2', title: 'Against ambition', url: 'https://b.example/against', text: 'Counter text', kind: 'related' },
    { id: 'S3', title: 'Ant colonies', url: 'https://c.example/ants', text: 'Biology text', kind: 'related' }
  ];
  const { json, calls } = fakeJson(() => ({ picks: [
    { sourceId: 'S0', role: 'canonical', whyItMatters: 'The original itself.' },
    { sourceId: 'S1', role: 'canonical', whyItMatters: 'The idea this essay builds on.' },
    { sourceId: 'S9', role: 'opposing', whyItMatters: 'Unknown id.' },
    { sourceId: 'S1', role: 'opposing', whyItMatters: 'Duplicate source.' },
    { sourceId: 'S2', role: 'opposing', whyItMatters: 'The strongest counter-argument.' },
    { sourceId: 'S3', role: 'opposing', whyItMatters: 'Duplicate role.' },
    { sourceId: 'S3', role: 'unexpected', whyItMatters: 'A parallel from biology.' }
  ] }));
  const reads: RecentRead[] = [{ title: 'Earlier read', url: 'https://z.example', readAt: '' }];
  const picks = await pickSources(json, capture, brief, sources, reads, settings, signal);
  assert.deepEqual(picks.map(pick => [pick.sourceId, pick.role]), [['S1', 'canonical'], ['S2', 'opposing'], ['S3', 'unexpected']]);
  assert.deepEqual(calls[0].payload.recentReads, ['Earlier read']);
  assert.ok(!calls[0].payload.related.some((source: { id: string }) => source.id === 'S0'));
  assert.deepEqual(await pickSources(json, capture, brief, sources.slice(0, 1), reads, settings, signal), []);
  assert.equal(calls.length, 1, 'no model call without related sources');
});

test('Layer 3: bridgeReads maps two valid read numbers back to stored reads and rejects anything else', async () => {
  const reads: RecentRead[] = [
    { title: 'Kahneman on availability', url: 'https://k.example', readAt: '2026-08-01T00:00:00.000Z', researchId: 'r-k', summary: 'Heuristics.' },
    { title: 'Simon on bounded rationality', url: 'https://s.example', readAt: '2026-09-01T00:00:00.000Z', researchId: 'r-s', summary: 'Limits.' }
  ];
  const good = fakeJson(() => ({ found: true, readNumbers: [2, 1], text: 'This essay bridges Simon and Kahneman.' }));
  const bridge = await bridgeReads(good.json, capture, brief, reads, settings, signal);
  assert.deepEqual(bridge, { text: 'This essay bridges Simon and Kahneman.', reads: [
    { researchId: 'r-s', title: 'Simon on bounded rationality', url: 'https://s.example' },
    { researchId: 'r-k', title: 'Kahneman on availability', url: 'https://k.example' }
  ] });
  for (const reply of [{ found: false }, { found: true, readNumbers: [1, 1], text: 'Same read twice.' }, { found: true, readNumbers: [1, 7], text: 'Out of range.' }]) {
    assert.equal(await bridgeReads(fakeJson(() => reply).json, capture, brief, reads, settings, signal), undefined);
  }
  const single = fakeJson(() => ({ found: true }));
  assert.equal(await bridgeReads(single.json, capture, brief, reads.slice(0, 1), settings, signal), undefined);
  assert.equal(single.calls.length, 0, 'no model call with fewer than two earlier reads');
});

test('Layer 5: askLibrary answers only from read pages and maps citations to real records', async () => {
  const library = [
    record('r-1', 'Paul Graham on ambition', 'https://pg.example/ambition'),
    record('r-2', 'Taleb on skin in the game', 'https://taleb.example/skin', { inLibrary: true }),
    record('r-demo', 'Demo record', 'https://demo.example', { mode: 'demo' }),
    record('r-queued', 'Unfinished page', 'https://queued.example', { status: 'queued' })
  ];
  const { json, calls } = fakeJson((_system, payload) => ({ text: 'Graham and Taleb disagree [R1][R2].', citations: payload.documents.map((doc: { id: string }) => doc.id) }));
  const answer = await askLibrary(json, 'What have I read about ambition?', library, settings, signal);
  const titles = calls[0].payload.documents.map((doc: { title: string }) => doc.title).sort();
  assert.deepEqual(titles, ['Paul Graham on ambition', 'Taleb on skin in the game'], 'drafts count as reads; demos and unfinished pages do not');
  assert.equal(answer.citations.length, 2);
  assert.ok(answer.citations.every(citation => citation.researchId.startsWith('r-') && citation.url.startsWith('https://')));

  const bad = fakeJson(() => ({ text: 'Invented.', citations: ['R9'] }));
  await assert.rejects(askLibrary(bad.json, 'ambition', library, settings, signal), /outside your reading history/);
  const empty = fakeJson(() => ({}));
  const none = await askLibrary(empty.json, 'ambition', [], settings, signal);
  assert.deepEqual(none.citations, []);
  assert.equal(empty.calls.length, 0);
});

test('Layer 6: findGaps grounds gaps in read and web ids, suggesting only web results', async () => {
  const library = [record('r-1', 'Malaysia privacy enforcement', 'https://my.example/privacy')];
  const search = async () => [
    { title: 'Indonesia data protection', url: 'https://id.example/pdp', text: 'Indonesia text', kind: 'related' as const, publishedDate: '2024-01-01' },
    { title: 'Duplicate of a read page', url: 'https://my.example/privacy', text: 'dup', kind: 'related' as const }
  ];
  const { json } = fakeJson(() => ({ gaps: [{ title: 'No Indonesian enforcement data', text: 'Only Malaysia is covered in what you read.', evidence: ['L1', 'X9'], suggestions: ['E1', 'L1'] }] }));
  const result = await findGaps(json, search, 'privacy enforcement Southeast Asia', library, settings, signal);
  assert.deepEqual(result.sources.map(source => [source.id, source.kind]), [['L1', 'read'], ['E1', 'web']]);
  assert.deepEqual(result.gaps[0].evidence, ['L1']);
  assert.deepEqual(result.gaps[0].suggestions, ['E1']);
});

test('Layer 7: weeklyReflection needs two reads this week and links next reads from real search results', async () => {
  const now = new Date('2026-09-13T08:00:00.000Z');
  const thisWeek = (id: string, title: string, url: string, day: string) => record(id, title, url, { createdAt: `2026-09-${day}T00:00:00.000Z` });
  const oneRead = [thisWeek('r-1', 'Graham on ambition', 'https://pg.example', '12'), record('r-old', 'Old read', 'https://old.example', { createdAt: '2026-08-01T00:00:00.000Z' })];
  const quiet = fakeJson(() => ({}));
  const early = await weeklyReflection(quiet.json, undefined, oneRead, settings, signal, now);
  assert.equal(early.available, false);
  assert.equal(early.count, 1);
  assert.equal(quiet.calls.length, 0);

  const library = [thisWeek('r-2', 'Taleb on skin in the game', 'https://taleb.example', '11'), ...oneRead];
  const { json, calls } = fakeJson(() => ({ title: 'The week you wrestled with ambition', throughline: 'Greatness versus perceived greatness.', tension: 'Graham and Taleb disagree.', openQuestions: ['Which framing fits you?'], nextQueries: ['ambition perception research'] }));
  const search = async () => [
    { title: 'Already read', url: 'https://pg.example', text: 'x', kind: 'related' as const },
    { title: 'Status and ambition study', url: 'https://study.example', text: 'y', kind: 'related' as const }
  ];
  const reflection = await weeklyReflection(json, search, library, settings, signal, now);
  assert.equal(reflection.available, true);
  assert.equal(calls[0].payload.reads.length, 2, 'only this week\'s reads are reflected on');
  assert.deepEqual(reflection.nextReads, [{ title: 'Status and ambition study', url: 'https://study.example', why: 'ambition perception research' }]);
});

function pipelineProviders(overrides: Partial<Providers> = {}): Providers {
  return {
    resolve: async value => value,
    plan: async () => ['bounded rationality ambition'],
    search: async () => [
      { title: 'Bounded rationality revisited', url: 'https://papers.example/bounded', text: 'Bounded rationality and ambition.', kind: 'related' },
      { title: 'Ambition critique', url: 'https://critic.example/ambition', text: 'A critique of ambition.', kind: 'related' }
    ],
    // The brief cites only S1; the Reader layer should keep S2 because it is a pick.
    synthesize: async () => ({ ...brief, connections: [{ title: 'Builds on Simon', relationship: 'builds-on', text: 'Context.', sourceIds: ['S0', 'S1'] }] }),
    json: async system => system.includes('Reader layer')
      ? { picks: [{ sourceId: 'S1', role: 'canonical', whyItMatters: 'The source idea.' }, { sourceId: 'S2', role: 'opposing', whyItMatters: 'The strongest counterpoint.' }] }
      : system.includes('Cartographer layer')
        ? { found: true, readNumbers: [1, 2], text: 'This page bridges your two earlier reads.' }
        : {},
    ...overrides
  };
}

async function runPipeline(providerSet: Providers, seedReads: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'margin-layers-test-'));
  const built = createApp(dir, { providers: providerSet, recover: false });
  try {
    built.config.save({ exaKey: 'test-exa', llmKey: 'test-llm' });
    if (seedReads) for (const [title, url] of [['Kahneman on availability', 'https://k.example'], ['Simon on bounded rationality', 'https://s.example']]) {
      const { item } = built.store.create({ requestId: randomUUID(), capture: { ...capture, title, url }, question: '', collection: 'Reading list', enrich: true });
      built.store.update(item.id, { status: 'complete', mode: 'synthesis', brief: { ...brief, title } });
    }
    const { item } = built.store.create({ requestId: randomUUID(), capture, question: '', collection: 'Reading list', enrich: true });
    built.queue.kick();
    const deadline = Date.now() + 2500;
    let done = built.store.get(item.id);
    while (done && !['complete', 'failed'].includes(done.status) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 10)); done = built.store.get(item.id); }
    return done!;
  } finally {
    built.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('research stores Reader picks (keeping uncited picked sources) and a Cartographer bridge', async () => {
  const done = await runPipeline(pipelineProviders(), true);
  assert.equal(done.status, 'complete', done.error);
  assert.deepEqual(done.picks?.map(pick => pick.sourceId), ['S1', 'S2']);
  assert.ok(done.sources.some(source => source.id === 'S2'), 'a picked source survives even when the brief does not cite it');
  assert.equal(done.bridge?.reads.length, 2);
  assert.equal(done.bridge?.text, 'This page bridges your two earlier reads.');
  assert.equal(done.inLibrary, false);
});

test('without earlier reads there is no bridge, and without a json model there are no picks', async () => {
  const noHistory = await runPipeline(pipelineProviders(), false);
  assert.equal(noHistory.bridge, undefined);
  assert.equal(noHistory.picks?.length, 2);
  const noJson = await runPipeline(pipelineProviders({ json: undefined }), true);
  assert.equal(noJson.status, 'complete');
  assert.equal(noJson.picks, undefined);
  assert.equal(noJson.bridge, undefined);
  assert.ok(!noJson.sources.some(source => source.id === 'S2'), 'uncited, unpicked sources are still dropped');
});

test('library routes require a language model and answer from reading history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'margin-layers-http-'));
  const built = createApp(dir, { providers: pipelineProviders({ json: async () => ({ text: 'You have not read about that.', citations: [] }) }), recover: false });
  const server = await new Promise<Server>(resolve => { const listening = built.app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${built.config.token}` }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/library/ask', { message: 'ambition' })).status, 409);
    built.config.save({ llmKey: 'test-llm' });
    const { item } = built.store.create({ requestId: randomUUID(), capture, question: '', collection: 'Reading list', enrich: true });
    built.store.update(item.id, { status: 'complete', mode: 'synthesis', brief });
    const ask = await post('/api/library/ask', { message: 'ambition', conversation: [] });
    assert.equal(ask.status, 200);
    assert.equal((await ask.json() as { text: string }).text, 'You have not read about that.');
    const byUrl = await fetch(`${base}/api/research/by-url?url=${encodeURIComponent(capture.url + '#section')}`, { headers: { Authorization: `Bearer ${built.config.token}` } });
    assert.equal(byUrl.status, 200);
    assert.equal((await byUrl.json() as Research).id, item.id);
    const missing = await fetch(`${base}/api/research/by-url?url=${encodeURIComponent('https://nothing.example/page')}`, { headers: { Authorization: `Bearer ${built.config.token}` } });
    assert.equal(missing.status, 404);
    const reflection = await fetch(`${base}/api/library/reflection`, { headers: { Authorization: `Bearer ${built.config.token}` } });
    assert.equal(reflection.status, 200);
    assert.equal((await reflection.json() as { available: boolean }).available, false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    built.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
