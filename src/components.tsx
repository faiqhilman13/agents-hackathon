import { Fragment, useMemo, useState } from "react";
import katex from "katex";
import { splitMath } from "./mathText";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";
import { domain } from "./api";
import type { Research, Source } from "../shared/schema";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? "small" : ""}`}>
      <span className="logo-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        margin<span className="logo-period">.</span>
      </span>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={17} className="spin" />;
}
export function ErrorMessage({
  text,
  onClose,
}: {
  text: string;
  onClose?: () => void;
}) {
  return (
    <div className="error" role="alert">
      <span>{text}</span>
      {onClose && (
        <button
          className="icon-button"
          aria-label="Dismiss error"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
/** Renders text with TeX formulas ($...$, $$...$$) drawn by KaTeX; everything else stays plain text. */
export function MathText({ text }: { text: string }) {
  const segments = useMemo(() => splitMath(text), [text]);
  if (!segments.some((segment) => segment.kind === "math")) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Fragment key={index}>{segment.value}</Fragment>
        ) : (
          <span
            key={index}
            className={segment.display ? "math-display" : "math-inline"}
            // KaTeX builds this markup from the TeX and escapes text; with trust off it refuses \href and similar commands.
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(segment.value, {
                displayMode: segment.display,
                throwOnError: false,
                trust: false,
                strict: "ignore",
              }),
            }}
          />
        ),
      )}
    </>
  );
}
export function SourceCitations({
  ids,
  sources,
}: {
  ids: string[];
  sources: Source[];
}) {
  return (
    <span className="citations">
      {ids.map((id) => {
        const s = sources.find((s) => s.id === id);
        return s ? (
          <a
            key={id}
            title={s.title}
            href={s.url}
            target="_blank"
            rel="noreferrer"
          >
            {Number(id.slice(1)) + 1}
            <ArrowUpRight size={10} />
          </a>
        ) : null;
      })}
    </span>
  );
}
/** Reading memory: true when a cited related source overlaps a page the user read recently. */
export function citesHistory(ids: string[], sources: Source[]) {
  return sources.some((s) => s.fromHistory && ids.includes(s.id));
}
/** Reading memory: "You read … recently." lines for cited sources, shown above a connection's text. */
export function HistoryNotes({
  ids,
  sources,
}: {
  ids: string[];
  sources: Source[];
}) {
  const notes = [
    ...new Set(
      sources
        .filter((s) => s.fromHistory && s.readContext && ids.includes(s.id))
        .map((s) => s.readContext as string),
    ),
  ];
  if (!notes.length) return null;
  return (
    <>
      {notes.map((note) => (
        <p className="history-note" key={note}>
          {note}
        </p>
      ))}
    </>
  );
}
export function SourceCard({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`source-card${source.fromHistory ? " history" : ""}`}>
      <div className="source-meta">
        <span className="source-num">{Number(source.id.slice(1)) + 1}</span>
        <span>{domain(source.url)}</span>
        {source.kind === "original" && (
          <span className="tiny-label">Original</span>
        )}
      </div>
      <a
        className="source-title"
        href={source.url}
        target="_blank"
        rel="noreferrer"
      >
        {source.title}
        <ArrowUpRight size={14} />
      </a>
      {source.fromHistory && source.readContext && (
        <p className="source-readctx">{source.readContext}</p>
      )}
      <button className="text-button" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide excerpt" : "Read saved excerpt"}
      </button>
      {expanded && (
        <p className="source-excerpt">
          <MathText text={source.text.slice(0, 1600)} />
          {source.text.length > 1600 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
export function Progress({
  item,
  onCancel,
}: {
  item: Research;
  onCancel?: () => void;
}) {
  return (
    <div className="progress-card" role="status">
      <div className="row between">
        <span className="row">
          <Spinner />
          {item.stage}
        </span>
        <span className="mono">{item.progress}%</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${item.progress}%` }} />
      </div>
      <p>
        You can minimize this panel. Your research continues in the background.
      </p>
      {onCancel && (
        <button className="text-button" onClick={onCancel}>
          Cancel research
        </button>
      )}
    </div>
  );
}
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
      {copied ? "Copied" : label}
    </button>
  );
}
export function EmptyIllustration() {
  return (
    <div className="empty-illustration" aria-hidden="true">
      <div className="ill-paper back" />
      <div className="ill-paper front">
        <BookOpen size={23} />
        <div />
        <div />
        <div />
        <span className="ill-highlight" />
      </div>
      <span className="ill-link">
        <ExternalLink size={17} />
      </span>
      <span className="ill-dot" />
    </div>
  );
}
