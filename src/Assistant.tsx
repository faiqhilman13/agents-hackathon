import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe,
  Library,
  MessageSquare,
  PanelRightClose,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { normalizeUrl, type Research } from "../shared/schema";
import {
  api,
  domain,
  extensionMessage,
  isExtension,
  listTabs,
  openLibrary,
  startResearch,
  type Tab,
} from "./api";
import {
  citesHistory,
  ErrorMessage,
  HistoryNotes,
  Logo,
  Progress,
  SourceCitations,
  Spinner,
} from "./components";
import { AskView, SourcesView, ThinkingCard } from "./Layers";

const embedded = new URLSearchParams(location.search).has("embedded");
const embeddedTabId =
  Number(new URLSearchParams(location.search).get("tabId")) || undefined;
// The rail's three circles open the panel on one of these views.
type View = "sources" | "brief" | "ask";
const VIEWS: View[] = ["sources", "brief", "ask"];
const requestedView = new URLSearchParams(location.search).get("view");
const initialView: View = VIEWS.includes(requestedView as View)
  ? (requestedView as View)
  : "brief";

export function Assistant() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [item, setItem] = useState<Research>();
  const [text, setText] = useState("");
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);
  const [showTabs, setShowTabs] = useState(false);
  const [view, setView] = useState<View>(initialView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemId = useRef<string | undefined>(undefined);
  const lastTab = useRef<number | undefined>(undefined);
  const activeTab = tabs.find((t) => t.id === tabId);
  const working = !!item && ["queued", "running"].includes(item.status);
  async function restoreForTab(id: number) {
    try {
      const state = (await chrome.storage.local.get([
        "researchByTab",
        "latestResearchId",
      ])) as {
        researchByTab?: Record<string, string>;
        latestResearchId?: string;
      };
      const researchId =
        state.researchByTab?.[String(id)] || state.latestResearchId;
      if (!researchId) return;
      const [r, t] = await Promise.all([
        api<Research>(`/research/${researchId}`),
        chrome.tabs.get(id),
      ]);
      if (
        lastTab.current === id &&
        t.url &&
        normalizeUrl(r.input.capture.url) === normalizeUrl(t.url)
      ) {
        itemId.current = r.id;
        setItem(r);
      }
    } catch {
      /* no saved conversation for this page */
    }
  }
  async function newConversation() {
    setItem(undefined);
    itemId.current = undefined;
    setText("");
    setError("");
    if (isExtension) {
      const state = (await chrome.storage.local.get("researchByTab")) as {
        researchByTab?: Record<string, string>;
      };
      const mapping = { ...state.researchByTab };
      if (tabId !== undefined) delete mapping[String(tabId)];
      await chrome.storage.local.set({ researchByTab: mapping });
      await chrome.storage.local.remove("latestResearchId");
    }
  }
  async function refreshTabs() {
    if (!isExtension) return;
    try {
      const available = await listTabs();
      setTabs(available);
      setTabId(
        (current) =>
          embeddedTabId ||
          (available.some((t) => t.id === current)
            ? current
            : (
                available.find((t) => t.selected) ||
                available.find((t) => t.active) ||
                available[0]
              )?.id),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!isExtension) {
      setBooting(false);
      return;
    }
    void (async () => {
      try {
        await refreshTabs();
        const state = await extensionMessage<{
          latestResearchId?: string;
          selectedTabId?: number;
        }>({ type: "GET_EXTENSION_STATE" });
        const selected = embeddedTabId || state.selectedTabId;
        if (selected) {
          setTabId(selected);
          lastTab.current = selected;
          await restoreForTab(selected);
        }
      } finally {
        setBooting(false);
      }
    })();
    const storage = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes.selectedTabId && !embedded) {
        const id = changes.selectedTabId.newValue as number;
        setTabId(id);
        if (lastTab.current !== id) {
          setItem(undefined);
          itemId.current = undefined;
        }
        lastTab.current = id;
        void restoreForTab(id);
      }
      if (changes.latestResearchId?.newValue && lastTab.current !== undefined)
        void restoreForTab(lastTab.current);
      // Auto-read creates research in the background; pick it up as soon as it is mapped to this tab.
      if (changes.researchByTab && lastTab.current !== undefined && !itemId.current)
        void restoreForTab(lastTab.current);
    };
    chrome.storage.onChanged.addListener(storage);
    const timer = setInterval(() => {
      void refreshTabs();
      if (!itemId.current && lastTab.current !== undefined)
        void restoreForTab(lastTab.current);
      const id = itemId.current;
      if (id)
        void api<Research>(`/research/${id}`)
          .then((r) => {
            if (itemId.current === id) setItem(r);
          })
          .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      chrome.storage.onChanged.removeListener(storage);
    };
  }, []);
  useEffect(() => {
    if (
      activeTab &&
      item &&
      normalizeUrl(activeTab.url) !== normalizeUrl(item.input.capture.url)
    ) {
      setItem(undefined);
      itemId.current = undefined;
    }
  }, [activeTab?.url]);
  useEffect(() => {
    // The rail on the page switches views when one of its three circles is clicked.
    const receive = (event: MessageEvent) => {
      if (event.source !== parent) return;
      const message = event.data as { source?: string; type?: string; view?: string } | null;
      if (
        message?.source === "margin-rail" &&
        message.type === "VIEW" &&
        VIEWS.includes(message.view as View)
      )
        setView(message.view as View);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  function switchView(next: View) {
    setView(next);
    if (embedded)
      parent.postMessage(
        { source: "margin-panel", type: "VIEW_CHANGED", view: next },
        "*",
      );
  }
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [item?.messages?.length, item?.status, pending]);
  async function saveBrief() {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      setItem(
        await api<Research>(`/research/${item.id}`, "PATCH", {
          inLibrary: true,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function choose(id: number) {
    setTabId(id);
    setItem(undefined);
    itemId.current = undefined;
    lastTab.current = id;
    setShowTabs(false);
    try {
      await extensionMessage({ type: "SELECT_TAB", tabId: id });
      await restoreForTab(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function begin(question: string, useExa = enrich) {
    if (!activeTab) {
      setError("Choose a readable Chrome tab first.");
      return;
    }
    setError("");
    setBusy(true);
    setPending(question || "Research this page");
    // startResearch requests site access immediately while this click still has a user gesture.
    try {
      const r = await startResearch(activeTab, question, useExa);
      itemId.current = r.id;
      setItem(r);
      setText("");
      // Let the rail update its circles right away instead of waiting for its next poll.
      if (embedded)
        parent.postMessage({ source: "margin-panel", type: "REFRESH" }, "*");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPending("");
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy || working) return;
    if (!item || item.status !== "complete") {
      await begin(message);
      return;
    }
    setBusy(true);
    setPending(message);
    setText("");
    setError("");
    try {
      setItem(
        await api<Research>(`/research/${item.id}/chat`, "POST", { message }),
      );
    } catch (e) {
      setError((e as Error).message);
      setText(message);
    } finally {
      setBusy(false);
      setPending("");
    }
  }
  async function collapse() {
    if (embedded) {
      parent.postMessage({ source: "margin-panel", type: "COLLAPSE" }, "*");
      return;
    }
    if (isExtension) {
      try {
        const win = await chrome.windows.getCurrent();
        const panel = chrome.sidePanel as typeof chrome.sidePanel & {
          close?: (options: { windowId: number }) => Promise<void>;
        };
        if (panel.close && win.id) await panel.close({ windowId: win.id });
        else window.close();
      } catch {
        window.close();
      }
    }
  }
  return (
    <div className={`assistant ${embedded ? "embedded-assistant" : ""}`}>
      <header className="assistant-header">
        <Logo small />
        <div className="row">
          <button
            className="icon-button"
            title="Research library"
            aria-label="Open research library"
            onClick={() => openLibrary()}
          >
            <Library size={18} />
          </button>
          <button
            className="icon-button"
            title="Start a new conversation"
            aria-label="New conversation"
            onClick={() => void newConversation()}
          >
            <Plus size={18} />
          </button>
          <button
            className="icon-button"
            title="Collapse assistant"
            aria-label="Collapse assistant"
            onClick={collapse}
          >
            <PanelRightClose size={18} />
          </button>
        </div>
      </header>
      <div className="assistant-context">
        <div className="row between">
          <span className="eyebrow">IN YOUR CONTEXT</span>
          <button
            className="text-button"
            hidden={embedded}
            onClick={() => setShowTabs(!showTabs)}
          >
            Change tab <ChevronDown size={12} />
          </button>
        </div>
        {showTabs && (
          <select
            className="panel-tab-select"
            aria-label="Select page to research"
            value={tabId || ""}
            onChange={(e) => void choose(Number(e.target.value))}
          >
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <div className="context-page">
          <span className="context-icon">
            <Globe size={18} />
          </span>
          <div>
            <strong>{activeTab?.title || "Your current page"}</strong>
            <span>
              {activeTab
                ? domain(activeTab.url)
                : "Choose a tab from the extension"}
            </span>
          </div>
          <span className="context-indicator" />
        </div>
      </div>
      <nav className="view-tabs" aria-label="Margin views">
        {(
          [
            ["sources", "Sources", <Search key="sources" size={15} />],
            ["brief", "Brief", <FileText key="brief" size={15} />],
            ["ask", "Ask", <MessageSquare key="ask" size={15} />],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            className={view === value ? "active" : ""}
            aria-pressed={view === value}
            onClick={() => switchView(value)}
          >
            <span className="view-orb">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className="assistant-scroll" ref={scrollRef}>
        {view === "sources" ? (
          <SourcesView
            item={item}
            working={working}
            busy={busy}
            onStart={() => void begin("", true)}
          />
        ) : view === "ask" ? (
          <AskView />
        ) : booting ? (
          <div className="assistant-loading">
            <Spinner />
            Opening your workspace…
          </div>
        ) : !item && !pending ? (
          <div className="assistant-welcome">
            <span className="assistant-symbol">
              <Sparkles size={24} />
            </span>
            <span className="eyebrow">FOLLOW YOUR CURIOSITY</span>
            <h1>
              There’s more
              <br />
              in the margin.
            </h1>
            <p>
              Ask about this page. Find the missing context. Connect it to
              something you already know.
            </p>
            <div className="suggested-actions">
              <button
                onClick={() =>
                  void begin(
                    "Create a research brief with useful supporting evidence, related ideas, and relevant counterpoints.",
                    true,
                  )
                }
                disabled={!activeTab || busy}
              >
                <Search size={17} />
                <span>
                  <strong>Research this page</strong>
                  <small>Go further with Exa search</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <button
                onClick={() =>
                  void begin(
                    "Explain the key ideas in this page or selected passage in plain language.",
                    false,
                  )
                }
                disabled={!activeTab || busy}
              >
                <BookOpen size={17} />
                <span>
                  <strong>Help me understand</strong>
                  <small>Start with the original content</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <button
                onClick={() =>
                  setText("How does this connect to my saved research?")
                }
              >
                <LinkIcon />
                <span>
                  <strong>Connect the dots</strong>
                  <small>Ask about your saved research</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="selection-hint">
              <span />
              Tip: highlight a passage on the page to focus your research.
            </div>
          </div>
        ) : (
          <div className="conversation">
            {item?.input.question && (
              <div className="chat-message user">
                <span className="chat-author">You</span>
                <p>{item.input.question}</p>
              </div>
            )}
            {working && item && (
              <div className="chat-message assistant-message">
                <Logo small />
                <Progress
                  item={item}
                  onCancel={() =>
                    void api(`/research/${item.id}/cancel`, "POST")
                      .then(() => api<Research>(`/research/${item.id}`))
                      .then(setItem)
                      .catch((e) => setError(e.message))
                  }
                />
              </div>
            )}
            {item && ["failed", "cancelled"].includes(item.status) && (
              <div className="chat-message assistant-message">
                <p>
                  {item.error ||
                    "Research cancelled. Your page capture is saved."}
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    void api<Research>(`/research/${item.id}/retry`, "POST")
                      .then(setItem)
                      .catch((e) => setError(e.message))
                  }
                >
                  Retry research
                </button>
              </div>
            )}
            {item?.brief && (
              <div className="chat-message assistant-message">
                <span className="chat-author">
                  <span className="mini-mark">m</span>Margin
                </span>
                <p>
                  {item.brief.overview.text}
                  <SourceCitations
                    ids={item.brief.overview.sourceIds}
                    sources={item.sources}
                  />
                </p>
                {item.brief.takeaways.slice(0, 3).map((f, i) => (
                  <div className="panel-takeaway" key={i}>
                    <span>{i + 1}</span>
                    <p>
                      {f.text}
                      <SourceCitations
                        ids={f.sourceIds}
                        sources={item.sources}
                      />
                    </p>
                  </div>
                ))}
                {item.brief.connections.length > 0 && (
                  <div className="panel-connections">
                    <span className="eyebrow">A LITTLE MORE CONTEXT</span>
                    {item.brief.connections.slice(0, 2).map((c, i) => (
                      <div
                        key={i}
                        className={
                          citesHistory(c.sourceIds, item.sources)
                            ? "history"
                            : undefined
                        }
                      >
                        <strong>{c.title}</strong>
                        <HistoryNotes ids={c.sourceIds} sources={item.sources} />
                        <p>
                          {c.text}
                          <SourceCitations
                            ids={c.sourceIds}
                            sources={item.sources}
                          />
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {item.warnings.map((w) => (
                  <p className="panel-warning" key={w}>
                    {w}
                  </p>
                ))}
                <button
                  className="saved-brief-card"
                  disabled={busy}
                  onClick={() =>
                    item.inLibrary === false
                      ? void saveBrief()
                      : openLibrary(item.id)
                  }
                >
                  <span>
                    {item.inLibrary === false ? (
                      <Plus size={20} />
                    ) : (
                      <Check size={20} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {item.inLibrary === false
                        ? "Add to library"
                        : "Saved in your library"}
                    </strong>
                    <small>
                      {item.sources.length} sources ·{" "}
                      {item.inLibrary === false
                        ? "Keep this brief and its conversation"
                        : item.collection}
                    </small>
                  </div>
                  <ArrowUpRight size={18} />
                </button>
                <div className="agent-tools">
                  <button
                    onClick={() =>
                      setText(
                        "Why does this brief describe the findings this way? Explain the wording and point to the source evidence.",
                      )
                    }
                  >
                    <MessageSquare size={13} />
                    Explain this brief
                  </button>
                  <button
                    onClick={() =>
                      setText(
                        "Find more web evidence and relevant counterpoints for this brief.",
                      )
                    }
                  >
                    <Search size={13} />
                    Find more sources
                  </button>
                  <button onClick={() => openLibrary(item.id)}>
                    <FileText size={13} />
                    View full brief
                  </button>
                </div>
                {item.status === "complete" && item.mode !== "demo" && (
                  <ThinkingCard item={item} onItem={setItem} />
                )}
                {item.brief.questions.length > 0 && !item.messages?.length && (
                  <div className="followup-prompts">
                    {item.brief.questions.slice(0, 2).map((q) => (
                      <button key={q} onClick={() => setText(q)}>
                        {q}
                        <ArrowRight size={13} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {item?.messages?.map((m, i) => (
              <div
                key={i}
                className={`chat-message ${m.role === "user" ? "user" : "assistant-message"}`}
              >
                <span className="chat-author">
                  {m.role === "user" ? "You" : "Margin"}
                </span>
                <p>
                  {m.text}
                  <SourceCitations
                    ids={m.sourceIds || []}
                    sources={item.sources}
                  />
                </p>
              </div>
            ))}
            {pending && (
              <>
                <div className="chat-message user">
                  <span className="chat-author">You</span>
                  <p>{pending}</p>
                </div>
                <div className="chat-thinking">
                  <Spinner />
                  Following the evidence…
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {view === "brief" && (
      <div className="assistant-bottom">
        {error && <ErrorMessage text={error} onClose={() => setError("")} />}
        <form className="composer" onSubmit={send}>
          <textarea
            aria-label="Ask Margin"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              item?.status === "complete"
                ? "Ask why, find sources, or save this brief…"
                : "What would you like to understand?"
            }
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="row between">
            <span className="composer-context">
              <FileText size={12} />
              {item ? "Research context" : "Selected page"}
            </span>
            <div className="row">
              {item?.status === "complete" ? (
                <span className="composer-context">Exa on request</span>
              ) : (
                <label className="exa-toggle">
                  <input
                    type="checkbox"
                    checked={enrich}
                    onChange={(e) => setEnrich(e.target.checked)}
                  />
                  <span>Exa search</span>
                </label>
              )}
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                disabled={
                  !text.trim() || busy || working || (!activeTab && !item)
                }
              >
                {busy ? <Spinner /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
        </form>
        <p className="assistant-footnote">
          Grounded in sources. Guided by you.
        </p>
      </div>
      )}
    </div>
  );
}
function LinkIcon() {
  return <MessageSquare size={17} />;
}
