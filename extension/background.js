/**
 * Cortex — background service worker
 *
 * Jobs:
 *  1. FETCH_RELATED: receive { url, title, text } from a content script and call
 *     the backend. Doing the fetch HERE (not in the content script) means the
 *     request comes from the extension's own origin, not the web page's — so
 *     the page's CORS rules / Content-Security-Policy can't block it.
 *     (That's CORS layer #2; the backend's Access-Control-Allow-Origin: * is layer #1.)
 *  2. GET_CONFIG: content scripts can't `import` ES modules, so they ask us
 *     for the settings in config.js.
 *  3. Toolbar icon click -> tell the tab to toggle the sidebar (TOGGLE_SIDEBAR).
 *
 * This file is an ES module ("type": "module" in manifest.json), which is why
 * `import` works here.
 */
import { BACKEND_URL, MIN_ARTICLE_CHARS, DEBUG } from './config.js';

const API_BASE = BACKEND_URL.replace(/\/+$/, '');

// The backend can take a while (Exa + LLM). Vercel caps it at 30s; we wait a bit longer.
const REQUEST_TIMEOUT_MS = 35_000;

// Tiny in-memory cache so reloading a page doesn't spend API credits again.
// Note: Chrome stops idle service workers after ~30s, which clears this. That's fine.
const cache = new Map(); // url -> { suggestions }
const CACHE_LIMIT = 50;

function log(...args) {
  if (DEBUG) console.log('[Cortex bg]', ...args);
}

// ---------------------------------------------------------------------------
// Messages from content scripts
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'GET_CONFIG':
      sendResponse({ MIN_ARTICLE_CHARS, DEBUG });
      return false; // responded synchronously

    case 'FETCH_RELATED':
      fetchRelated(message.payload, { force: Boolean(message.force) })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => {
          log('FETCH_RELATED failed:', err);
          sendResponse({ ok: false, error: err.message });
        });
      // IMPORTANT: returning true tells Chrome "I'll call sendResponse later".
      // Without it the message channel closes before the fetch finishes.
      return true;

    default:
      return false;
  }
});

/**
 * POST the article to the backend and return { suggestions: [...] }.
 * Throws an Error with a human-readable message on failure (shown in the sidebar).
 */
async function fetchRelated(payload, { force = false } = {}) {
  const { url = '', title = '', text = '' } = payload || {};
  if (!text) throw new Error('No article text to send.');

  if (!force && cache.has(url)) {
    log('Cache hit:', url);
    return cache.get(url);
  }

  const endpoint = `${API_BASE}/api/related`;
  log('POST', endpoint, { url, title, chars: text.length });

  // AbortController lets us give up if the backend hangs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, text }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`The backend took longer than ${REQUEST_TIMEOUT_MS / 1000}s to respond.`);
    }
    // "Failed to fetch" almost always means the server isn't running / wrong URL.
    throw new Error(`Can't reach the Cortex backend at ${API_BASE}. Is it running?`);
  } finally {
    clearTimeout(timer);
  }

  // Parse the body even for errors — the backend sends { error } explaining what went wrong.
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON body; handled below */
  }

  if (!response.ok) {
    const reason = data?.error || response.statusText || 'Unknown error';
    throw new Error(`Backend error (${response.status}): ${reason}`);
  }

  const result = { suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [] };
  log('Got', result.suggestions.length, 'suggestions for', url);

  // Store in cache, evicting the oldest entry if full (Maps keep insertion order).
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(url, result);

  return result;
}

// ---------------------------------------------------------------------------
// Toolbar icon click -> toggle the sidebar in that tab
// (onClicked only fires because manifest.json's "action" has no default_popup.)
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
  } catch (err) {
    // "Receiving end does not exist" = no content script in this tab. This happens
    // for tabs that were already open when you loaded/reloaded the extension.
    // Inject it now (allowed because the user clicked our icon: "activeTab"), then open.
    if (!String(err?.message).includes('Receiving end does not exist')) {
      log('TOGGLE_SIDEBAR failed:', err);
      return;
    }
    try {
      log('No content script in tab, injecting…');
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['sidebar.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR', forceOpen: true });
    } catch (injectErr) {
      // Chrome never allows scripts on chrome://, the Web Store, etc.
      log('Cannot run Cortex on this page:', injectErr.message);
    }
  }
});
