type OverlayPosition = { left: number; top: number };

type OverlayApi = {
  open(tabId: number): void;
  close(): void;
  collapse(): void;
  expand(): void;
  toggle(tabId: number): void;
};

const HOST_ID = '__margin_research_overlay__';
const POSITION_KEY = 'overlayPosition';
let messageController: AbortController | undefined;

function existingHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function keepVisible(host: HTMLElement): void {
  const bounds = host.getBoundingClientRect();
  host.style.top = `${clamp(bounds.top, 8, Math.max(8, innerHeight - host.offsetHeight - 8))}px`;
  if (host.style.right === 'auto') {
    host.style.left = `${clamp(bounds.left, 8, Math.max(8, innerWidth - host.offsetWidth - 8))}px`;
  }
}

function close(): void {
  messageController?.abort();
  messageController = undefined;
  existingHost()?.remove();
}

function collapse(): void {
  const host = existingHost();
  if (!host?.shadowRoot) return;
  host.style.height = '38px';
  host.shadowRoot.querySelector('.shell')?.classList.add('collapsed');
  const button = host.shadowRoot.querySelector<HTMLButtonElement>('[data-action="collapse"]');
  if (button) {
    button.dataset.action = 'expand';
    button.title = 'Expand Margin';
    button.setAttribute('aria-label', 'Expand Margin');
    button.textContent = '□';
  }
  keepVisible(host);
}

function expand(): void {
  const host = existingHost();
  if (!host?.shadowRoot) return;
  host.style.height = 'min(780px,calc(100vh - 40px))';
  host.shadowRoot.querySelector('.shell')?.classList.remove('collapsed');
  const button = host.shadowRoot.querySelector<HTMLButtonElement>('[data-action="expand"]');
  if (button) {
    button.dataset.action = 'collapse';
    button.title = 'Collapse Margin';
    button.setAttribute('aria-label', 'Collapse Margin');
    button.textContent = '—';
  }
  requestAnimationFrame(() => keepVisible(host));
}

function mount(tabId: number): HTMLElement {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;top:20px;right:20px;width:min(410px,calc(100vw - 24px));height:min(780px,calc(100vh - 40px));z-index:2147483647;display:block;color-scheme:light;';
  const shadow = host.attachShadow({ mode: 'open' });
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  const frameUrl = chrome.runtime.getURL(`panel.html?embedded=1&tabId=${encodeURIComponent(String(tabId))}`);
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .shell { width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(20,35,26,.18);border-radius:18px;background:#f7f5ed;box-shadow:0 24px 70px rgba(9,18,12,.28),0 3px 14px rgba(9,18,12,.16);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .chrome { height:38px;flex:0 0 38px;display:flex;align-items:center;gap:8px;padding:0 9px 0 13px;background:#17241c;color:#f7f5ed;box-sizing:border-box;user-select:none; }
      .drag { min-width:0;flex:1;height:100%;display:flex;align-items:center;gap:8px;cursor:grab;touch-action:none; }
      .drag:active { cursor:grabbing; }
      .mark { width:17px;height:17px;border:1px solid rgba(255,255,255,.42);border-radius:5px;display:grid;place-items:center;font:600 12px/1 Georgia,serif;color:#f4a27e; }
      .title { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em; }
      .controls { display:flex;align-items:center;gap:3px; }
      button { appearance:none;border:0;width:28px;height:28px;border-radius:8px;background:transparent;color:#f7f5ed;display:grid;place-items:center;cursor:pointer;font:500 17px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      button:hover,button:focus-visible { background:rgba(255,255,255,.13);outline:none; }
      iframe { display:block;width:100%;min-height:0;flex:1;border:0;background:#f7f5ed; }
      .collapsed { height:38px; }
      .collapsed iframe { display:none; }
      @media (max-width:520px) { .shell { border-radius:14px; } }
    </style>
    <section class="shell" aria-label="Margin research assistant">
      <div class="chrome">
        <div class="drag" title="Drag Margin"><span class="mark">m</span><span class="title">Margin research</span></div>
        <div class="controls">
          <button type="button" data-action="collapse" title="Collapse Margin" aria-label="Collapse Margin">—</button>
          <button type="button" data-action="close" title="Close Margin" aria-label="Close Margin">×</button>
        </div>
      </div>
      <iframe title="Margin research assistant"></iframe>
    </section>`;
  const iframe = shadow.querySelector<HTMLIFrameElement>('iframe');
  if (!iframe) throw new Error('Margin could not create its assistant frame.');
  iframe.src = frameUrl;

  shadow.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'close') close();
    else if (button.dataset.action === 'collapse') collapse();
    else if (button.dataset.action === 'expand') expand();
  });

  const drag = shadow.querySelector<HTMLElement>('.drag');
  let start: { pointerId: number; x: number; y: number; left: number; top: number } | undefined;
  drag?.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const bounds = host.getBoundingClientRect();
    start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    host.style.left = `${bounds.left}px`;
    host.style.right = 'auto';
    drag.setPointerCapture(event.pointerId);
  });
  drag?.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.pointerId) return;
    const left = clamp(start.left + event.clientX - start.x, 8, Math.max(8, innerWidth - host.offsetWidth - 8));
    const top = clamp(start.top + event.clientY - start.y, 8, Math.max(8, innerHeight - host.offsetHeight - 8));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  });
  const finishDrag = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.pointerId) return;
    start = undefined;
    void chrome.storage.local.set({ overlayPosition: { left: Math.round(host.offsetLeft), top: Math.round(host.offsetTop) } satisfies OverlayPosition });
  };
  drag?.addEventListener('pointerup', finishDrag);
  drag?.addEventListener('pointercancel', finishDrag);

  messageController?.abort();
  messageController = new AbortController();
  globalThis.addEventListener('resize', () => keepVisible(host), { signal: messageController.signal });
  globalThis.addEventListener('message', event => {
    if (event.source !== iframe.contentWindow || event.origin !== extensionOrigin) return;
    const message = event.data as { source?: string; type?: string } | null;
    if (message?.source !== 'margin-panel') return;
    if (message.type === 'CLOSE') close();
    else if (message.type === 'COLLAPSE') collapse();
    else if (message.type === 'EXPAND') expand();
  }, { signal: messageController.signal });

  document.documentElement.append(host);
  void chrome.storage.local.get(POSITION_KEY).then(result => {
    const position = result[POSITION_KEY] as OverlayPosition | undefined;
    if (!position || !existingHost()) return;
    host.style.right = 'auto';
    host.style.left = `${clamp(position.left, 8, Math.max(8, innerWidth - host.offsetWidth - 8))}px`;
    host.style.top = `${clamp(position.top, 8, Math.max(8, innerHeight - host.offsetHeight - 8))}px`;
  });
  return host;
}

function open(tabId: number): void {
  const host = existingHost();
  if (host) {
    expand();
    return;
  }
  mount(tabId);
}

function toggle(tabId: number): void {
  const host = existingHost();
  if (!host) open(tabId);
  else if (host.shadowRoot?.querySelector('.shell')?.classList.contains('collapsed')) expand();
  else collapse();
}

(globalThis as typeof globalThis & { MarginOverlay?: OverlayApi }).MarginOverlay = { open, close, collapse, expand, toggle };
