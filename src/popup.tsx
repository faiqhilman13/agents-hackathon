import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Globe,
  Library,
  PanelRightOpen,
  Settings2,
  X,
} from "lucide-react";
import {
  api,
  extensionMessage,
  listTabs,
  openLibrary,
  status,
  type Tab,
} from "./api";
import type { Research } from "../shared/schema";
import { ErrorMessage, Logo, Spinner } from "./components";
import "./style.css";

function Popup() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [windowId, setWindowId] = useState<number>();
  const [count, setCount] = useState(0);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState("");
  const [paired, setPaired] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const [available, state, win] = await Promise.all([
          listTabs(),
          extensionMessage<{ connectionToken: string }>({
            type: "GET_EXTENSION_STATE",
          }),
          chrome.windows.getCurrent(),
        ]);
        setTabs(available);
        const selected =
          available.find((t) => t.selected) ||
          available.find((t) => t.active && t.windowId === win.id) ||
          available[0];
        setTabId(selected?.id);
        setWindowId(win.id);
        if (selected)
          await extensionMessage({ type: "SELECT_TAB", tabId: selected.id });
        setPaired(!!state.connectionToken);
        setSetup(!state.connectionToken);
        try {
          await status();
          setOnline(true);
          if (state.connectionToken)
            setCount(
              (await api<Research[]>("/research")).filter(
                (r) => r.status === "complete" && r.inLibrary !== false,
              ).length,
            );
        } catch (e) {
          if (state.connectionToken) setError((e as Error).message);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);
  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:4317/api/research", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Invalid connection code.");
      await extensionMessage({
        type: "SETTINGS",
        connectionToken: token.trim(),
      });
      setCount(
        data.filter(
          (r: Research) => r.status === "complete" && r.inLibrary !== false,
        ).length,
      );
      setPaired(true);
      setOnline(true);
      setSetup(false);
      setToken("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openAssistant() {
    setError("");
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setBusy(true);
    try {
      const pageUrl = new URL(tab.url);
      const nativePdf = /\.pdf$/i.test(pageUrl.pathname) ||
        (/(^|\.)arxiv\.org$/.test(pageUrl.hostname) && pageUrl.pathname.startsWith("/pdf/"));
      if (nativePdf) {
        // Chrome requires opening its native panel directly within this click.
        await chrome.sidePanel.open({ windowId: tab.windowId });
        window.close();
        return;
      }
      const allowed = await chrome.permissions.request({
        origins: [`${pageUrl.origin}/*`],
      });
      if (!allowed)
        throw new Error("Allow this site to open the floating assistant.");
      await extensionMessage({ type: "OPEN_ASSISTANT", tabId: tab.id });
      window.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="popup">
      <header className="popup-header">
        <Logo />
        <button
          className="icon-button"
          aria-label={setup ? "Close setup" : "Extension setup"}
          onClick={() => setSetup(!setup)}
        >
          {setup ? <X size={18} /> : <Settings2 size={18} />}
        </button>
      </header>
      {setup ? (
        <div className="popup-setup">
          <span className="eyebrow">A ONE-TIME HELLO</span>
          <h1>
            Meet your
            <br />
            research space.
          </h1>
          <p>
            Start the local Margin server, then open the library’s Settings to
            connect Exa + OpenRouter and copy your connection code.
          </p>
          <button
            className="button secondary full"
            onClick={() => openLibrary()}
          >
            Open research library <ArrowRight size={16} />
          </button>
          <form onSubmit={pair}>
            <label>
              Connection code
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                placeholder="Paste code from library settings"
                autoComplete="off"
                required
              />
            </label>
            <button
              className="button primary full"
              disabled={busy || !token.trim()}
            >
              {busy ? <Spinner /> : <Check size={16} />}Connect extension
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="popup-stat">
            <span>{String(count).padStart(2, "0")}</span>
            <div />
            <p>BRIEFS IN YOUR LIBRARY</p>
          </div>
          <div className="popup-selector">
            <label htmlFor="tab-select">START WITH AN OPEN TAB</label>
            <div className="select-wrap">
              <Globe size={16} />
              <select
                id="tab-select"
                value={tabId || ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setTabId(id);
                  void extensionMessage({
                    type: "SELECT_TAB",
                    tabId: id,
                  }).catch((e) => setError(e.message));
                }}
              >
                {tabs.length ? (
                  tabs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))
                ) : (
                  <option>No readable tabs open</option>
                )}
              </select>
            </div>
          </div>
          <button
            className="button primary full popup-open"
            onClick={openAssistant}
            disabled={!paired || !online || !tabId || busy}
          >
            <PanelRightOpen size={18} />
            Open assistant
          </button>
          <button
            className="button secondary full"
            onClick={() => openLibrary()}
          >
            <Library size={18} />
            Research library
            <ChevronRight size={16} />
          </button>
          <p className="popup-permission-note">
            Open a floating conversation beside your page.
            <br />
            Selected text gives your research a focus.
          </p>
        </>
      )}
      {error && <ErrorMessage text={error} />}
      <footer className="popup-footer">
        <span className={`status-dot ${online ? "ready" : ""}`} />
        {online ? "Local workspace connected" : "Start the server to connect"}
        <BookOpen size={14} />
      </footer>
    </div>
  );
}
document.body.classList.add("popup-page");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
