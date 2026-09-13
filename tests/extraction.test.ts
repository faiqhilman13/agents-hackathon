import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { extractPage } from '../shared/extract';

function page(html: string, url: string, selection = '') {
  const dom = new JSDOM(html, { url });
  try {
    return extractPage(dom.window.document, url, selection);
  } finally {
    dom.window.close();
  }
}

test('extracts the readable body of a generic article', () => {
  const capture = page(`<!doctype html>
    <title>Navigation title</title>
    <meta property="og:title" content="A useful article">
    <body>
      <nav>Account Pricing Help</nav>
      <main><article>
        <h1>A useful article</h1>
        <p>This is the opening paragraph of the article, with enough detail for Readability.</p>
        <p>This second paragraph contains the finding that the reader actually wants to keep.</p>
      </article></main>
      <footer>Legal links</footer>
    </body>`, 'https://example.com/notes/useful-article?utm_source=newsletter');

  assert.equal(capture.title, 'A useful article');
  assert.equal(capture.coverage, 'page');
  assert.match(capture.text, /opening paragraph/);
  assert.match(capture.text, /finding that the reader/);
  assert.doesNotMatch(capture.text, /Account Pricing Help|Legal links/);
});

test('captures only social content already loaded in the page', () => {
  const capture = page(`<!doctype html><title>Thread</title><body>
    <aside>Suggested accounts</aside>
    <main>
      <article>First loaded post and its visible details.</article>
      <article role="article">Second loaded reply in the current DOM.</article>
    </main>
  </body>`, 'https://x.com/researcher/status/123');

  assert.equal(capture.coverage, 'visible-content');
  assert.match(capture.text, /First loaded post/);
  assert.match(capture.text, /Second loaded reply/);
  assert.doesNotMatch(capture.text, /Suggested accounts/);
});

test('a selected passage takes precedence over the surrounding page', () => {
  const capture = page(`<!doctype html><title>Long essay</title><body>
    <article>The rest of this long essay should not be captured.</article>
  </body>`, 'https://example.org/essay', '  The exact passage the reader selected.  ');

  assert.equal(capture.coverage, 'selection');
  assert.equal(capture.text, 'The exact passage the reader selected.');
  assert.equal(capture.selection, '  The exact passage the reader selected.  ');
  assert.doesNotMatch(capture.text, /rest of this long essay/);
});

test('formulas are captured once, as TeX, instead of glyphs plus their source', () => {
  const capture = page(`<!doctype html><title>Dwarf galaxies</title><body><article class="ltx_document">
    <h1 class="ltx_title">Quenching in dwarf galaxies</h1>
    <div class="ltx_abstract"><p>We study isolated dwarf galaxies (<math alttext="{M}_{\\star}\\sim 10^{7-9}\\penalty 10000\\ {\\rm M}_{\\odot}" display="inline"><semantics><mrow><msub><mi>M</mi><mo>⋆</mo></msub><mo>∼</mo><msup><mn>10</mn><mrow><mn>7</mn><mo>−</mo><mn>9</mn></mrow></msup></mrow><annotation encoding="application/x-tex">{M}_{\\star}\\sim 10^{7-9}\\penalty 10000\\ {\\rm M}_{\\odot}</annotation></semantics></math>) with no signs of ongoing star formation.</p></div>
    <p>The halo relation is <math alttext="r \\propto M^{1/3}" display="block"><semantics><mi>r</mi><annotation encoding="application/x-tex">r \\propto M^{1/3}</annotation></semantics></math> for every galaxy in the sample, which the paper then discusses at length in several careful paragraphs of analysis.</p>
  </article></body>`, 'https://arxiv.org/html/2609.04385v1');

  assert.match(capture.text, /\$\{M\}_\{\\star\}\\sim 10\^\{7-9\}\\ \{\\rm M\}_\{\\odot\}\$/);
  assert.match(capture.text, /\$\$r \\propto M\^\{1\/3\}\$\$/);
  assert.doesNotMatch(capture.text, /⋆|∼|107−9|\\penalty/);
  assert.equal((capture.text.match(/\\odot/g) || []).length, 1, 'each formula appears once');
  assert.match(capture.description, /\$\{M\}_\{\\star\}/);
});

test('MathJax 2 formulas keep their TeX script instead of rendered glyphs', () => {
  const capture = page(`<!doctype html><title>Notes</title><body><article><h1>Notes</h1>
    <p>Energy is <span class="MathJax_Preview">E=mc2</span><span class="MathJax">E=mc2 glyphs</span><script type="math/tex">E = mc^2</script> in this long enough paragraph about relativity and its many consequences for physics.</p>
    <p>Display: <script type="math/tex; mode=display">\\int_0^1 x\\,dx</script> closes the argument with a second paragraph of explanatory text for readers.</p>
  </article></body>`, 'https://example.com/notes');

  assert.match(capture.text, /\$E = mc\^2\$/);
  assert.match(capture.text, /\$\$\\int_0\^1 x\\,dx\$\$/);
  assert.doesNotMatch(capture.text, /glyphs|E=mc2/);
});

test('an arXiv abstract page is labelled as abstract-only', () => {
  const capture = page(`<!doctype html><body>
    <h1 class="title">Title: Evidence-aware systems</h1>
    <meta name="citation_author" content="Ada Example">
    <meta name="citation_author" content="Lin Example">
    <blockquote class="abstract">Abstract: We present a careful abstract without claiming access to the full paper.</blockquote>
  </body>`, 'https://arxiv.org/abs/2401.01234v2');

  assert.equal(capture.title, 'Evidence-aware systems');
  assert.equal(capture.coverage, 'abstract');
  assert.equal(capture.arxivId, '2401.01234v2');
  assert.deepEqual(capture.authors, ['Ada Example', 'Lin Example']);
  assert.equal(capture.text, 'We present a careful abstract without claiming access to the full paper.');
});
