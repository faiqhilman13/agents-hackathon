/**
 * Cortex extension config — the only file you should need to edit.
 *
 * After changing anything here, go to chrome://extensions and click the
 * reload (↻) icon on the Cortex card, then refresh the page you're testing.
 */

// Where the backend lives. No trailing slash.
//   Local:     "http://localhost:3000"             (cd backend && npm run dev)
//   Deployed:  "https://your-project.vercel.app"
// If you use a custom domain, also add it to "host_permissions" in manifest.json.
export const BACKEND_URL = 'http://localhost:3000';

// Pages with less extracted text than this are skipped (nav pages, logins, search results...).
export const MIN_ARTICLE_CHARS = 500;

// true = log what Cortex is doing to the console.
//   Content script logs: the page's DevTools console (filter by "[Cortex]").
//   Background logs: chrome://extensions -> Cortex -> "service worker" link.
export const DEBUG = true;
