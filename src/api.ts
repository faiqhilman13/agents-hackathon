import type { ReadLink, Research } from "../shared/schema";
export const isExtension =
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
export const SERVER = "http://127.0.0.1:4317";
let localToken = "";
export async function connectionToken() {
  if (isExtension)
    return (
      ((await chrome.storage.local.get("connectionToken"))
        .connectionToken as string) || ""
    );
  if (!localToken) {
    const res = await fetch("/api/connection");
    if (!res.ok)
      throw new Error("Open the library from the local Margin server.");
    localToken = (await res.json()).token;
  }
  return localToken;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = await connectionToken();
  const res = await fetch(`${isExtension ? SERVER : ""}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "Could not complete that request.");
  return data;
}
export async function status(): Promise<{
  ok: boolean;
  exa: boolean;
  llm: boolean;
  model: string;
  llmBaseUrl: string;
}> {
  const res = await fetch(`${isExtension ? SERVER : ""}/api/status`, {
    signal: AbortSignal.timeout(4000),
  });
  return res.json();
}
export async function extensionMessage<T = unknown>(
  message: unknown,
): Promise<T> {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : result?.error?.message ||
          "The extension could not complete that action.",
    );
  return result as T;
}
export type Tab = {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  selected?: boolean;
};
export async function listTabs() {
  return (await extensionMessage<{ tabs: Tab[] }>({ type: "LIST_TABS" })).tabs;
}
export async function startResearch(tab: Tab, question: string, enrich = true) {
  // A permission request begins in the user's click handler, before any async work.
  const origin = `${new URL(tab.url).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted)
    throw new Error(
      "Page access was declined. Allow this site to research the selected tab.",
    );
  return (
    await extensionMessage<{ research: Research }>({
      type: "CAPTURE_AND_RESEARCH",
      tabId: tab.id,
      question,
      collection: "Reading list",
      enrich,
    })
  ).research;
}
// Reading layers 4-7 (see server/layers.ts). Each call runs only when the user asks.
export type LibraryTurn = { role: "user" | "assistant"; text: string };
export type LibraryAnswer = { text: string; citations: (ReadLink & { id: string })[] };
export type Challenge = { text: string; versus?: ReadLink };
export type GapSource = { id: string; kind: "read" | "web"; title: string; url: string; researchId?: string; publishedDate?: string };
export type Gap = { title: string; text: string; evidence: string[]; suggestions: string[] };
export type Reflection = {
  available: boolean; count: number; since: string;
  title?: string; throughline?: string; tension?: string; openQuestions?: string[];
  nextReads?: { title: string; url: string; why: string }[]; reads?: ReadLink[];
};
export function askLibrary(message: string, conversation: LibraryTurn[]) {
  return api<LibraryAnswer>("/library/ask", "POST", { message, conversation });
}
export function findGaps(topic: string) {
  return api<{ gaps: Gap[]; sources: GapSource[] }>("/library/gaps", "POST", { topic });
}
export function weeklyReflection() {
  return api<Reflection>("/library/reflection");
}
export function testMyThinking(researchId: string) {
  return api<{ questions: Challenge[] }>(`/research/${encodeURIComponent(researchId)}/challenge`, "POST", {});
}
export function libraryUrl(id?: string) {
  return `${SERVER}/${id ? `?brief=${encodeURIComponent(id)}` : ""}`;
}
export function openLibrary(id?: string) {
  if (isExtension) void chrome.tabs.create({ url: libraryUrl(id) });
  else window.location.href = libraryUrl(id);
}
export function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}
export function exportBrief(item: Research) {
  const b = item.brief;
  if (!b) return;
  const cite = (ids: string[]) => ids.map((id) => `[${id}]`).join(" ");
  const content = [
    `# ${b.title}`,
    `Source: ${item.input.capture.url}`,
    `Captured: ${item.input.capture.capturedAt}`,
    `Mode: ${item.mode} | Coverage: ${item.input.capture.coverage}`,
    item.warnings.length ? `Notes: ${item.warnings.join(" ")}` : "",
    `## Overview\n${b.overview.text} ${cite(b.overview.sourceIds)}`,
    `## Key points\n${b.takeaways.map((f) => `- ${f.text} ${cite(f.sourceIds)}`).join("\n")}`,
    `## Connections\n${b.connections.map((f) => `### ${f.title}\n${f.text} ${cite(f.sourceIds)}`).join("\n\n")}`,
    `## Questions to explore\n${b.questions.map((q) => `- ${q}`).join("\n")}`,
    `## My notes\n${item.notes || "—"}`,
    `## Sources\n${item.sources.map((s) => `- [${s.id}] ${s.title}: ${s.url}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${b.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
