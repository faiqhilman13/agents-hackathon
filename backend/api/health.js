/**
 * GET /api/health  ->  { ok: true }
 *
 * A tiny endpoint to check the backend is up (and that CORS works) without
 * spending any Exa or OpenRouter credits. Open it in a browser tab.
 */
import { handlePreflight, sendJson } from '../lib/http.js';

export default function handler(req, res) {
  if (handlePreflight(req, res)) return;
  return sendJson(res, 200, { ok: true });
}
