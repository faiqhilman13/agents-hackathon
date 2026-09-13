import { normalizeUrl, publicUrl, type Research } from '../shared/schema';

const LIBRARY_INTENT = /\b(?:library|saved(?:\s+(?:research|work|briefs?|papers?|articles?))?|briefs?|collections?|knowledge[ -]?base|notes?|my\s+(?:papers?|research|reading|saved\s+work)|across\s+(?:my\s+)?(?:research|reading))\b/i;
const EXTERNAL_INTENT = /\b(?:exa|web|internet|online|external|outside|latest|new\s+sources?|current\s+(?:evidence|literature|research))\b/i;
const STOP_WORDS = new Set(['about','after','again','also','among','base','because','being','between','brief','briefs','collection','collections','connect','connected','connection','connections','could','does','from','have','into','itself','knowledge','library','more','most','note','notes','other','research','saved','should','some','such','than','that','their','there','these','they','this','those','through','using','very','what','when','where','which','while','with','would','your']);

export function wantsLibrary(message:string) { return LIBRARY_INTENT.test(message); }
export function wantsExternalSources(message:string) { return EXTERNAL_INTENT.test(message); }

export function terms(value:string):Set<string> {
  return new Set((value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word=>!STOP_WORDS.has(word)));
}
export function overlap(query:Set<string>, value:string):number {
  const found=terms(value); let score=0;
  for(const word of query) if(found.has(word)) score++;
  return score;
}

export function libraryCandidates(message:string, library:Research[], currentId:string, limit=12):Research[] {
  if(!wantsLibrary(message)) return [];
  const needle=terms(message);
  return library.filter(entry=>entry.id!==currentId && entry.status==='complete' && entry.mode!=='demo' && entry.inLibrary!==false && !!entry.brief)
    .map((entry,index)=>({entry,index,score:overlap(needle,[entry.brief!.title,entry.brief!.overview.text,...entry.brief!.tags].join(' '))}))
    .sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).map(candidate=>candidate.entry);
}

export function librarySources(query:string, candidates:Research[], limit=3) {
  const needle=terms(query); const ranked=candidates.map((entry,index)=>{
    const original=entry.sources.find(source=>source.kind==='original');
    const summary=[entry.brief?.title,entry.brief?.overview.text,...(entry.brief?.tags || []),original?.title,original?.text.slice(0,3000)].filter(Boolean).join(' ');
    return {entry,original,index,score:overlap(needle,summary)};
  }).filter(candidate=>candidate.original && publicUrl(candidate.original.url))
    .sort((a,b)=>b.score-a.score || a.index-b.index);
  const matched=ranked.filter(candidate=>candidate.score>0);
  return (matched.length ? matched : ranked).slice(0,limit);
}

export function savedOriginals(message:string, library:Research[], currentId:string) {
  return librarySources(message,libraryCandidates(message,library,currentId)).map(candidate=>{
    const {id:_id,...original}=candidate.original!;
    return {...original,kind:'related' as const,reason:`Saved brief: ${candidate.entry.brief!.title}`};
  });
}

export type RecentRead = { title:string; url:string; readAt:string };

/**
 * Reading memory: distinct pages researched before this one, newest first.
 * Every capture is already a local record, so no separate log or user ID is needed.
 * Unsaved drafts count (the user still read them); demos and the current page do not.
 */
export function recentReads(library:Research[], currentId:string, currentUrl:string, limit=20):RecentRead[] {
  const key=(url:string)=>{try{return normalizeUrl(url);}catch{return url;}};
  const seen=new Set([key(currentUrl)]); const reads:RecentRead[]=[];
  for(const entry of library) { // Store.list() is newest first.
    if(reads.length>=limit) break;
    if(entry.id===currentId || entry.mode==='demo') continue;
    const {url,title}=entry.input.capture; const normalized=key(url);
    if(seen.has(normalized)) continue;
    seen.add(normalized); reads.push({title,url,readAt:entry.createdAt});
  }
  return reads;
}
