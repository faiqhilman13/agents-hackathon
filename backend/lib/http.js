/**
 * Small HTTP helpers shared by every endpoint.
 *
 * We deliberately only use plain Node `res.setHeader / res.statusCode / res.end`
 * (not Vercel's `res.json()` sugar) so the exact same handlers run both on
 * Vercel AND in our zero-dependency local server (dev-server.js).
 */

// CORS layer #1: every response says "any origin may read this".
// (CORS layer #2 lives in the extension: all fetches go through the background
// service worker, which isn't bound by the page's origin at all.)
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400', // let browsers cache the preflight for a day
};

/** Attach the CORS headers to a response. Call this on EVERY response. */
export function setCors(res) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(name, value);
  }
}

/** Send a JSON body with a status code (CORS headers included). */
export function sendJson(res, statusCode, data) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/**
 * Browsers send an OPTIONS "preflight" request before a cross-origin POST with
 * a JSON body. Answer it with 204 + CORS headers and stop.
 * Returns true if the request was a preflight (so the caller should `return`).
 */
export function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  setCors(res);
  res.statusCode = 204;
  res.end();
  return true;
}

/**
 * Read a JSON request body in a way that works everywhere:
 *  - On Vercel, `req.body` is already parsed for `Content-Type: application/json`.
 *  - It can also arrive as a string or Buffer (e.g. wrong/missing content-type).
 *  - In dev-server.js nothing is pre-parsed, so we read the raw stream.
 * Throws if the body isn't valid JSON.
 */
export async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString('utf8'));
    if (typeof req.body === 'string') return parseJson(req.body);
    return req.body; // already an object
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(raw) {
  return raw && raw.trim() ? JSON.parse(raw) : {};
}
