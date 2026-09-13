import type { RailStatus } from './messages';

// Margin's always-on rail: three floating circles docked at the side of every page.
//   1. Sources  related sources found with Exa (Layers 1-3)
//   2. Brief    the brief for the whole article, plus "Test my thinking" (Layers 2 and 4)
//   3. Ask      questions answered from everything you have read (Layers 5-7)
// With auto-read on, this file is registered as a content script on every http(s) page and
// asks the background worker to research the page once it has been the visible tab for a moment.
// It is also injected on demand by the popup's "Open assistant", which keeps working without auto-read.

type View = 'sources' | 'brief' | 'ask';

type OverlayApi = {
  open(tabId: number, view?: View): void;
  close(): void;
  collapse(): void;
  expand(): void;
  toggle(tabId: number): void;
};

const HOST_ID = '__margin_research_overlay__';
const DWELL_MS = 2500;
const POLL_MS = 3000;
const scope = globalThis as typeof globalThis & { MarginOverlay?: OverlayApi };

const TITLES: Record<View, string> = { sources: 'Related sources', brief: 'Brief', ask: 'Ask your reading' };
const LABELS: Record<View, string> = { sources: 'Related sources (Exa)', brief: 'Brief about this page', ask: 'Ask your reading history' };
const ICONS: Record<View, string> = {
  sources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M8.5 11h5M11 8.5v5"/></svg>',
  brief: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4M10 12h5M10 15.5h5"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M9 10h6M9 13h3.5"/></svg>',
};

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .rail { position: fixed; right: 14px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .orb { appearance: none; position: relative; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(20,35,26,.2); background: #f7f5ed; color: #17241c; display: grid; place-items: center; cursor: pointer; box-shadow: 0 8px 24px rgba(9,18,12,.22); transition: transform .15s ease, background .15s ease, color .15s ease; }
  .orb:hover, .orb:focus-visible { transform: scale(1.07); outline: none; }
  .orb.active { background: #17241c; color: #f7f5ed; }
  .orb svg { width: 20px; height: 20px; }
  .badge { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #b46842; color: #fff; font: 600 10px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; }
  .dot { position: absolute; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #f7f5ed; }
  .dot.history { left: -2px; background: #6d28d9; }
  .dot.bridge { right: -2px; background: #0f766e; }
  .ring { position: absolute; inset: -5px; border-radius: 50%; background: conic-gradient(#b46842 var(--progress, 8%), rgba(180,104,66,.15) 0); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px)); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px)); pointer-events: none; }
  [hidden] { display: none !important; }
  .label { position: absolute; right: 58px; top: 50%; transform: translateY(-50%); max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #17241c; color: #f7f5ed; font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 6px 9px; border-radius: 7px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .orb:hover .label, .orb:focus-visible .label { opacity: 1; }
  .hide { appearance: none; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(23,36,28,.55); color: #f7f5ed; font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; cursor: pointer; opacity: .55; }
  .hide:hover, .hide:focus-visible { opacity: 1; outline: none; }
  .shell { position: fixed; right: 74px; top: 20px; width: min(410px, calc(100vw - 96px)); height: min(780px, calc(100vh - 40px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(20,35,26,.18); border-radius: 18px; background: #f7f5ed; box-shadow: 0 24px 70px rgba(9,18,12,.28), 0 3px 14px rgba(9,18,12,.16); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .shell.collapsed { display: none; }
  .chrome { height: 38px; flex: 0 0 38px; display: flex; align-items: center; gap: 8px; padding: 0 9px 0 13px; background: #17241c; color: #f7f5ed; user-select: none; }
  .mark { width: 17px; height: 17px; border: 1px solid rgba(255,255,255,.42); border-radius: 5px; display: grid; place-items: center; font: 600 12px/1 Georgia, serif; color: #f4a27e; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .02em; }
  .chrome button { appearance: none; border: 0; width: 28px; height: 28px; border-radius: 8px; background: transparent; color: #f7f5ed; display: grid; place-items: center; cursor: pointer; font: 500 17px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .chrome button:hover, .chrome button:focus-visible { background: rgba(255,255,255,.13); outline: none; }
  iframe { display: block; width: 100%; min-height: 0; flex: 1; border: 0; background: #f7f5ed; }
  @media (max-width: 560px) {
    .rail { top: auto; bottom: 12px; transform: none; flex-direction: row; }
    .label { display: none; }
    .shell { left: 8px; right: 8px; top: 8px; width: auto; height: calc(100vh - 88px); border-radius: 14px; }
  }
`;

function orb(view: View): string {
  const extras = view === 'sources'
    ? '<span class="badge" hidden></span><span class="dot history" hidden title="Overlaps something you read recently"></span><span class="dot bridge" hidden title="Connects two of your earlier reads"></span>'
    : view === 'brief' ? '<span class="ring" hidden></span>' : '';
  return `<button type="button" class="orb" data-view="${view}" aria-label="${LABELS[view]}">${ICONS[view]}${extras}<span class="label">${LABELS[view]}</span></button>`;
}

function init(): void {
  if (scope.MarginOverlay) return; // Already running in this page (content script plus on-demand injection).

  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  let host: HTMLElement | undefined;
  let tabId: number | undefined;
  let view: View = 'brief';
  let status: RailStatus | undefined;
  let pageUrl = location.href;
  let autoRequested = false;
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let listeners: AbortController | undefined;

  async function send<T extends object>(message: { type: string }): Promise<T | undefined> {
    if (!chrome.runtime?.id) {
      teardown(); // The extension was reloaded or removed; this page's copy is orphaned.
      return undefined;
    }
    try {
      const response = await chrome.runtime.sendMessage(message) as ({ ok: boolean } & T) | undefined;
      return response?.ok ? response : undefined;
    } catch {
      return undefined;
    }
  }

  function shadow(): ShadowRoot | undefined {
    return host?.shadowRoot ?? undefined;
  }

  function mount(): void {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;display:block;color-scheme:light;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <nav class="rail" aria-label="Margin">
        ${orb('sources')}${orb('brief')}${orb('ask')}
        <button type="button" class="hide" data-action="hide" title="Hide Margin on this page" aria-label="Hide Margin on this page">×</button>
      </nav>
      <section class="shell collapsed" aria-label="Margin research assistant">
        <div class="chrome">
          <span class="mark">m</span><span class="title">Margin</span>
          <button type="button" data-action="collapse" title="Collapse Margin" aria-label="Collapse Margin">—</button>
          <button type="button" data-action="close" title="Close Margin" aria-label="Close Margin">×</button>
        </div>
        <iframe title="Margin research assistant"></iframe>
      </section>`;

    root.addEventListener('click', event => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
      if (!button) return;
      const target = button.dataset.view as View | undefined;
      if (target) {
        const open = !root.querySelector('.shell')?.classList.contains('collapsed');
        if (open && view === target) hidePanel();
        else showPanel(target);
      } else if (button.dataset.action === 'collapse' || button.dataset.action === 'close') {
        hidePanel();
      } else if (button.dataset.action === 'hide') {
        teardown();
      }
    });

    document.documentElement.append(host);
    render();
  }

  function showPanel(next: View): void {
    mount();
    const root = shadow();
    const iframe = root?.querySelector('iframe');
    if (!root || !iframe) return;
    view = next;
    if (!iframe.getAttribute('src')) {
      // Load the React panel only when a circle is first opened, so idle pages stay light.
      iframe.src = chrome.runtime.getURL(`panel.html?embedded=1&tabId=${encodeURIComponent(String(tabId ?? ''))}&view=${next}`);
    } else {
      iframe.contentWindow?.postMessage({ source: 'margin-rail', type: 'VIEW', view: next }, extensionOrigin);
    }
    root.querySelector('.shell')?.classList.remove('collapsed');
    highlight();
  }

  function hidePanel(): void {
    shadow()?.querySelector('.shell')?.classList.add('collapsed');
    highlight();
  }

  function highlight(): void {
    const root = shadow();
    if (!root) return;
    const open = !root.querySelector('.shell')?.classList.contains('collapsed');
    root.querySelectorAll<HTMLButtonElement>('.orb').forEach(button => button.classList.toggle('active', open && button.dataset.view === view));
    const title = root.querySelector('.title');
    if (title) title.textContent = `Margin · ${TITLES[view]}`;
  }

  function render(): void {
    const root = shadow();
    if (!root) return;
    const research = status?.research;
    const working = !!research && (research.status === 'queued' || research.status === 'running');
    const count = research ? research.picks || Math.min(3, research.related) : 0;

    const badge = root.querySelector<HTMLElement>('.badge');
    if (badge) {
      badge.hidden = !count;
      badge.textContent = String(count);
    }
    root.querySelector<HTMLElement>('.dot.history')!.hidden = !research?.fromHistory;
    root.querySelector<HTMLElement>('.dot.bridge')!.hidden = !research?.bridge;
    const ring = root.querySelector<HTMLElement>('.ring');
    if (ring) {
      ring.hidden = !working;
      ring.style.setProperty('--progress', `${Math.max(8, research?.progress ?? 0)}%`);
    }

    const briefLabel = root.querySelector('[data-view="brief"] .label');
    if (briefLabel) {
      briefLabel.textContent = working ? research!.stage
        : research?.status === 'complete' ? 'Brief ready'
        : research?.status === 'failed' ? 'Research paused. Open to retry'
        : status?.skipped ? status.skipped
        : status && !status.online ? 'Start the Margin server'
        : status && !status.paired ? 'Pair Margin in the popup'
        : status && !status.autoRead ? LABELS.brief
        : 'Reading this page…';
    }
    const sourcesLabel = root.querySelector('[data-view="sources"] .label');
    if (sourcesLabel) {
      sourcesLabel.textContent = !research ? LABELS.sources
        : `${count || 'No'} related source${count === 1 ? '' : 's'}${research.fromHistory ? ' · you read one before' : ''}${research.bridge ? ' · connects earlier reads' : ''}`;
    }
  }

  async function tick(): Promise<void> {
    if (!host) return;
    if (location.href !== pageUrl) {
      // Single-page apps change the URL without reloading: treat it as a new page.
      pageUrl = location.href;
      autoRequested = false;
      status = undefined;
      render();
    }
    if (document.visibilityState !== 'visible') {
      visibleSince = 0;
      return;
    }
    if (!visibleSince) visibleSince = Date.now();
    const next = await send<RailStatus>({ type: 'RAIL_STATUS' });
    if (!next) return;
    status = next;
    render();
    const readyToRead = next.autoRead && next.paired && next.online && !next.research && !next.skipped;
    if (readyToRead && !autoRequested && Date.now() - visibleSince >= DWELL_MS) {
      autoRequested = true; // One automatic attempt per page; the panel offers a manual start after that.
      const started = await send<RailStatus>({ type: 'RAIL_AUTO_READ' });
      if (started) {
        status = started;
        render();
      }
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => void tick(), POLL_MS);
    listeners = new AbortController();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        visibleSince = Date.now();
        setTimeout(() => void tick(), DWELL_MS + 100);
      }
    }, { signal: listeners.signal });
    globalThis.addEventListener('message', event => {
      const iframe = shadow()?.querySelector('iframe');
      if (!iframe || event.source !== iframe.contentWindow || event.origin !== extensionOrigin) return;
      const message = event.data as { source?: string; type?: string; view?: string } | null;
      if (message?.source !== 'margin-panel') return;
      if (message.type === 'CLOSE' || message.type === 'COLLAPSE') hidePanel();
      else if (message.type === 'EXPAND') showPanel(view);
      else if (message.type === 'VIEW_CHANGED' && (message.view === 'sources' || message.view === 'brief' || message.view === 'ask')) {
        view = message.view;
        highlight();
      } else if (message.type === 'REFRESH') void tick();
    }, { signal: listeners.signal });
    void tick();
    setTimeout(() => void tick(), DWELL_MS + 100);
  }

  function teardown(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    listeners?.abort();
    listeners = undefined;
    host?.remove();
    host = undefined;
  }

  function open(id: number, next: View = 'brief'): void {
    tabId ??= id;
    mount();
    start();
    showPanel(next);
  }

  scope.MarginOverlay = {
    open,
    close: hidePanel,
    collapse: hidePanel,
    expand: () => showPanel(view),
    toggle: id => {
      const open_ = !!host && !shadow()?.querySelector('.shell')?.classList.contains('collapsed');
      if (open_) hidePanel();
      else open(id);
    },
  };

  void (async () => {
    const ready = await send<RailStatus>({ type: 'RAIL_READY' });
    if (!ready) return; // Not a public page, or the extension is unavailable.
    tabId ??= ready.tabId;
    status = ready;
    // With auto-read on the rail is always present; otherwise it appears when "Open assistant" calls open().
    if (ready.autoRead) {
      mount();
      start();
    }
  })();
}

init();
