import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMath } from '../src/mathText';
import { staleForProviders } from '../shared/freshness';
import type { Research } from '../shared/schema';

test('splitMath finds inline and display TeX but leaves prices alone', () => {
  assert.deepEqual(splitMath('Mass $M_\\star \\sim 10^{7}$ here'), [
    { kind: 'text', value: 'Mass ' },
    { kind: 'math', value: 'M_\\star \\sim 10^{7}', display: false },
    { kind: 'text', value: ' here' }
  ]);
  assert.deepEqual(splitMath('$$\\int_0^1 x\\,dx$$'), [{ kind: 'math', value: '\\int_0^1 x\\,dx', display: true }]);
  assert.deepEqual(splitMath('It costs $5 and $10 per month.'), [{ kind: 'text', value: 'It costs $5 and $10 per month.' }]);
  assert.deepEqual(splitMath('Price $5, then $x^2$.'), [
    { kind: 'text', value: 'Price $5, then ' },
    { kind: 'math', value: 'x^2', display: false },
    { kind: 'text', value: '.' }
  ]);
  assert.deepEqual(splitMath('Use \\(a_b\\) or \\[c^d\\].').map(segment => segment.kind), ['text', 'math', 'text', 'math', 'text']);
  assert.deepEqual(splitMath(''), []);
});

test('research made before a provider key was connected is re-read once the key exists', () => {
  const research = (overrides: object = {}) => ({
    status: 'complete',
    mode: 'extractive',
    input: { enrich: true },
    warnings: [
      'Exa is not connected. Saved the original without external enrichment.',
      'No language model is connected. This is an extractive source digest, not an AI synthesis.'
    ],
    ...overrides
  }) as unknown as Research;

  assert.equal(staleForProviders(research(), {}), false);
  assert.equal(staleForProviders(research(), { exa: true }), true);
  assert.equal(staleForProviders(research(), { llm: true }), true);
  assert.equal(staleForProviders(research({ status: 'running' }), { exa: true, llm: true }), false);
  assert.equal(
    staleForProviders(research({ mode: 'synthesis', warnings: ['Exa returned 401. Check your API key and access.'] }), { exa: true, llm: true }),
    false,
    'a rejected key is not retried in a loop'
  );
  assert.equal(staleForProviders(research({ input: { enrich: false }, warnings: [] }), { exa: true }), false);
});
