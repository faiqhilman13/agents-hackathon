/**
 * POST /api/related
 *
 * Input body:  { url, title, text }   — the page the user is reading
 * Output:      { suggestions: [{ title, url, source, highlight, whyItMatters }, ...] }  (up to 3)
 *
 * Pipeline:
 *   1. Validate the request.
 *   2. Exa neural search -> ~8 related candidates (lib/exa.js)
 *   3. LLM via OpenRouter picks the sharpest 3 + writes "why it matters" (lib/rank.js)
 *
 * On Vercel, every file in /api becomes an endpoint automatically:
 * this file is served at /api/related.
 */
import { handlePreflight, readJsonBody, sendJson } from '../lib/http.js';
import { searchRelated } from '../lib/exa.js';
import { rankWithLLM } from '../lib/rank.js';

// The extension already skips pages under 500 chars; this is a looser safety net
// for other callers (curl, tests) so we don't burn Exa credits on empty input.
const MIN_TEXT_CHARS = 200;

// Hard cap on how much text we accept, to keep requests small and fast.
const MAX_TEXT_CHARS = 20000;

export default async function handler(req, res) {
  // CORS preflight (OPTIONS) — answer and stop.
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed. Use POST with { url, title, text }.' });
  }

  // ---- 1. Parse + validate input ------------------------------------------
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Request body must be valid JSON.' });
  }

  const url = typeof body?.url === 'string' ? body.url : '';
  const title = typeof body?.title === 'string' ? body.title.slice(0, 500) : '';
  const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_TEXT_CHARS) : '';

  if (text.trim().length < MIN_TEXT_CHARS) {
    return sendJson(res, 400, {
      error: `"text" is required and must be at least ${MIN_TEXT_CHARS} characters.`,
    });
  }

  if (!process.env.EXA_API_KEY) {
    // Most common first-run mistake — make it obvious.
    return sendJson(res, 500, { error: 'Server is missing EXA_API_KEY. Add it to backend/.env (or Vercel env vars).' });
  }

  // ---- 2. Search with Exa -------------------------------------------------
  let candidates;
  try {
    candidates = await searchRelated({ url, title, text });
  } catch (err) {
    console.error('[cortex] Exa search failed:', err);
    return sendJson(res, 502, { error: 'Related-source search failed.', detail: err.message });
  }

  if (candidates.length === 0) {
    return sendJson(res, 200, { suggestions: [] });
  }

  // ---- 3. Rank with the LLM (never throws; falls back to Exa order) -------
  const suggestions = await rankWithLLM({ url, title, text }, candidates);

  return sendJson(res, 200, { suggestions });
}
