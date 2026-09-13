import { Readability } from '@mozilla/readability';
import { arxivId, type Capture } from './schema';

export function extractPage(doc: Document, pageUrl: string, selection = ''): Capture {
  const id = arxivId(pageUrl);
  const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[name="${name}"],meta[property="${name}"]`)?.content || '';
  const clean = (s: string) => s.replace(/[\t ]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  const title = meta('citation_title') || doc.querySelector('h1.title, h1.ltx_title')?.textContent?.replace(/^Title:\s*/, '') || meta('og:title') || doc.title || 'Untitled article';
  const authors = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]')].map(x => x.content);
  const abstract = clean(doc.querySelector('blockquote.abstract, .ltx_abstract')?.textContent?.replace(/^\s*Abstract:\s*/, '') || meta('description') || meta('og:description'));
  const clone = doc.cloneNode(true) as Document;
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
