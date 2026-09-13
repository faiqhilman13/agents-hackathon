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
