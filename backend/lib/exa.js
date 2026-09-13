/**
 * Exa search: turn "the page the user is reading" into ~8 related web pages.
 *
 * Exa's *neural* search matches on meaning rather than keywords, so we can
 * hand it a natural-language description of the article (title + opening
 * paragraph) and get back pages that are genuinely about the same ideas.
 */
import Exa from 'exa-js';

// How many candidates to fetch. The LLM later picks the best 3 of these.
const NUM_RESULTS = 8;

// How much of the article to use as the search query. Neural search works best
// with a focused description, not an entire 10,000-word article.
const QUERY_SNIPPET_CHARS = 600;

// Create the client lazily so a missing key produces a clear error at request
// time instead of crashing the whole function when the file is imported.
let exaClient = null;
function getExa() {
  if (!exaClient) exaClient = new Exa(process.env.EXA_API_KEY);
  return exaClient;
}

/** Build the natural-language query we send to Exa. */
export function buildQuery({ title, text }) {
  const snippet = collapseWhitespace(text).slice(0, QUERY_SNIPPET_CHARS);
  return title ? `${title.trim()}. ${snippet}` : snippet;
}

/**
 * Search Exa for pages related to the article.
 * Returns an array of candidates shaped like our final suggestion objects
 * (minus `whyItMatters`, which the LLM writes later).
 */
export async function searchRelated({ url, title, text }) {
  const query = buildQuery({ title, text });

  const response = await getExa().searchAndContents(query, {
    type: 'neural',          // semantic search (vs. "keyword")
    numResults: NUM_RESULTS, // 8 candidates for the LLM to choose from
    highlights: {
      numSentences: 2,       // each highlight is a 2-sentence excerpt...
      highlightsPerUrl: 1,   // ...and we only need the single best one per page
    },
  });

  const currentUrl = normalizeUrl(url);

  return (response.results || [])
    .filter((result) => result.url && normalizeUrl(result.url) !== currentUrl) // don't recommend the page itself
    .map((result) => ({
      title: collapseWhitespace(result.title) || result.url,
      url: result.url,
      source: hostnameOf(result.url),
      highlight: collapseWhitespace(result.highlights?.[0] || '').slice(0, 400),
      // Extra context that helps the LLM rank (not returned to the extension):
      publishedDate: result.publishedDate || null,
      author: result.author || null,
    }));
}

/** "https://www.nytimes.com/2024/..." -> "nytimes.com" */
export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Compare URLs loosely: ignore protocol, "www.", trailing slash, #hash and ?query. */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
