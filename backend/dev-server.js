/**
 * Zero-config local server — `npm run dev`
 *
 * Runs the exact same handlers Vercel runs (api/*.js) on http://localhost:3000,
 * without needing a Vercel account, login, or project link. Great for hacking.
 *
 * Env vars are loaded from .env by Node itself (the `--env-file=.env` flag in
 * package.json, Node 20.6+), so there's no dotenv dependency.
 *
 * Prefer the real Vercel emulator? Use `npm run dev:vercel` instead.
 */
import http from 'node:http';
import { sendJson } from './lib/http.js';
import relatedHandler from './api/related.js';
import healthHandler from './api/health.js';

const PORT = Number(process.env.PORT) || 3000;

// Map URL paths to handlers. Add a line here when you add a file to /api.
const routes = {
  '/api/related': relatedHandler,
  '/api/health': healthHandler,
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const handler = routes[pathname.replace(/\/+$/, '')];
  const started = Date.now();

  res.on('finish', () => {
    console.log(`${req.method} ${pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  });

  if (!handler) {
    return sendJson(res, 404, { error: `No route for ${pathname}` });
  }

  try {
    await handler(req, res);
  } catch (err) {
    console.error('Unhandled error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n✦ Cortex backend running at http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health`);
  if (!process.env.EXA_API_KEY) console.warn('  ⚠ EXA_API_KEY is not set — /api/related will fail.');
  if (!process.env.OPENROUTER_API_KEY) console.warn('  ⚠ OPENROUTER_API_KEY is not set — results will be unranked.');
});
