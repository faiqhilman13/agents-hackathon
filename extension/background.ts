import { arxivId, normalizeUrl, publicUrl, researchSchema, type Capture, type Research } from '../shared/schema';
import type {
  ExtensionError,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
  ExtensionTab,
  RailResearch,
  RailStatus,
  ResearchStarted,
  TabAccess,
} from './messages';

const API_ORIGIN = 'http://127.0.0.1:4317';
const LIBRARY_URL = `${API_ORIGIN}/`;
const STORAGE_KEYS = ['connectionToken', 'selectedTabId', 'latestResearchId', 'researchByTab', 'autoRead'] as const;
const RAIL_SCRIPT_ID = 'margin-rail';
const ALL_SITES = ['https://*/*', 'http://*/*'];
// Pages with less readable text than this (menus, search results, sign-in pages) are not researched automatically.
const AUTO_READ_MIN_CHARS = 600;

type StoredState = {
  connectionToken?: string;
  selectedTabId?: number;
  latestResearchId?: string;
  researchByTab?: Record<string, string>;
  // Auto-read is on by default once all-site access is granted; the popup can pause it.
  autoRead?: boolean;
};

type ExtractorGlobal = {
  extractPage(document: Document, pageUrl: string, selection?: string): Capture;
};

type OverlayGlobal = {
  open(tabId: number): void;
  close(): void;
  collapse(): void;
  expand(): void;
};

function failure(code: ExtensionError['code'], message: string, originPattern?: string): ExtensionResponse<never> {
  return { ok: false, error: { code, message, ...(originPattern ? { originPattern } : {}) } };
}

function originPattern(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/*`;
}

function isNativePdf(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function comparableUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}

async function storage(): Promise<StoredState> {
  return chrome.storage.local.get([...STORAGE_KEYS]) as Promise<StoredState>;
}

async function normalPublicTabs(): Promise<ExtensionTab[]> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const stored = await storage();
  return windows
    .flatMap((window) => window.tabs ?? [])
    .filter((tab): tab is chrome.tabs.Tab & { id: number; windowId: number; url: string } =>
      typeof tab.id === 'number' && typeof tab.windowId === 'number' && !!tab.url && publicUrl(tab.url),
    )
    .map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title?.trim() || new URL(tab.url).hostname,
      url: tab.url,
      ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      active: tab.active,
      selected: stored.selectedTabId === tab.id,
    }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.active) - Number(a.active) || a.windowId - b.windowId || a.index - b.index);
}

async function getPublicTab(tabId: number): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  if (!Number.isInteger(tabId) || tabId < 0) throw failureError('BAD_REQUEST', 'Choose a valid Chrome tab.');
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw failureError('TAB_NOT_FOUND', 'That tab is no longer open. Choose another tab.');
  }
  if (typeof tab.id !== 'number' || !tab.url || !publicUrl(tab.url)) {
    throw failureError('UNSUPPORTED_URL', 'Margin can read public http or https pages. Chrome pages, local files, and private network pages are not supported.');
  }
  const window = await chrome.windows.get(tab.windowId);
  if (window.type !== 'normal') throw failureError('UNSUPPORTED_URL', 'Choose a page from a normal Chrome window.');
  return tab as chrome.tabs.Tab & { id: number; url: string };
}

function failureError(code: ExtensionError['code'], message: string, pattern?: string): Error & { marginError: ExtensionError } {
  const error = new Error(message) as Error & { marginError: ExtensionError };
  error.marginError = { code, message, ...(pattern ? { originPattern: pattern } : {}) };
  return error;
}

async function accessForTab(tabId: number): Promise<TabAccess> {
  const tab = await getPublicTab(tabId);
  const pattern = originPattern(tab.url);
  return { allowed: await chrome.permissions.contains({ origins: [pattern] }), originPattern: pattern };
}

async function injectedCapture(tab: chrome.tabs.Tab & { id: number; url: string }): Promise<Capture> {
  const expectedUrl = tab.url;
  const pattern = originPattern(expectedUrl);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['extract.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const extractor = (globalThis as typeof globalThis & { MarginExtractor?: ExtractorGlobal }).MarginExtractor;
        if (!extractor) throw new Error('The page extractor did not load.');
        const pageUrl = location.href;
        const selection = globalThis.getSelection?.()?.toString() || '';
        return { pageUrl, capture: extractor.extractPage(document, pageUrl, selection) };
      },
    });
    const result = results[0]?.result as { pageUrl?: string; capture?: Capture } | undefined;
    if (!result?.capture || !result.pageUrl) throw failureError('EXTRACTION_FAILED', 'The page did not return readable content. Reload it and try again.');
    const current = await chrome.tabs.get(tab.id);
    if (!current.url || comparableUrl(result.pageUrl) !== comparableUrl(expectedUrl) || comparableUrl(current.url) !== comparableUrl(expectedUrl)) {
      throw failureError('TAB_NAVIGATED', 'The selected tab changed while Margin was reading it. Check the page and try again.');
    }
    if (!result.capture.text.trim()) {
      throw failureError('NO_READABLE_CONTENT', 'No readable article text was found. Expand the post or open the article page, then try again.');
    }
    return result.capture;
  } catch (error) {
    if (error instanceof Error && 'marginError' in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|cannot access|not allowed|missing host/i.test(message)) {
      throw failureError('PERMISSION_REQUIRED', 'Allow Margin to read this site, then try again.', pattern);
    }
    throw failureError('EXTRACTION_FAILED', `Margin could not read this page. ${message}`.slice(0, 500));
  }
}

async function captureTab(tabId: number): Promise<Capture> {
  const tab = await getPublicTab(tabId);
  const id = arxivId(tab.url);
  const arxivPdf = !!id && new URL(tab.url).pathname.startsWith('/pdf/');
  if (isNativePdf(tab.url) || arxivPdf) {
    if (!id) {
      throw failureError('PDF_UNSUPPORTED', 'Chrome does not expose trustworthy text from its PDF viewer. Open an HTML version or select text on a web page instead.');
    }
    return {
      url: tab.url,
      title: tab.title?.replace(/\s*-\s*Google Chrome$/, '').trim() || `arXiv ${id}`,
      text: '',
      selection: '',
      authors: [],
      description: '',
      capturedAt: new Date().toISOString(),
      coverage: 'unavailable',
      arxivId: id,
    };
  }
  return injectedCapture(tab);
}

async function controlAssistant(tabId: number, action: 'open' | 'close' | 'collapse' | 'expand'): Promise<{ surface: 'overlay' | 'sidePanel' }> {
  const tab = await getPublicTab(tabId);
  const id = arxivId(tab.url);
  const arxivPdf = !!id && new URL(tab.url).pathname.startsWith('/pdf/');
  if (action === 'open' && (isNativePdf(tab.url) || arxivPdf)) {
    return { surface: 'sidePanel' };
  }
  const pattern = originPattern(tab.url);
  try {
    const installed = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!(globalThis as typeof globalThis & { MarginOverlay?: OverlayGlobal }).MarginOverlay,
    });
    if (!installed[0]?.result) await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      args: [action, tabId] as const,
      func: (operation, owningTabId) => {
        const overlay = (globalThis as typeof globalThis & { MarginOverlay?: OverlayGlobal }).MarginOverlay;
        if (!overlay) throw new Error('The Margin overlay did not load.');
        if (operation === 'open') overlay.open(owningTabId);
        else overlay[operation]();
        return true;
      },
    });
    if (!result[0]?.result) throw new Error('The selected page did not accept the Margin overlay.');
    return { surface: 'overlay' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (action === 'open' && (isNativePdf(tab.url) || arxivPdf)) {
      return { surface: 'sidePanel' };
    }
    if (/permission|cannot access|not allowed|missing host/i.test(message)) {
      throw failureError('PERMISSION_REQUIRED', 'Allow Margin to show the assistant on this site, then try again.', pattern);
    }
    throw failureError('EXTRACTION_FAILED', `Margin could not show the assistant on this page. ${message}`.slice(0, 500));
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function serverStatus(): Promise<ExtensionState['server']> {
  try {
    const response = await fetchWithTimeout(`${API_ORIGIN}/api/status`, { cache: 'no-store' }, 2500);
    if (!response.ok) return { ok: false, error: `Local server returned ${response.status}.` };
    const body = await response.json() as { configured?: boolean };
    return { ok: true, ...(typeof body.configured === 'boolean' ? { configured: body.configured } : {}) };
  } catch {
    return { ok: false, error: 'Start Margin on this computer to research and open your library.' };
  }
}

async function enqueue(tabId: number, question = '', collection = 'Reading list', enrich = true): Promise<ResearchStarted> {
  const { connectionToken } = await storage();
  if (!connectionToken?.trim()) throw failureError('NOT_PAIRED', 'Paste the connection token from the local Margin library first.');
  return submitCapture(tabId, await captureTab(tabId), question, collection, enrich);
}

async function submitCapture(tabId: number, capture: Capture, question: string, collection: string, enrich: boolean): Promise<ResearchStarted> {
  const { connectionToken, researchByTab = {} } = await storage();
  if (!connectionToken?.trim()) throw failureError('NOT_PAIRED', 'Paste the connection token from the local Margin library first.');
  const input = researchSchema.parse({ requestId: crypto.randomUUID(), capture, question, collection, enrich });
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_ORIGIN}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connectionToken.trim()}` },
      body: JSON.stringify(input),
    }, 15000);
  } catch {
    throw failureError('SERVER_OFFLINE', 'Margin could not reach the local server at 127.0.0.1:4317. Start it and try again.');
  }
  const body = await response.json().catch(() => ({})) as Research | { error?: string };
  if (!response.ok) {
    const code = response.status === 401 ? 'NOT_PAIRED' : 'SERVER_ERROR';
    throw failureError(code, 'error' in body && body.error ? body.error : `The local server returned ${response.status}.`);
  }
  const research = body as Research;
  if (!research.id) throw failureError('SERVER_ERROR', 'The local server did not return a research job.');
  await chrome.storage.local.set({
    selectedTabId: tabId,
    latestResearchId: research.id,
    researchByTab: { ...researchByTab, [String(tabId)]: research.id },
  });
  return { research };
}

// ---------------------------------------------------------------------------
// Auto-read and the always-on rail
// ---------------------------------------------------------------------------
const autoReading = new Set<number>();
const skippedByTab = new Map<number, { url: string; reason: string }>();

function pageKey(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}

async function autoReadGranted(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ALL_SITES });
}

async function autoReadEnabled(): Promise<boolean> {
  const { autoRead } = await storage();
  return autoRead !== false && await autoReadGranted();
}

/** Keep the rail content script registered exactly when auto-read is on and all-site access is granted. */
async function syncRailScript(injectOpenTabs = false): Promise<void> {
  const enabled = await autoReadEnabled();
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [RAIL_SCRIPT_ID] })).length > 0;
  if (enabled && !registered) {
    await chrome.scripting.registerContentScripts([{
      id: RAIL_SCRIPT_ID, matches: ALL_SITES, js: ['overlay.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
    }]);
  } else if (!enabled && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [RAIL_SCRIPT_ID] });
  }
  if (enabled && injectOpenTabs) {
    // Tabs that were already open only get a newly registered content script after a reload.
    for (const tab of await normalPublicTabs()) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] }).catch(() => undefined);
    }
  }
}

async function apiRequest<T>(path: string): Promise<{ status: number; body?: T }> {
  const { connectionToken } = await storage();
  const response = await fetchWithTimeout(`${API_ORIGIN}/api${path}`, {
    headers: { Authorization: `Bearer ${connectionToken?.trim() || ''}` },
    cache: 'no-store',
  }, 8000);
  return { status: response.status, body: await response.json().catch(() => undefined) as T | undefined };
}

function senderTab(sender: chrome.runtime.MessageSender): chrome.tabs.Tab & { id: number; url: string } {
  const tab = sender.tab;
  if (!tab || typeof tab.id !== 'number' || !tab.url || !publicUrl(tab.url) || sender.frameId !== 0) {
    throw failureError('UNSUPPORTED_URL', 'Margin shows its rail on public http and https pages only.');
  }
  return tab as chrome.tabs.Tab & { id: number; url: string };
}

async function railBasics(tabId: number): Promise<RailStatus> {
  const { connectionToken } = await storage();
  return { tabId, autoRead: await autoReadEnabled(), paired: !!connectionToken?.trim(), online: (await serverStatus()).ok };
}

function summarize(research: Research): RailResearch {
  return {
    id: research.id,
    status: research.status,
    progress: research.progress,
    stage: research.stage,
    hasBrief: !!research.brief,
    picks: research.picks?.length ?? 0,
    related: research.sources.filter(source => source.kind === 'related').length,
    fromHistory: research.sources.some(source => source.fromHistory),
    bridge: !!research.bridge,
  };
}

/** The research shown for a tab: its mapped record if the URL still matches, else the latest record for that page. */
async function researchForTab(tab: chrome.tabs.Tab & { id: number; url: string }): Promise<Research | undefined> {
  const { researchByTab = {} } = await storage();
  const mapped = researchByTab[String(tab.id)];
  if (mapped) {
    const { status, body } = await apiRequest<Research>(`/research/${encodeURIComponent(mapped)}`);
    if (status === 200 && body && pageKey(body.input.capture.url) === pageKey(tab.url)) return body;
  }
  const { status, body } = await apiRequest<Research>(`/research/by-url?url=${encodeURIComponent(tab.url)}`);
  if (status !== 200 || !body) return undefined;
  await chrome.storage.local.set({ researchByTab: { ...researchByTab, [String(tab.id)]: body.id } });
  return body;
}

async function railStatus(sender: chrome.runtime.MessageSender): Promise<RailStatus> {
  const tab = senderTab(sender);
  const basics = await railBasics(tab.id);
  if (!basics.paired || !basics.online) return basics;
  const research = await researchForTab(tab).catch(() => undefined);
  if (research) return { ...basics, research: summarize(research) };
  const skipped = skippedByTab.get(tab.id);
  return skipped && skipped.url === pageKey(tab.url) ? { ...basics, skipped: skipped.reason } : basics;
}

/** Research the sender's page if it is the active tab, auto-read is on, and the page has not been read yet. */
async function autoRead(sender: chrome.runtime.MessageSender): Promise<RailStatus> {
  const tab = senderTab(sender);
  const basics = await railBasics(tab.id);
  if (!basics.autoRead || !basics.paired || !basics.online || !tab.active || autoReading.has(tab.id)) return railStatus(sender);
  if (isNativePdf(tab.url)) return { ...basics, skipped: 'Open Margin from the toolbar to read PDFs.' };
  autoReading.add(tab.id);
  try {
    const existing = await researchForTab(tab).catch(() => undefined);
    if (existing) return { ...basics, research: summarize(existing) };
    const capture = await captureTab(tab.id);
    if (capture.coverage !== 'unavailable' && capture.text.trim().length < AUTO_READ_MIN_CHARS) {
      const reason = 'This page is too short to research automatically. Open the brief to start it yourself.';
      skippedByTab.set(tab.id, { url: pageKey(tab.url), reason });
      return { ...basics, skipped: reason };
    }
    const { research } = await submitCapture(tab.id, capture, '', 'Reading list', true);
    skippedByTab.delete(tab.id);
    return { ...basics, research: summarize(research) };
  } catch (error) {
    const response = parseError(error);
    const reason = 'error' in response ? response.error.message : 'Margin could not read this page automatically.';
    skippedByTab.set(tab.id, { url: pageKey(tab.url), reason });
    return { ...basics, skipped: reason };
  } finally {
    autoReading.delete(tab.id);
  }
}

function parseError(error: unknown): ExtensionResponse<never> {
  if (error && typeof error === 'object' && 'marginError' in error) {
    return { ok: false, error: (error as { marginError: ExtensionError }).marginError };
  }
  if (error && typeof error === 'object' && 'issues' in error) {
    return failure('BAD_REQUEST', 'Check the research question and collection, then try again.');
  }
  return failure('SERVER_ERROR', error instanceof Error ? error.message : 'Margin could not complete that request.');
}

async function handleMessage(message: ExtensionRequest, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return failure('BAD_REQUEST', 'Margin received an invalid request.');
  switch (message.type) {
    case 'LIST_TABS':
      return { ok: true, tabs: await normalPublicTabs() };
    case 'SELECT_TAB': {
      const tab = await getPublicTab(message.tabId);
      await chrome.storage.local.set({ selectedTabId: tab.id });
      return { ok: true, selectedTabId: tab.id };
    }
    case 'GET_TAB_ACCESS':
      return { ok: true, ...(await accessForTab(message.tabId)) };
    case 'OPEN_ASSISTANT':
      return { ok: true, ...(await controlAssistant(message.tabId, 'open')) };
    case 'CLOSE_ASSISTANT':
      return { ok: true, ...(await controlAssistant(message.tabId, 'close')) };
    case 'COLLAPSE_ASSISTANT':
      return { ok: true, ...(await controlAssistant(message.tabId, 'collapse')) };
    case 'EXPAND_ASSISTANT':
      return { ok: true, ...(await controlAssistant(message.tabId, 'expand')) };
    case 'CAPTURE_AND_RESEARCH':
      return { ok: true, ...(await enqueue(message.tabId, message.question, message.collection, message.enrich)) };
    case 'OPEN_LIBRARY': {
      const url = message.researchId ? `${LIBRARY_URL}?brief=${encodeURIComponent(message.researchId)}` : LIBRARY_URL;
      await chrome.tabs.create({ url, active: true });
      return { ok: true, url };
    }
    case 'GET_EXTENSION_STATE': {
      const state = await storage();
      return {
        ok: true,
        selectedTabId: state.selectedTabId,
        latestResearchId: state.latestResearchId,
        researchByTab: state.researchByTab || {},
        connectionToken: state.connectionToken || '',
        server: await serverStatus(),
        autoRead: await autoReadEnabled(),
        autoReadGranted: await autoReadGranted(),
      } satisfies ExtensionResponse<ExtensionState>;
    }
    case 'SET_AUTO_READ': {
      if (message.enabled && !(await autoReadGranted())) {
        return failure('PERMISSION_REQUIRED', 'Allow Margin to read the sites you visit, then turn on auto-read.', ALL_SITES[0]);
      }
      await chrome.storage.local.set({ autoRead: !!message.enabled });
      await syncRailScript(!!message.enabled);
      return { ok: true, autoRead: await autoReadEnabled() };
    }
    case 'RAIL_READY':
      return { ok: true, ...(await railBasics(senderTab(sender).id)) };
    case 'RAIL_AUTO_READ':
      return { ok: true, ...(await autoRead(sender)) };
    case 'RAIL_STATUS':
      return { ok: true, ...(await railStatus(sender)) };
    case 'SETTINGS': {
      if (typeof message.connectionToken !== 'string') return failure('BAD_REQUEST', 'Enter a valid connection token.');
      const connectionToken = message.connectionToken.trim();
      await chrome.storage.local.set({ connectionToken });
      return { ok: true, connectionToken };
    }
    default:
      return failure('BAD_REQUEST', 'Margin received an unknown request.');
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionRequest, sender, sendResponse: (response: ExtensionResponse) => void) => {
  void handleMessage(message, sender).then(sendResponse, (error) => sendResponse(parseError(error)));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void syncRailScript(true);
});
chrome.runtime.onStartup.addListener(() => void syncRailScript());
// Granting or revoking all-site access in Chrome's own settings turns the rail on or off.
chrome.permissions.onAdded.addListener(() => void syncRailScript(true));
chrome.permissions.onRemoved.addListener(() => void syncRailScript());
