import type { Research } from './schema';

/**
 * Research made before a provider key was connected is "stale": it skipped Exa or the language model
 * only because the key was missing. Auto-read researches such a page again once the key exists.
 * A rejected key produces a different warning, so a bad key never causes a re-read loop.
 */
export function staleForProviders(research: Pick<Research, 'status' | 'mode' | 'warnings' | 'input'>, providers: { exa?: boolean; llm?: boolean }): boolean {
  if (research.status !== 'complete') return false;
  const missedExa = !!providers.exa && research.input.enrich && research.warnings.some(warning => warning.startsWith('Exa is not connected'));
  const missedModel = !!providers.llm && research.mode === 'extractive' && research.warnings.some(warning => warning.startsWith('No language model is connected'));
  return missedExa || missedModel;
}
