import type { Research } from '../shared/schema';

export type ExtensionTab = {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  selected: boolean;
};

export type ExtensionErrorCode =
  | 'BAD_REQUEST'
  | 'TAB_NOT_FOUND'
  | 'UNSUPPORTED_URL'
  | 'PERMISSION_REQUIRED'
  | 'TAB_NAVIGATED'
  | 'PDF_UNSUPPORTED'
  | 'EXTRACTION_FAILED'
  | 'NO_READABLE_CONTENT'
  | 'SERVER_OFFLINE'
  | 'NOT_PAIRED'
  | 'SERVER_ERROR';

export type ExtensionError = {
  code: ExtensionErrorCode;
  message: string;
  originPattern?: string;
};

export type ExtensionRequest =
  | { type: 'LIST_TABS' }
  | { type: 'SELECT_TAB'; tabId: number }
  | { type: 'GET_TAB_ACCESS'; tabId: number }
  | { type: 'OPEN_ASSISTANT'; tabId: number }
  | { type: 'CLOSE_ASSISTANT' | 'COLLAPSE_ASSISTANT' | 'EXPAND_ASSISTANT'; tabId: number }
  | { type: 'CAPTURE_AND_RESEARCH'; tabId: number; question?: string; collection?: string; enrich?: boolean }
  | { type: 'OPEN_LIBRARY'; researchId?: string }
  | { type: 'GET_EXTENSION_STATE' }
  | { type: 'SETTINGS'; connectionToken: string }
  // Auto-read: the popup grants all-site access with one click, then turns the rail on everywhere.
  | { type: 'SET_AUTO_READ'; enabled: boolean }
  // Sent by the rail content script; the background identifies the tab from the sender.
  | { type: 'RAIL_READY' }
  | { type: 'RAIL_AUTO_READ' }
  | { type: 'RAIL_STATUS' };

export type RailResearch = {
  id: string;
  status: Research['status'];
  progress: number;
  stage: string;
  hasBrief: boolean;
  picks: number;
  related: number;
  fromHistory: boolean;
  bridge: boolean;
};

export type RailStatus = {
  tabId: number;
  autoRead: boolean;
  paired: boolean;
  online: boolean;
  research?: RailResearch;
  // Set when the page could not be read automatically (too short, unsupported, or a server error).
  skipped?: string;
};

export type ExtensionResponse<T extends object = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: ExtensionError };

export type ExtensionState = {
  selectedTabId?: number;
  latestResearchId?: string;
  researchByTab?: Record<string, string>;
  connectionToken: string;
  server: { ok: boolean; configured?: boolean; error?: string };
  autoRead: boolean;
  autoReadGranted: boolean;
};

export type TabAccess = {
  allowed: boolean;
  originPattern: string;
};

export type ResearchStarted = { research: Research };
