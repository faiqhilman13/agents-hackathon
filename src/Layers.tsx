import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Compass,
  Lightbulb,
  Map as MapIcon,
  Search,
  Sparkles,
} from "lucide-react";
import type { ReadLink, Research, Source, SourcePick } from "../shared/schema";
import {
  api,
  askLibrary,
  domain,
  findGaps,
  isExtension,
  status,
  testMyThinking,
  weeklyReflection,
  type Challenge,
  type Gap,
  type GapSource,
  type LibraryAnswer,
  type LibraryTurn,
  type Reflection,
} from "./api";
import { ErrorMessage, MathText, Spinner } from "./components";

// The panel views behind the rail's three circles.
//   SourcesView  Layer 1 (sharp sources), Layer 2 (you read this before), Layer 3 (bridge card)
//   ThinkingCard Layer 4 (Test my thinking), shown under the brief
//   AskView      Layer 5 (ask your reading), Layer 6 (find gaps), Layer 7 (weekly reflection)

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    if (isExtension) return ((await chrome.storage.local.get(key))[key] as T | undefined) ?? fallback;
    return (JSON.parse(localStorage.getItem(key) || "null") as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, value: unknown) {
  if (isExtension) await chrome.storage.local.set({ [key]: value });
  else localStorage.setItem(key, JSON.stringify(value));
}

function ReadPill({ read, label }: { read: ReadLink | { title: string; url: string }; label?: string }) {
  return (
    <a className="read-pill" href={read.url} target="_blank" rel="noreferrer" title={read.title}>
      <span>{label || read.title}</span>
      <ArrowUpRight size={10} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Circle 1: related sources
// ---------------------------------------------------------------------------
const ROLE_LABELS: Record<SourcePick["role"], string> = {
  canonical: "The canonical source",
  opposing: "The strongest counterpoint",
  unexpected: "An unexpected connection",
};

type SourceCardData = { source: Source; pick?: SourcePick };

function sharpSources(item: Research): SourceCardData[] {
  const related = item.sources.filter((source) => source.kind === "related");
  if (item.picks?.length) {
    return item.picks
      .map((pick) => ({ pick, source: related.find((source) => source.id === pick.sourceId) }))
      .filter((card): card is { pick: SourcePick; source: Source } => !!card.source);
  }
  return related.slice(0, 3).map((source) => ({ source }));
}

export function SourcesView({
  item,
  working,
  busy,
  onStart,
}: {
  item?: Research;
  working: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  // Whether Exa is connected now, to offer a fresh search for pages read before the key was added.
  const [exaReady, setExaReady] = useState(false);
  useEffect(() => {
    void status()
      .then((current) => setExaReady(!!current.exa))
      .catch(() => undefined);
  }, [item?.id]);
  if (!item) {
    return (
      <div className="layer-empty">
        <span className="assistant-symbol">
          <Search size={22} />
        </span>
        <span className="eyebrow">THE READER</span>
        <h2>Sources arrive as you read.</h2>
        <p>
          With auto-read on, Margin reads the page you are viewing and brings back the sharpest related
          sources from across the web.
        </p>
        <button className="button primary" onClick={onStart} disabled={busy}>
          {busy ? <Spinner /> : <Sparkles size={16} />} Read this page now
        </button>
      </div>
    );
  }
  if (working) {
    return (
      <div className="layer-empty">
        <Spinner />
        <span className="eyebrow">THE READER</span>
        <h2>Finding the sharpest sources…</h2>
        <p>{item.stage}</p>
      </div>
    );
  }
  const cards = sharpSources(item);
  return (
    <div className="layer-view">
      {item.bridge && (
        <div className="bridge-card">
          <span className="eyebrow">
            <MapIcon size={12} /> CONNECTS YOUR READING
          </span>
          <p><MathText text={item.bridge.text} /></p>
          <div className="pill-row">
            {item.bridge.reads.map((read) => (
              <ReadPill key={read.researchId} read={read} />
            ))}
          </div>
        </div>
      )}
      <span className="eyebrow layer-heading">THREE SHARP SOURCES</span>
      {cards.length ? (
        cards.map(({ source, pick }) => (
          <a
            key={source.id}
            className={`sharp-card ${source.fromHistory ? "history" : ""}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="sharp-meta">
              <span>{pick ? ROLE_LABELS[pick.role] : "Related source"}</span>
              <span>{domain(source.url)}</span>
            </span>
            <strong>
              {source.title}
              <ArrowUpRight size={13} />
            </strong>
            {source.fromHistory && source.readContext && (
              <span className="sharp-history">{source.readContext}</span>
            )}
            {pick?.whyItMatters && <span className="sharp-why"><MathText text={pick.whyItMatters} /></span>}
          </a>
        ))
      ) : (
        <div className="quiet-empty">
          <p>
            {item.warnings.find((warning) => /Exa/.test(warning)) ||
              "No related source was strong enough to keep for this page."}
          </p>
          {exaReady && item.warnings.some((warning) => warning.startsWith("Exa is not connected")) && (
            <button className="button primary" onClick={onStart} disabled={busy}>
              {busy ? <Spinner /> : <Search size={15} />} Exa is connected now: find sources
            </button>
          )}
        </div>
      )}
      <p className="layer-footnote">
        Purple means you read something close to it recently. Teal connects two of your earlier reads.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer 4: Test my thinking (inside the brief view)
// ---------------------------------------------------------------------------
export function ThinkingCard({ item, onItem }: { item: Research; onItem: (item: Research) => void }) {
  const [questions, setQuestions] = useState<Challenge[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask() {
    setBusy(true);
    setError("");
    try {
      setQuestions((await testMyThinking(item.id)).questions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(question: Challenge) {
    const line = `Question to revisit: ${question.text}${question.versus ? ` (vs. your reading of ${question.versus.title})` : ""}`;
    try {
      const updated = await api<Research>(`/research/${item.id}`, "PATCH", {
        notes: [item.notes, line].filter(Boolean).join("\n\n"),
      });
      onItem(updated);
      setSaved((current) => [...current, question.text]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="thinking-card">
      {!questions.length ? (
        <button className="button secondary full" onClick={() => void ask()} disabled={busy}>
          {busy ? <Spinner /> : <Lightbulb size={15} />} Test my thinking
        </button>
      ) : (
        <>
          <span className="eyebrow">
            <Lightbulb size={12} /> TEST YOUR THINKING
          </span>
          {questions.map((question) => (
            <div className="thinking-question" key={question.text}>
              <p><MathText text={question.text} /></p>
              <div className="row between">
                {question.versus ? (
                  <ReadPill read={question.versus} label={`vs. your reading of ${question.versus.title}`} />
                ) : (
                  <span />
                )}
                <button
                  className="text-button"
                  disabled={saved.includes(question.text)}
                  onClick={() => void save(question)}
                >
                  {saved.includes(question.text) ? <Check size={12} /> : <BookmarkPlus size={12} />}
                  {saved.includes(question.text) ? "Saved to notes" : "Save question"}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {error && <ErrorMessage text={error} onClose={() => setError("")} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circle 3: ask your reading history
// ---------------------------------------------------------------------------
type AskMode = "ask" | "gaps" | "reflect";
type ChatMessage = LibraryTurn & { citations?: LibraryAnswer["citations"] };
const CHAT_KEY = "libraryChat";
const REFLECTION_KEY = "weeklyReflection";

export function AskView() {
  const [mode, setMode] = useState<AskMode>("ask");
  return (
    <div className="layer-view ask-view">
      <div className="layer-tabs" role="tablist" aria-label="Ask your reading">
        {([
          ["ask", "Ask", <MessageIcon key="ask" />],
          ["gaps", "Find gaps", <Compass key="gaps" size={13} />],
          ["reflect", "Reflect", <Sparkles key="reflect" size={13} />],
        ] as const).map(([value, label, icon]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? "active" : ""}
            onClick={() => setMode(value)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      {mode === "ask" && <AskHistory />}
      {mode === "gaps" && <FindGaps />}
      {mode === "reflect" && <WeeklyReflection />}
    </div>
  );
}

function MessageIcon() {
  return <Search size={13} />;
}

function AskHistory() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadLocal<ChatMessage[]>(CHAT_KEY, []).then(setMessages);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.map(({ role, text: body }) => ({ role, text: body }));
    const next: ChatMessage[] = [...messages, { role: "user", text: message }];
    setMessages(next);
    setText("");
    setBusy(true);
    setError("");
    try {
      const answer = await askLibrary(message, history);
      const reply: ChatMessage = { role: "assistant", text: answer.text, citations: answer.citations };
      const withAnswer = [...next, reply].slice(-30);
      setMessages(withAnswer);
      await saveLocal(CHAT_KEY, withAnswer);
    } catch (err) {
      setError((err as Error).message);
      setMessages(messages);
      setText(message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setMessages([]);
    await saveLocal(CHAT_KEY, []);
  }
  return (
    <>
      {!messages.length ? (
        <div className="layer-empty compact">
          <span className="eyebrow">THE SPARRING PARTNER</span>
          <h2>Ask everything you have read.</h2>
          <p>Answers use only pages Margin has read with you, and every claim links back to its source.</p>
          <div className="followup-prompts">
            {["What have I read about this topic?", "Where do my sources disagree?", "Show me the exact passage about this."].map((prompt) => (
              <button key={prompt} onClick={() => setText(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="conversation">
          {messages.map((message, index) => (
            <div key={index} className={`chat-message ${message.role === "user" ? "user" : "assistant-message"}`}>
              <span className="chat-author">{message.role === "user" ? "You" : "Margin"}</span>
              <p><MathText text={message.text} /></p>
              {!!message.citations?.length && (
                <div className="pill-row">
                  {message.citations.map((citation) => (
                    <ReadPill key={citation.id} read={citation} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="chat-thinking">
              <Spinner />
              Reading back through your history…
            </div>
          )}
          <button className="text-button" onClick={() => void clear()}>
            Clear this conversation
          </button>
        </div>
      )}
      <div ref={endRef} />
      {error && <ErrorMessage text={error} onClose={() => setError("")} />}
      <form className="composer layer-composer" onSubmit={send}>
        <textarea
          aria-label="Ask your reading history"
          value={text}
          rows={2}
          placeholder="Ask about anything you have read…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="row between">
          <span className="composer-context">Your reading history only</span>
          <button className="send-button" type="submit" aria-label="Ask your reading history" disabled={!text.trim() || busy}>
            {busy ? <Spinner /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
    </>
  );
}

function FindGaps() {
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<{ gaps: Gap[]; sources: GapSource[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (topic.trim().length < 3 || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await findGaps(topic.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const byId = new Map(result?.sources.map((source) => [source.id, source]));
  return (
    <>
      <div className="layer-empty compact">
        <span className="eyebrow">RESEARCH MODE · PRO</span>
        <h2>Where are the gaps?</h2>
        <p>Margin maps what you have read on a topic, checks related work with Exa, and points to what is missing.</p>
      </div>
      <form className="gap-form" onSubmit={run}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. data privacy enforcement in Southeast Asia"
          aria-label="Research topic"
        />
        <button className="button primary" disabled={busy || topic.trim().length < 3}>
          {busy ? <Spinner /> : <Compass size={15} />} Map it
        </button>
      </form>
      {error && <ErrorMessage text={error} onClose={() => setError("")} />}
      {result &&
        (result.gaps.length ? (
          result.gaps.map((gap, index) => (
            <div className="gap-card" key={gap.title}>
              <span className="eyebrow">GAP {index + 1}</span>
              <strong>{gap.title}</strong>
              <p><MathText text={gap.text} /></p>
              {!!gap.evidence.length && (
                <div className="pill-row">
                  {gap.evidence.map((id) => byId.get(id)).filter((source): source is GapSource => !!source).map((source) => (
                    <ReadPill key={source.id} read={source} label={`${source.kind === "read" ? "You read" : "Web"}: ${source.title}`} />
                  ))}
                </div>
              )}
              {!!gap.suggestions.length && (
                <div className="gap-suggestions">
                  <span className="eyebrow">WORTH INVESTIGATING</span>
                  {gap.suggestions.map((id) => byId.get(id)).filter((source): source is GapSource => !!source).map((source) => (
                    <ReadPill key={source.id} read={source} />
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="quiet-empty">
            Margin could not find enough on this topic in your reading or on the web to map its gaps yet.
          </p>
        ))}
    </>
  );
}

function WeeklyReflection() {
  const [reflection, setReflection] = useState<Reflection & { generatedAt?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void loadLocal<(Reflection & { generatedAt?: string }) | undefined>(REFLECTION_KEY, undefined).then((cached) => {
      // Reuse a reflection written in the last day so opening this tab does not spend credits every time.
      if (cached?.generatedAt && Date.now() - new Date(cached.generatedAt).getTime() < 24 * 60 * 60 * 1000) setReflection(cached);
    });
  }, []);
  async function write() {
    setBusy(true);
    setError("");
    try {
      const next = { ...(await weeklyReflection()), generatedAt: new Date().toISOString() };
      setReflection(next);
      await saveLocal(REFLECTION_KEY, next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!reflection?.available ? (
        <div className="layer-empty compact">
          <span className="eyebrow">THE REFLECTOR</span>
          <h2>Your week, reflected.</h2>
          <p>
            {reflection && !reflection.available
              ? `You have read ${reflection.count} page${reflection.count === 1 ? "" : "s"} this week. Read at least two to get a reflection.`
              : "A short digest of what you read this week: the through-line, the tension you left open, and what to read next."}
          </p>
          <button className="button primary" onClick={() => void write()} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles size={15} />} Write this week's reflection
          </button>
        </div>
      ) : (
        <div className="reflection-card">
          <span className="eyebrow">THIS WEEK · {reflection.count} READS</span>
          <h2>{reflection.title}</h2>
          <p><MathText text={reflection.throughline || ""} /></p>
          {reflection.tension && (
            <p className="reflection-tension">
              <strong>Left unresolved:</strong> <MathText text={reflection.tension} />
            </p>
          )}
          {!!reflection.openQuestions?.length && (
            <ul>
              {reflection.openQuestions.map((question) => (
                <li key={question}><MathText text={question} /></li>
              ))}
            </ul>
          )}
          {!!reflection.nextReads?.length && (
            <>
              <span className="eyebrow">READ NEXT TO CLOSE THE LOOP</span>
              <div className="pill-row">
                {reflection.nextReads.map((read) => (
                  <ReadPill key={read.url} read={read} />
                ))}
              </div>
            </>
          )}
          {!!reflection.reads?.length && (
            <>
              <span className="eyebrow">BASED ON</span>
              <div className="pill-row">
                {reflection.reads.map((read) => (
                  <ReadPill key={read.researchId} read={read} />
                ))}
              </div>
            </>
          )}
          <button className="text-button" onClick={() => void write()} disabled={busy}>
            {busy ? <Spinner /> : null} Write it again
          </button>
        </div>
      )}
      {error && <ErrorMessage text={error} onClose={() => setError("")} />}
    </>
  );
}
