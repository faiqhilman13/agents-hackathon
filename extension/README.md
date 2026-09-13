# Cortex — Chrome extension

Vanilla JavaScript, Manifest V3, no build step. Load the folder as-is.

## Load it in Chrome (unpacked)

1. Start the backend first (see the [root README](../README.md)): `cd backend && npm run dev`.
2. Open **`chrome://extensions`** in Chrome.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select this **`extension/`** folder (the one containing `manifest.json`).
5. Pin Cortex: click the puzzle-piece icon in the toolbar → pin **Cortex** (purple ✦).
6. Open a real article (a news story, blog post, or Wikipedia page). The Cortex panel appears top-right and loads 3 related sources within a few seconds.

Tabs that were already open before you loaded the extension don't have the content script yet. Refresh them, or click the ✦ toolbar icon (it injects Cortex on demand).

## Everyday use

| Action | What happens |
| --- | --- |
| Open an article | Panel appears and fetches sources (only if the page has ≥ 500 chars of text) |
| Click **✕** in the panel | Collapses to a small "✦ Cortex" pill, and remembers that for future pages |
| Click the pill or the toolbar icon | Opens the panel (the first open on a page fetches sources) |
| Click **↻** | Re-extracts the page and fetches fresh sources (skips the cache) |

While collapsed, Cortex makes **no** API calls, so it won't spend your Exa or OpenRouter credits.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Declares the content script, background worker, icons, and permissions |
| `config.js` | **Edit me.** `BACKEND_URL`, `MIN_ARTICLE_CHARS`, `DEBUG` |
| `content.js` | Runs in every page: extracts text, injects the sidebar, renders cards |
| `background.js` | Service worker: does the backend `fetch`, handles toolbar clicks |
| `sidebar.css` | All styles, every class prefixed `.cortex-` |
| `icons/` | 16/48/128 px PNGs + `generate_icons.py` (stdlib-only) to regenerate them |

## Pointing at a deployed backend

1. In `config.js`, set `BACKEND_URL = 'https://your-project.vercel.app'` (no trailing slash).
2. `*.vercel.app` is already in `host_permissions`. For a custom domain, add `"https://yourdomain.com/*"` to `host_permissions` in `manifest.json`.
3. On `chrome://extensions`, click **↻ reload** on the Cortex card, then refresh your article tab.

## After editing code

- **`content.js` / `sidebar.css`**: reload the extension, **then refresh the web page**.
- **`background.js` / `config.js` / `manifest.json`**: reload the extension.

## Debugging

- **Content-script logs**: open DevTools on the article page → Console → filter `[Cortex]`.
- **Background logs and network calls**: `chrome://extensions` → Cortex → click **"service worker"** → Console / Network tabs.
- **"Can't reach the Cortex backend…"**: the backend isn't running, or `BACKEND_URL` is wrong. Check `http://localhost:3000/api/health`.
- **"Backend error (500): Server is missing EXA_API_KEY"**: add your key to `backend/.env` and restart `npm run dev`.
- **No panel appears**: the page probably has under 500 chars of text. Click the toolbar icon to open the panel anyway.
- **Chrome pages** (`chrome://…`, the Web Store) never allow extensions to run. That's expected.
