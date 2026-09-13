// Split text into plain and TeX segments: $$...$$ and \[...\] (display), $...$ and \(...\) (inline).
// A single-$ span only counts as math when it looks like TeX (contains \ ^ _ { or }),
// so prices such as "$5 and $10" stay plain text.
export type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

const PATTERN =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g;

export function splitMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const [whole, display, bracket, paren, inline] = match;
    if (inline !== undefined && !/[\\^_{}]/.test(inline)) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", value: text.slice(last, start) });
    segments.push({
      kind: "math",
      value: (display ?? bracket ?? paren ?? inline ?? "").trim(),
      display: display !== undefined || bracket !== undefined,
    });
    last = start + whole.length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  return segments;
}
