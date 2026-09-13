import { useEffect, useState } from "react";
import { ArrowUpRight, Check, KeyRound, Plug, X } from "lucide-react";
import { api, connectionToken } from "./api";
import { CopyButton, ErrorMessage, Spinner } from "./components";

export function Settings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<{
    exa: boolean;
    llm: boolean;
    model: string;
    llmBaseUrl: string;
  }>();
  const [token, setToken] = useState("");
  const [exa, setExa] = useState("");
  const [llm, setLlm] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-v4-flash-0731");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void Promise.all([api<typeof settings>("/settings"), connectionToken()])
      .then(([s, t]) => {
        setSettings(s);
        setModel(s?.model || "deepseek/deepseek-v4-flash-0731");
        setToken(t);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api<NonNullable<typeof settings>>("/settings", "POST", {
        ...(exa.trim() ? { exaKey: exa.trim() } : {}),
        ...(llm.trim() ? { llmKey: llm.trim() } : {}),
        model,
        llmBaseUrl: "https://openrouter.ai/api/v1",
      });
      setSettings(s);
      setExa("");
      setLlm("");
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="settings-title">Connect the dots.</h2>
        <p className="muted">
          Connect Exa for search and OpenRouter for the thinking. Keys stay on
          your local server.
        </p>
        {error && <ErrorMessage text={error} />}
        <form onSubmit={save}>
          <label>
            Exa API key{" "}
            <span
              className={`connection-state ${settings?.exa ? "connected" : ""}`}
            >
              {settings?.exa ? "Configured" : "Not connected"}
            </span>
            <input
              type="password"
              value={exa}
              onChange={(e) => {
                setExa(e.target.value);
                setSaved(false);
              }}
              placeholder={
                settings?.exa
                  ? "Enter a new key to replace the saved key"
                  : "Your Exa API key"
              }
              autoComplete="new-password"
            />
          </label>
          <label>
            OpenRouter API key{" "}
            <span
              className={`connection-state ${settings?.llm ? "connected" : ""}`}
            >
              {settings?.llm ? "Configured" : "Not connected"}
            </span>
            <input
              type="password"
              value={llm}
              onChange={(e) => {
                setLlm(e.target.value);
                setSaved(false);
              }}
              placeholder={
                settings?.llm
                  ? "Enter a new key to replace the saved key"
                  : "sk-or-v1-…"
              }
              autoComplete="new-password"
            />
          </label>
          <label>
            OpenRouter model
            <input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setSaved(false);
              }}
              required
              placeholder="deepseek/deepseek-v4-flash-0731"
            />
          </label>
          <div className="row between">
            <span className="fine-print">
              Each brief uses up to two Exa searches.
              <br />
              Provider usage is billed to your accounts.
            </span>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : saved ? (
                <Check size={16} />
              ) : (
                <KeyRound size={16} />
              )}{" "}
              {saved ? "Saved" : "Save connections"}
            </button>
          </div>
        </form>
        <div className="pairing-box">
          <div className="row">
            <Plug size={18} />
            <h3>Pair your Chrome extension</h3>
          </div>
          <p>
            Load <code>dist/extension</code> as an unpacked extension, then
            paste this connection code into the extension’s setup screen.
          </p>
          <div className="row between">
            <code className="token-preview">
              {token
                ? `${token.slice(0, 9)}••••••••${token.slice(-5)}`
                : "Loading…"}
            </code>
            <CopyButton value={token} label="Copy code" />
          </div>
        </div>
        <a
          className="external-help"
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
        >
          OpenRouter API keys <ArrowUpRight size={13} />
        </a>
        <a
          className="external-help"
          href="https://dashboard.exa.ai/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Exa API keys <ArrowUpRight size={13} />
        </a>
      </section>
    </div>
  );
}
