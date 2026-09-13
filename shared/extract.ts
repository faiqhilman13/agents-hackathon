import { Readability } from '@mozilla/readability';
import { arxivId, type Capture } from './schema';

/** Clean TeX copied from alttext or annotations so it can be rendered later (drops line-break hints KaTeX does not know). */
export function cleanTex(tex: string): string {
  return tex
    .replace(/\\(?:penalty|linebreak|nolinebreak)\s*-?\d*/g, '')
    .replace(/\\(?:allowbreak|nobreak)\b/g, '')
    .replace(/%\s*\n/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scientific pages keep each formula twice: rendered glyphs (or MathML tokens) plus its TeX source.
 * Reading textContent concatenates both ("M⋆∼107−9M⊙{M}_{\star}\sim 10^{7-9}"). Replace each formula
 * with one copy of its TeX in $...$ (or $$...$$ for display math) before extraction.
 */
function normalizeMath(doc: Document): void {
  const replace = (node: Element, tex: string, display: boolean) => {
    const cleaned = cleanTex(tex);
    if (!cleaned) return false;
    node.replaceWith(doc.createTextNode(display ? ` $$${cleaned}$$ ` : ` $${cleaned}$ `));
    return true;
  };
  // MathJax 2: the TeX lives in <script type="math/tex">, next to rendered preview and output spans.
  doc.querySelectorAll('.MathJax_Preview,.MathJax,.MathJax_Display,.MathJax_SVG,.MathJax_SVG_Display,.MathJax_CHTML,.MJX_Assistive_MathML').forEach(e => e.remove());
  doc.querySelectorAll<HTMLScriptElement>('script[type^="math/tex"]').forEach(script =>
    replace(script, script.textContent || '', /mode\s*=\s*display/.test(script.type)));
  // MathML (arXiv/LaTeXML, KaTeX, MathJax 3 assistive markup): prefer alttext, then the TeX annotation.
  doc.querySelectorAll('math').forEach(math => {
    const annotation = [...math.querySelectorAll('annotation')].find(a => /tex/i.test(a.getAttribute('encoding') || ''));
    const tex = math.getAttribute('alttext') || annotation?.textContent || '';
    if (!replace(math, tex, math.getAttribute('display') === 'block')) math.querySelectorAll('annotation,annotation-xml').forEach(a => a.remove());
  });
}

export function extractPage(doc: Document, pageUrl: string, selection = ''): Capture {
  const id = arxivId(pageUrl);
  const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"],meta[property="${name}"]`)?.content || '';
  const clean = (s: string) => s.replace(/[\t ]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  const title = meta('citation_title') || doc.querySelector('h1.title, h1.ltx_title')?.textContent?.replace(/^Title:\s*/, '') || meta('og:title') || doc.title || 'Untitled article';
  const authors = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]')].map(x => x.content);
  const clone = doc.cloneNode(true) as Document;
  normalizeMath(clone);
  const abstract = clean(clone.querySelector('blockquote.abstract, .ltx_abstract')?.textContent?.replace(/^\s*Abstract:\s*/, '') || meta('description') || meta('og:description'));
  clone.querySelectorAll('script,style,nav,header,footer,form,input,textarea,select,[hidden],[aria-hidden="true"]').forEach(e => e.remove());
  let content = '';
  const social=/(^|\.)(x\.com|twitter\.com|facebook\.com|linkedin\.com|reddit\.com|instagram\.com|threads\.(net|com))$/.test(new URL(pageUrl).hostname);
  if (selection.trim()) content=selection.trim();
  else if (id && new URL(pageUrl).pathname.startsWith('/abs/')) content = abstract;
  else if(social) {
    const posts=[...clone.querySelectorAll('article,[role="article"]')];
    content=posts.length ? posts.map(e=>e.textContent).join('\n\n——\n\n') : clone.querySelector('main,[role="main"]')?.textContent || clone.body?.textContent || '';
  }
  else {
    try { content = new Readability(clone).parse()?.textContent || ''; } catch { /* use semantic fallback */ }
    if (!content.trim()) content = clone.querySelector('article,main,[role="main"]')?.textContent || clone.body?.textContent || '';
  }
  return {
    url: pageUrl, title: clean(title).slice(0,500), authors, description: abstract.slice(0,12000),
    text: clean(content).slice(0,120000), selection: selection.slice(0,8000),
    capturedAt: new Date().toISOString(), arxivId: id,
    coverage: !content.trim() ? 'unavailable' : selection.trim() ? 'selection' : social ? 'visible-content' : id && new URL(pageUrl).pathname.startsWith('/abs/') ? 'abstract' : id ? 'full-text' : 'page'
  };
}
