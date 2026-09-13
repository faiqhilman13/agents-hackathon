/**
 * LLM ranking: pick the sharpest 3 of Exa's candidates and explain each in
 * one line.
 *
 * We use the official `openai` SDK, but point it at OpenRouter's
 * OpenAI-compatible API, so swapping models is a one-string change (MODEL).
 *
 * Anti-hallucination design: the LLM never writes URLs or titles. It only
 * returns candidate *numbers* plus a "why it matters" sentence. We then look
 * the real title/url/highlight up from Exa's results. Every link is real.
 */
import OpenAI from 'openai';

export const MODEL = 'openai/gpt-4o-mini';

const MAX_PICKS = 3;

// How much of the article the LLM sees. ~3k chars is plenty to understand the
// topic and keeps the call fast and cheap.
const ARTICLE_CHARS_FOR_LLM = 3000;

let llmClient = null;
function getLLM() {
  if (!llmClient) {
    llmClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      // Optional OpenRouter attribution headers (show up in your OpenRouter dashboard).
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/faiqhilman13/agents-hackathon',
        'X-Title': 'Cortex',
      },
    });
  }
  return llmClient;
}

// ---------------------------------------------------------------------------
// The prompt. Tweak this to change Cortex's "taste".
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Cortex, a research companion that sits beside whatever article the user is reading.
You receive the article and a numbered list of candidate sources found by semantic web search.

Choose the ${MAX_PICKS} SHARPEST candidates — the ones that would most deepen the reader's understanding. Aim for this mix:
1. "canonical"  — the primary or most authoritative source on the article's core topic (original research, official docs, the foundational piece).
2. "opposing"   — the strongest counter-argument, critique, or competing view.
3. "unexpected" — a surprising connection from a different field, era, or angle that still genuinely illuminates the article.
If no candidate fits a role, pick the next most valuable source instead. Never pick near-duplicates of the article or of each other.

For each pick write "whyItMatters": ONE sentence, max 22 words, specific to how this source relates to THIS article.
No hype, no "This article...", don't restate the title.

Respond with JSON only, in exactly this shape:
{"picks":[{"index":<candidate number>,"role":"canonical"|"opposing"|"unexpected","whyItMatters":"<sentence>"}]}`;

/** Build the user message: the article, then the numbered candidates. */
function buildUserPrompt(article, candidates) {
  const articleText = String(article.text || '').replace(/\s+/g, ' ').slice(0, ARTICLE_CHARS_FOR_LLM);

  const candidateLines = candidates
    .map((c, i) => {
      const meta = [c.source, c.author, c.publishedDate?.slice(0, 10)].filter(Boolean).join(' · ');
      return `[${i + 1}] ${c.title}\n    ${meta}\n    Excerpt: ${c.highlight || '(none)'}`;
    })
    .join('\n\n');

  return `ARTICLE BEING READ
Title: ${article.title || '(untitled)'}
URL: ${article.url || '(unknown)'}
Text: ${articleText}

CANDIDATE SOURCES
${candidateLines}`;
}

/**
 * Rank candidates and return exactly the API's suggestion shape:
 *   [{ title, url, source, highlight, whyItMatters }, ...] (up to 3)
 *
 * Never throws: if the LLM is unavailable or returns junk, we fall back to
 * Exa's own ordering so the sidebar still shows something useful.
 */
export async function rankWithLLM(article, candidates) {
  if (candidates.length === 0) return [];

  let picks = [];
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[cortex] OPENROUTER_API_KEY is not set — returning Exa results unranked.');
  } else {
    try {
      const completion = await getLLM().chat.completions.create({
        model: MODEL,
        temperature: 0.3, // a little creativity for the "unexpected" pick, but stay grounded
        max_tokens: 500,
        response_format: { type: 'json_object' }, // ask the model for strict JSON
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(article, candidates) },
        ],
      });
      picks = parsePicks(completion.choices?.[0]?.message?.content, candidates.length);
    } catch (err) {
      console.error('[cortex] LLM ranking failed, falling back to Exa order:', err.message);
    }
  }

  // Turn picks (candidate numbers) back into real suggestion objects.
  const used = new Set();
  const suggestions = [];
  for (const pick of picks) {
    if (suggestions.length === MAX_PICKS) break;
    used.add(pick.index);
    suggestions.push(toSuggestion(candidates[pick.index], pick.whyItMatters));
  }

  // Top up with Exa's best remaining results if the LLM returned fewer than 3.
  for (let i = 0; i < candidates.length && suggestions.length < MAX_PICKS; i++) {
    if (used.has(i)) continue;
    used.add(i);
    suggestions.push(toSuggestion(candidates[i], fallbackWhy(candidates[i])));
  }

  return suggestions;
}

/**
 * Safely parse the model's JSON. Returns [{ index (0-based), whyItMatters }].
 * Drops anything malformed, out of range, or duplicated.
 */
function parsePicks(content, candidateCount) {
  if (!content) return [];

  let parsed;
  try {
    // Some models wrap JSON in ```json fences even in JSON mode — strip them.
    const cleaned = content.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const match = content.match(/\{[\s\S]*\}/); // last resort: grab the first {...} block
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const rawPicks = Array.isArray(parsed?.picks) ? parsed.picks : [];
  const seen = new Set();
  const picks = [];

  for (const raw of rawPicks) {
    const index = Number(raw?.index) - 1; // prompt numbers candidates from 1
    const why = String(raw?.whyItMatters || '').trim();
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) continue;
    if (seen.has(index) || !why) continue;
    seen.add(index);
    picks.push({ index, whyItMatters: why });
  }
  return picks;
}

function toSuggestion(candidate, whyItMatters) {
  return {
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    highlight: candidate.highlight,
    whyItMatters,
  };
}

function fallbackWhy(candidate) {
  return `Closely related coverage from ${candidate.source || 'another source'}.`;
}
