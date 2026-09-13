import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  FileText,
  Folder,
  Library,
  Link2,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { Research } from "../shared/schema";
import { api, domain, exportBrief, status } from "./api";
import {
  EmptyIllustration,
  ErrorMessage,
  citesHistory,
  HistoryNotes,
  Logo,
  Progress,
  SourceCard,
  SourceCitations,
  Spinner,
} from "./components";
import { Settings } from "./Settings";

export function App() {
  const [items, setItems] = useState<Research[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(
    new URLSearchParams(location.search).get("brief"),
  );
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("newest");
  const [showSettings, setShowSettings] = useState(false);
  const [captureHelp, setCaptureHelp] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{
    exa: boolean;
    llm: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  async function refresh() {
    try {
      const data = await api<Research[]>("/research");
      setItems(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function refreshStatus() {
    try {
      setProviderStatus(await status());
    } catch {
      /* error presented on API refresh */
    }
  }
  useEffect(() => {
    void refresh();
    void refreshStatus();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    selected
      ? url.searchParams.set("brief", selected)
      : url.searchParams.delete("brief");
    history.replaceState(null, "", url);
  }, [selected]);
  const libraryItems = items.filter((i) => i.inLibrary !== false);
  const collections = [...new Set(libraryItems.map((i) => i.collection))];
  const allTags = [
    ...new Set(libraryItems.flatMap((i) => i.brief?.tags || [])),
  ];
  const complete = libraryItems.filter((i) => i.status === "complete");
  const filtered = useMemo(
    () =>
      items
        .filter((i) => i.inLibrary !== false)
        .filter(
          (i) =>
            (filter === "all" || filter === "starred"
              ? filter !== "starred" || i.favorite
              : i.collection === filter) &&
            (!tag || i.brief?.tags.includes(tag)) &&
            (!query ||
              [
                i.input.capture.title,
                i.brief?.overview.text,
                i.notes,
                i.collection,
                ...(i.brief?.tags || []),
                ...i.sources.map((s) => s.text),
                ...(i.messages || []).map((m) => m.text),
              ]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.input.capture.title.localeCompare(b.input.capture.title)
            : sort === "oldest"
              ? a.createdAt.localeCompare(b.createdAt)
              : b.createdAt.localeCompare(a.createdAt),
        ),
    [items, filter, query, sort, tag],
  );
  const current = items.find((i) => i.id === selected);
  async function mutate(path: string, method = "POST", body?: unknown) {
    try {
      await api(path, method, body);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadDemo() {
    setBusy(true);
    try {
      const item = await api<Research>("/demo", "POST");
      await refresh();
      setSelected(item.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseFilter(value: string) {
    setFilter(value);
    setSelected(null);
    setTag("");
  }
  return (
    <div className="workspace">
      <aside className="navigation">
        <a
          href="/"
          className="brand-link"
          onClick={(e) => {
            e.preventDefault();
            setSelected(null);
            setFilter("all");
          }}
        >
          <Logo />
        </a>
        <div className="workspace-label">
          <span className="avatar">Y</span>
          <div>
            Your workspace<small>Personal research library</small>
          </div>
        </div>
        <div className="nav-section-label">EXPLORE</div>
        <nav aria-label="Library navigation">
          <button
            className={`nav-link ${filter === "all" ? "active" : ""}`}
            onClick={() => chooseFilter("all")}
          >
            <Library size={18} />
            All research<span>{libraryItems.length}</span>
          </button>
          <button
            className={`nav-link ${filter === "starred" ? "active" : ""}`}
            onClick={() => chooseFilter("starred")}
          >
            <Star size={18} />
            Starred<span>{libraryItems.filter((i) => i.favorite).length}</span>
          </button>
        </nav>
        <div className="nav-section-label collection-heading">
          COLLECTIONS<span>{collections.length}</span>
        </div>
        <nav aria-label="Collections">
          {collections.map((c) => (
            <button
              key={c}
              className={`nav-link ${filter === c ? "active" : ""}`}
              onClick={() => chooseFilter(c)}
            >
              <Folder size={17} />
              <span className="collection-name">{c}</span>
              <span>
                {libraryItems.filter((i) => i.collection === c).length}
              </span>
            </button>
          ))}
          {!collections.length && (
            <p className="nav-empty">Your collections will live here.</p>
          )}
        </nav>
        <div className="nav-bottom">
          <div className="browser-callout">
            <span className="tiny-label">A LITTLE CURIOSITY GOES FAR</span>
            <p>
              Good research starts
              <br />
              with an open tab.
            </p>
            <button
              className="text-button"
              onClick={() => setCaptureHelp(true)}
            >
              Add from your browser <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="nav-link" onClick={() => setShowSettings(true)}>
            <Settings2 size={18} />
            Settings & connections
          </button>
          <div className="server-state">
            <span
              className={`status-dot ${providerStatus?.exa && providerStatus?.llm ? "ready" : ""}`}
            />
            {providerStatus?.exa && providerStatus?.llm
              ? "Exa + OpenRouter configured"
              : "Connect your research tools"}
          </div>
        </div>
      </aside>
      <main className="main-workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Your workspace</span>
            <ChevronRight size={13} />
            <span>
              {current
                ? "Research brief"
                : filter === "all"
                  ? "Research library"
                  : filter === "starred"
                    ? "Starred"
                    : filter}
            </span>
          </div>
          <span className="topbar-note">
            <span className="status-dot ready" />
            Saved on your device
          </span>
        </header>
        {error && (
          <div className="page-error">
            <ErrorMessage text={error} />
          </div>
        )}
        {selected && current ? (
          <BriefDetail
            item={current}
            onBack={() => setSelected(null)}
            onFavorite={() =>
              void mutate(`/research/${current.id}`, "PATCH", {
                favorite: !current.favorite,
              })
            }
            onDelete={() => setDeleteId(current.id)}
            onChange={refresh}
            onCancel={() => void mutate(`/research/${current.id}/cancel`)}
            onRetry={() => void mutate(`/research/${current.id}/retry`)}
          />
        ) : selected && !loading ? (
          <div className="empty-state">
            <h2>This brief isn’t here.</h2>
            <p>It may have been removed from your library.</p>
            <button
              className="button secondary"
              onClick={() => setSelected(null)}
            >
              Back to library
            </button>
          </div>
        ) : (
          <div className="library-content">
            <div className="library-heading">
              <div>
                <span className="eyebrow">
                  COLLECT IDEAS. MAKE CONNECTIONS.
                </span>
                <h1>
                  Your research,
                  <br />
                  <em>with a little perspective.</em>
                </h1>
                <p className="heading-description">
                  Everything you discover, connected to what you know.
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => setCaptureHelp(true)}
              >
                <Plus size={17} />
                Add from browser
              </button>
            </div>
            <div className="library-summary">
              <div>
                <span>{String(complete.length).padStart(2, "0")}</span>saved
                briefs
              </div>
              <div>
                <span>
                  {String(
                    libraryItems.reduce((n, i) => n + i.sources.length, 0),
                  ).padStart(2, "0")}
                </span>
                sources collected
              </div>
              <div>
                <span>
                  {String(
                    libraryItems.reduce(
                      (n, i) => n + (i.brief?.connections.length || 0),
                      0,
                    ),
                  ).padStart(2, "0")}
                </span>
                connections made
              </div>
              <div className="summary-decoration">
                <span />A growing body of knowledge
              </div>
            </div>
            <div className="library-tools">
              <div className="search-field">
                <Search size={18} />
                <input
                  aria-label="Search research"
                  placeholder="Search briefs, sources, or your notes…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="sort-control">
                <SlidersHorizontal size={16} />
                <select
                  aria-label="Sort research"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">By title</option>
                </select>
              </div>
            </div>
            {allTags.length > 0 && (
              <div className="tag-filters">
                <button
                  className={!tag ? "selected" : ""}
                  onClick={() => setTag("")}
                >
                  All topics
                </button>
                {allTags.map((t) => (
                  <button
                    className={tag === t ? "selected" : ""}
                    key={t}
                    onClick={() => setTag(tag === t ? "" : t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="list-label">
              <span>
                {filter === "starred"
                  ? "STARRED RESEARCH"
                  : filter === "all"
                    ? "YOUR READING SHELF"
                    : filter.toUpperCase()}
              </span>
              <span>
                {filtered.length} {filtered.length === 1 ? "item" : "items"}
              </span>
            </div>
            {loading ? (
              <div className="empty-state">
                <Spinner />
                <p>Opening your library…</p>
              </div>
            ) : filtered.length ? (
              <div className="research-list">
                {filtered.map((item, index) => (
                  <button
                    key={item.id}
                    className="research-row"
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="row-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="research-row-content">
                      <div className="row-metadata">
                        <span>{domain(item.input.capture.url)}</span>
                        <span className="metadata-dot" />
                        <span>
                          {new Date(item.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                        {item.mode === "demo" && (
                          <span className="sample-badge">Example</span>
                        )}
                        {item.status !== "complete" && (
                          <span className={`job-status ${item.status}`}>
                            {item.status === "running"
                              ? item.stage
                              : item.status}
                          </span>
                        )}
                      </div>
                      <h2>{item.brief?.title || item.input.capture.title}</h2>
                      <p>
                        {item.brief?.overview.text ||
                          item.input.question ||
                          "Research in progress. Your captured page is saved."}
                      </p>
                      <div className="row-bottom">
                        <div className="tags">
                          {(item.brief?.tags || []).slice(0, 3).map((t) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <span className="source-count">
                          <Link2 size={13} />
                          {item.sources.length} sources
                        </span>
                      </div>
                    </div>
                    <span className="row-trailing">
                      {item.favorite && <Star size={16} fill="currentColor" />}
                      <ArrowUpRight size={23} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <EmptyIllustration />
                <span className="eyebrow">ROOM FOR YOUR NEXT DISCOVERY</span>
                <h2>
                  {query || tag || filter !== "all"
                    ? "Nothing here just yet."
                    : "A curious mind needs a good margin."}
                </h2>
                <p>
                  {query || tag
                    ? "Try a different topic, phrase, or filter."
                    : "Open a page you want to understand. Margin brings the context, connects the sources, and keeps the useful parts here."}
                </p>
                <div className="row center">
                  <button
                    className="button primary"
                    onClick={() => setCaptureHelp(true)}
                  >
                    <Compass size={17} />
                    Capture your first page
                  </button>
                  {!libraryItems.length && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={loadDemo}
                    >
                      {busy ? <Spinner /> : <BookOpen size={16} />}Explore an
                      example
                    </button>
                  )}
                </div>
                {!libraryItems.length && (
                  <small className="fine-print">
                    Articles, papers, websites, and social posts. Your curiosity
                    sets the scope.
                  </small>
                )}
              </div>
            )}
            <footer className="library-footer">
              <span>Make room for a better question.</span>
              <Logo small />
            </footer>
          </div>
        )}
      </main>
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={() => void refreshStatus()}
        />
      )}{" "}
      {captureHelp && (
        <div className="modal-scrim" onClick={() => setCaptureHelp(false)}>
          <section
            className="settings-modal capture-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capture-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between">
              <Logo small />
              <button
                className="icon-button"
                aria-label="Close instructions"
                onClick={() => setCaptureHelp(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="capture-title">
              Start with what’s
              <br />
              in front of you.
            </h2>
            <p>Open the Margin extension from your Chrome toolbar.</p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Choose an open tab</strong>
                  <p>
                    A website, article, paper, or social post. Select a passage
                    first to narrow the focus.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Open the assistant</strong>
                  <p>
                    Ask a question or choose “Research this page.” Allow access
                    to that site when Chrome asks.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Follow the connections</strong>
                  <p>
                    Discuss the brief in the floating panel. Click “Add to
                    library” or ask the agent to save it when you want to keep
                    it here.
                  </p>
                </div>
              </li>
            </ol>
            <button
              className="button primary full"
              onClick={() => {
                setCaptureHelp(false);
                setShowSettings(true);
              }}
            >
              Set up the extension <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      {deleteId && (
        <div className="modal-scrim">
          <section className="confirm-modal" role="dialog" aria-modal="true">
            <h2>Remove this brief?</h2>
            <p>
              Its saved sources, conversation, and notes will be removed from
              this workspace.
            </p>
            <div className="row end">
              <button
                className="button secondary"
                onClick={() => setDeleteId(null)}
              >
                Keep brief
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  await mutate(`/research/${deleteId}`, "DELETE");
                  setDeleteId(null);
                  setSelected(null);
                }}
              >
                Remove brief
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BriefDetail({
  item,
  onBack,
  onFavorite,
  onDelete,
  onChange,
  onCancel,
  onRetry,
}: {
  item: Research;
  onBack: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onChange: () => Promise<void>;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  async function saveToLibrary() {
    setSaving(true);
    setSaveError("");
    try {
      await api(`/research/${item.id}`, "PATCH", { inLibrary: true });
      await onChange();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="brief-view">
      {saveError && <ErrorMessage text={saveError} />}
      <div className="brief-toolbar">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to library
        </button>
        <div className="row">
          {item.inLibrary === false && (
            <button
              className="button primary compact"
              disabled={saving || item.status !== "complete"}
              onClick={() => void saveToLibrary()}
            >
              <Plus size={14} />
              Add to library
            </button>
          )}
          <button
            className={`icon-button ${item.favorite ? "is-starred" : ""}`}
            aria-label={item.favorite ? "Unstar brief" : "Star brief"}
            onClick={onFavorite}
          >
            <Star size={18} fill={item.favorite ? "currentColor" : "none"} />
          </button>
          <button
            className="button secondary compact"
            disabled={!item.brief}
            onClick={() => exportBrief(item)}
          >
            <ArrowDownToLine size={15} />
            Export Markdown
          </button>
          <button
            className="icon-button"
            aria-label="Delete brief"
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="brief-layout">
        <article className="brief-article">
          <div className="row-metadata">
            <span className="eyebrow">
              {item.inLibrary === false
                ? "DRAFT · NOT IN LIBRARY"
                : "RESEARCH BRIEF"}
            </span>
            <span className="metadata-dot" />
            <span>
              {item.mode === "demo"
                ? "ILLUSTRATIVE EXAMPLE"
                : item.mode === "extractive"
                  ? "SOURCE DIGEST"
                  : "AI SYNTHESIS"}
            </span>
          </div>
          <h1>{item.brief?.title || item.input.capture.title}</h1>
          <div className="brief-byline">
            <a href={item.input.capture.url} target="_blank" rel="noreferrer">
              {domain(item.input.capture.url)}
              <ArrowUpRight size={13} />
            </a>
            <span>
              {new Date(item.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span>{item.input.capture.coverage.replace("-", " ")} capture</span>
          </div>
          {item.input.question && (
            <div className="research-question">
              <span className="eyebrow">YOUR RESEARCH QUESTION</span>
              <p>{item.input.question}</p>
            </div>
          )}
          {["queued", "running"].includes(item.status) && (
            <Progress item={item} onCancel={onCancel} />
          )}{" "}
          {["failed", "cancelled"].includes(item.status) && (
            <div className="notice">
              <p>
                {item.error ||
                  "This research was cancelled. Your captured page is still saved."}
              </p>
              <button className="button secondary" onClick={onRetry}>
                Retry research
              </button>
            </div>
          )}
          {item.warnings.map((w) => (
            <p key={w} className="coverage-note">
              {w}
            </p>
          ))}
          {item.brief && (
            <>
              <section className="brief-overview">
                <span className="section-kicker">THE BIG PICTURE</span>
                <p>
                  {item.brief.overview.text}
                  <SourceCitations
                    ids={item.brief.overview.sourceIds}
                    sources={item.sources}
                  />
                </p>
              </section>
              <section className="brief-section">
                <h2>
                  What to take away
                  <span>
                    {String(item.brief.takeaways.length).padStart(2, "0")}
                  </span>
                </h2>
                <div className="takeaways">
                  {item.brief.takeaways.map((f, i) => (
                    <div key={i}>
                      <span className="takeaway-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p>
                        {f.text}
                        <SourceCitations
                          ids={f.sourceIds}
                          sources={item.sources}
                        />
                      </p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="brief-section">
                <h2>
                  Beyond this page
                  <Link2 size={20} />
                </h2>
                <p className="section-description">
                  Connections that add context to the original.
                </p>
                {item.brief.connections.length ? (
                  item.brief.connections.map((f, i) => (
                    <div
                      className={`connection-card${
                        citesHistory(f.sourceIds, item.sources) ? " history" : ""
                      }`}
                      key={i}
                    >
                      <span className="relationship">
                        {f.relationship.replace("-", " ")}
                      </span>
                      <h3>{f.title}</h3>
                      <HistoryNotes ids={f.sourceIds} sources={item.sources} />
                      <p>
                        {f.text}
                        <SourceCitations
                          ids={f.sourceIds}
                          sources={item.sources}
                        />
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="quiet-empty">
                    No additional connection was included in this brief.
                  </p>
                )}
              </section>
              {item.brief.questions.length > 0 && (
                <section className="brief-section questions-section">
                  <h2>
                    Keep the question open
                    <Compass size={20} />
                  </h2>
                  {item.brief.questions.map((q) => (
                    <div key={q}>
                      <ArrowUpRight size={17} />
                      <p>{q}</p>
                    </div>
                  ))}
                </section>
              )}
              <section className="brief-section">
                <h2>
                  Your margin
                  <FileText size={20} />
                </h2>
                <Notes key={item.id} item={item} onSaved={onChange} />
              </section>
              {!!item.messages?.length && (
                <section className="brief-section">
                  <h2>The conversation</h2>
                  <div className="saved-conversation">
                    {item.messages.map((m, i) => (
                      <div key={i} className={m.role}>
                        <span className="eyebrow">
                          {m.role === "user" ? "YOU" : "MARGIN"}
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
                  </div>
                </section>
              )}
            </>
          )}
        </article>
        <aside className="evidence-rail">
          <div className="rail-title">
            <BookOpen size={17} />
            <h3>Source notebook</h3>
            <span>{item.sources.length}</span>
          </div>
          <p className="rail-description">
            Every connection starts with a source. Open the original or revisit
            a saved excerpt.
          </p>
          {item.sources.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
          {item.brief?.tags.length ? (
            <div className="rail-topics">
              <span className="eyebrow">TOPICS</span>
              <div className="tags">
                {item.brief.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
          ) : null}
          <Collection key={item.id} item={item} onSaved={onChange} />
        </aside>
      </div>
    </div>
  );
}
function Notes({
  item,
  onSaved,
}: {
  item: Research;
  onSaved: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(item.notes);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="notes-editor">
      <textarea
        aria-label="Research notes"
        placeholder="What stood out? What would you investigate next? This space is yours."
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
      />
      <div className="row between">
        <span className="fine-print">
          Your thoughts, alongside the evidence.
        </span>
        <button
          className="button secondary compact"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/research/${item.id}`, "PATCH", { notes });
              setSaved(true);
              await onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : saved ? <Check size={14} /> : null}
          {saved ? "Saved" : "Save note"}
        </button>
      </div>
      {error && <ErrorMessage text={error} />}
    </div>
  );
}
function Collection({
  item,
  onSaved,
}: {
  item: Research;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(item.collection);
  const [error, setError] = useState("");
  return (
    <form
      className="collection-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/research/${item.id}`, "PATCH", { collection: value });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label>
        <span className="eyebrow">COLLECTION</span>
        <input
          value={value}
          required
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button className="text-button" type="submit">
        Save collection <ArrowRight size={13} />
      </button>
      {error && <ErrorMessage text={error} />}
    </form>
  );
}
