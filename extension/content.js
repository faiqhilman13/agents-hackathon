/**
 * Cortex — content script (runs inside every web page you visit)
 *
 * Flow:
 *   1. Ask the background worker for config (content scripts can't `import`).
 *   2. Extract the article text from the page.
 *   3. If there's enough text, inject the sidebar into the page.
 *   4. Send { url, title, text } to the background worker (FETCH_RELATED),
 *      which calls the backend and returns { suggestions }.
 *   5. Render up to 3 cards, or a loading / error / empty status.
 *
 * Why no Shadow DOM? To keep this readable, we isolate styles by prefixing every
 * class with "cortex-" and resetting inherited page styles in sidebar.css.
 *
 * Why is everything wrapped in (() => { ... })()? Content scripts are classic
 * scripts (no ES modules), so the wrapper keeps our variables private and lets
 * us `return` early.
 */
(() => {
  'use strict';

  // Guard: the script can be injected twice (manifest + toolbar-click injection).
  if (window.__cortexLoaded) return;
  window.__cortexLoaded = true;

  // Don't send novels to the backend — the first ~12k chars say what the page is about.
  const MAX_ARTICLE_CHARS = 12000;

  // chrome.storage key remembering whether the user collapsed the sidebar.
  const COLLAPSED_KEY = 'cortexCollapsed';

  // Defaults, overwritten by config.js values from the background worker.
  let config = { MIN_ARTICLE_CHARS: 500, DEBUG: false };

  // References to the sidebar's DOM nodes (filled in by buildSidebar).
  const ui = { root: null, pill: null, panel: null, status: null, list: null };

  // loaded: we already fetched suggestions for this page. loading: a fetch is in flight.
  const state = { loaded: false, loading: false };

  function log(...args) {
    if (config.DEBUG) console.log('[Cortex]', ...args);
  }

  // ===========================================================================
  // 1. Article extraction
  // ===========================================================================

  /** Tidy innerText: collapse runs of spaces and blank lines. */
  function cleanText(raw) {
    return String(raw || '')
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }

  function getTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const h1 = document.querySelector('h1')?.innerText;
    return cleanText(ogTitle || document.title || h1 || '');
  }

  /**
   * Returns { url, title, text }.
   * Prefers <article>, then <main>, then [role="main"], else the whole <body>.
   * A candidate only "wins" if it has enough text — some sites use a tiny
   * <article> for a teaser card while the real content is elsewhere.
   */
  function extractArticle() {
    // Hide our own sidebar so its text doesn't get included (innerText skips display:none).
    const previousDisplay = ui.root ? ui.root.style.display : '';
    if (ui.root) ui.root.style.display = 'none';

    try {
      let text = '';
      for (const selector of ['article', 'main', '[role="main"]']) {
        const candidate = cleanText(document.querySelector(selector)?.innerText);
        if (candidate.length >= config.MIN_ARTICLE_CHARS) {
          log(`Extracted ${candidate.length} chars from <${selector}>`);
          text = candidate;
          break;
        }
      }
      if (!text) {
        text = cleanText(document.body?.innerText);
        log(`Extracted ${text.length} chars from <body>`);
      }

      return { url: location.href, title: getTitle(), text: text.slice(0, MAX_ARTICLE_CHARS) };
    } finally {
      if (ui.root) ui.root.style.display = previousDisplay;
    }
  }

  // ===========================================================================
  // 2. Sidebar DOM (vanilla JS — no frameworks)
  // ===========================================================================

  /** Tiny helper: el('div', 'cortex-x', 'hello') -> <div class="cortex-x">hello</div> */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // textContent (never innerHTML) so text from the web can't inject HTML/scripts.
    if (text != null) node.textContent = text;
    return node;
  }

  function iconButton(symbol, label, onClick) {
    const button = el('button', 'cortex-icon-btn', symbol);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Builds (once) the structure:
   *
   *   div.cortex-root                  fixed, top-right, max z-index
   *     button.cortex-pill             shown when collapsed
   *     aside.cortex-panel             shown when expanded
   *       header.cortex-header         logo, title, refresh + collapse buttons
   *       div.cortex-status            loading / error / empty message
   *       ol.cortex-list               the 3 cards
   *       footer.cortex-footer
   *
   * It starts collapsed; call setCollapsed(false) to open it.
   */
  function buildSidebar() {
    if (ui.root) return;

    const root = el('div', 'cortex-root cortex-collapsed');

    // --- Collapsed pill ---
    const pill = el('button', 'cortex-pill');
    pill.type = 'button';
    pill.setAttribute('aria-label', 'Open Cortex related sources');
    pill.append(el('span', 'cortex-pill-star', '✦'), el('span', 'cortex-pill-label', 'Cortex'));
    pill.addEventListener('click', () => setCollapsed(false, { persist: true }));

    // --- Expanded panel ---
    const panel = el('aside', 'cortex-panel');
    panel.setAttribute('aria-label', 'Cortex related sources');

    const header = el('header', 'cortex-header');
    const brand = el('div', 'cortex-brand');
    const brandText = el('div', 'cortex-brand-text');
    brandText.append(el('span', 'cortex-title', 'Cortex'), el('span', 'cortex-subtitle', 'Related reading for this page'));
    brand.append(el('span', 'cortex-logo', '✦'), brandText);

    const actions = el('div', 'cortex-actions');
    actions.append(
      iconButton('↻', 'Find sources again', () => loadSuggestions({ force: true })),
      iconButton('✕', 'Collapse Cortex', () => setCollapsed(true, { persist: true })),
    );
    header.append(brand, actions);

    const status = el('div', 'cortex-status cortex-status--hidden');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const list = el('ol', 'cortex-list');
    const footer = el('footer', 'cortex-footer', 'Found with Exa · ranked by GPT-4o mini');

    panel.append(header, status, list, footer);
    root.append(pill, panel);

    // Attach to <html> rather than <body>: some sites restyle or replace <body>.
    document.documentElement.appendChild(root);

    Object.assign(ui, { root, pill, panel, status, list });
  }

  /**
   * Show a status line. kind: 'loading' | 'error' | 'empty' | null (hide).
   */
  function setStatus(kind, message) {
    ui.status.className = `cortex-status cortex-status--${kind || 'hidden'}`;
    ui.status.textContent = '';
    if (!kind) return;
    if (kind === 'loading') ui.status.append(el('span', 'cortex-spinner'));
    ui.status.append(el('span', 'cortex-status-text', message));
  }

  /** Build one card <li> from a suggestion. Returns null if the URL looks unsafe. */
  function createCard(suggestion) {
    const { title, url, source, highlight, whyItMatters } = suggestion || {};
    if (!/^https?:\/\//i.test(url || '')) return null; // only real web links (blocks javascript: URLs)

    const card = el('li', 'cortex-card');
    const link = el('a', 'cortex-card-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    link.append(el('span', 'cortex-card-source', source || new URL(url).hostname.replace(/^www\./, '')));
    link.append(el('h3', 'cortex-card-title', title || url));

    if (whyItMatters) {
      const why = el('p', 'cortex-card-why');
      why.append(el('span', 'cortex-why-label', 'Why it matters'), el('span', 'cortex-why-text', whyItMatters));
      link.append(why);
    }

    // Optional highlight: Exa's excerpt from the source, as a purple-bordered quote.
    if (highlight) {
      link.append(el('blockquote', 'cortex-card-highlight', `“${highlight}”`));
    }

    card.append(link);
    return card;
  }

  /** Replace the list with cards. Returns how many cards were rendered. */
  function renderCards(suggestions) {
    ui.list.textContent = '';
    let count = 0;
    for (const suggestion of suggestions.slice(0, 3)) {
      const card = createCard(suggestion);
      if (card) {
        ui.list.append(card);
        count++;
      }
    }
    return count;
  }

  // ===========================================================================
  // 3. Talking to the background worker
  // ===========================================================================

  /** Turn low-level errors into something a user can act on. */
  function friendlyError(err) {
    const message = String(err?.message || err || 'Something went wrong.');
    if (message.includes('Extension context invalidated')) {
      return 'Cortex was reloaded. Refresh this page to reconnect.';
    }
    return message;
  }

  /** Extract the article, ask the backend (via background) for sources, render. */
  async function loadSuggestions({ force = false } = {}) {
    if (state.loading || !ui.root) return;

    const article = extractArticle();
    if (article.text.length < config.MIN_ARTICLE_CHARS) {
      ui.list.textContent = '';
      setStatus('empty', "This page doesn't have enough article text for Cortex to work with.");
      state.loaded = true;
      return;
    }

    state.loading = true;
    ui.list.textContent = '';
    setStatus('loading', 'Finding related sources across the web…');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_RELATED', payload: article, force });
      if (!response?.ok) throw new Error(response?.error || 'No response from the Cortex background worker.');

      const count = renderCards(response.data?.suggestions || []);
      if (count === 0) {
        setStatus('empty', 'No related sources found for this page.');
      } else {
        setStatus(null);
      }
      state.loaded = true;
    } catch (err) {
      log('Load failed:', err);
      setStatus('error', friendlyError(err));
      // leave state.loaded false so reopening the panel retries
    } finally {
      state.loading = false;
    }
  }

  // ===========================================================================
  // 4. Open / collapse
  // ===========================================================================

  /**
   * collapsed = true shows the pill; false shows the panel.
   * persist = remember the choice for future pages.
   * Opening the panel triggers the first fetch — so a collapsed Cortex costs no API credits.
   */
  function setCollapsed(collapsed, { persist = false } = {}) {
    if (!ui.root) return;
    ui.root.classList.toggle('cortex-collapsed', collapsed);
    ui.pill.setAttribute('aria-expanded', String(!collapsed));

    if (persist) {
      chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed }).catch(() => {});
    }
    if (!collapsed && !state.loaded) loadSuggestions();
  }

  /** Handler for the toolbar icon. forceOpen = always open instead of flipping. */
  function toggleSidebar(forceOpen = false) {
    buildSidebar(); // no-op if it already exists
    const isCollapsed = ui.root.classList.contains('cortex-collapsed');
    setCollapsed(forceOpen ? false : !isCollapsed, { persist: true });
  }

  async function readCollapsedPreference() {
    try {
      const stored = await chrome.storage.local.get(COLLAPSED_KEY);
      return Boolean(stored[COLLAPSED_KEY]);
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // 5. Startup
  // ===========================================================================

  async function init() {
    try {
      const remoteConfig = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      config = { ...config, ...remoteConfig };
    } catch (err) {
      console.warn('[Cortex] Could not load config, using defaults:', err.message);
    }

    const article = extractArticle();
    if (article.text.length < config.MIN_ARTICLE_CHARS) {
      log(`Skipping page: only ${article.text.length} chars (< ${config.MIN_ARTICLE_CHARS}).`);
      return; // no sidebar; the toolbar icon can still open it manually
    }

    buildSidebar();
    setCollapsed(await readCollapsedPreference());
  }

  // Keep the promise so messages that arrive during startup wait for it.
  const ready = init();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'TOGGLE_SIDEBAR') {
      ready.then(() => toggleSidebar(Boolean(message.forceOpen)));
      // Respond right away so the background's sendMessage promise resolves cleanly.
      sendResponse({ ok: true });
    }
    return false;
  });
})();
