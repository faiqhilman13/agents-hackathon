import type { Store } from './store';
import type { Configuration, Settings } from './settings';
import { extractiveBrief, uniqueSources, providers as realProviders, type Providers } from './providers';
import { normalizeUrl, type ReadingBridge, type Research, type Source, type SourcePick } from '../shared/schema';
import { recentReads, savedOriginals, wantsExternalSources, wantsLibrary, type RecentRead } from './library';
import { bridgeReads, pickSources } from './layers';

const SEARCH_STOP_WORDS=new Set(['about','after','also','among','because','between','could','from','have','into','more','most','other','related','research','should','some','such','than','that','their','these','this','those','through','using','what','when','where','which','while','with','would']);
function searchTerms(value:string) {
  return new Set((value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(word=>!SEARCH_STOP_WORDS.has(word)));
}
function relevantResults(query:string,candidates:Awaited<ReturnType<Providers['search']>>) {
  const queryTerms=searchTerms(query);
  return candidates.filter((candidate,index)=>{
    if(index===0) return true; // Preserve Exa's strongest ranked result for semantic matches with different wording.
    const textTerms=searchTerms(`${candidate.title} ${candidate.text.slice(0,4000)}`);
    for(const word of queryTerms) if(textTerms.has(word)) return true;
    return false;
  });
}

export class ResearchQueue {
  private active = new Map<string,AbortController>();
  private busy=false;
  constructor(private store:Store, private config:Configuration,private providers:Providers=realProviders) {}
  recover() {
    for(const r of this.store.list()) if(r.status==='running') this.store.update(r.id,{status:'failed',stage:'Interrupted',error:'The local server stopped during research. Your captured page is saved; retry to continue.'});
    this.kick();
  }
  cancel(id:string) { this.active.get(id)?.abort(); const item=this.store.get(id); if(item && ['queued','running'].includes(item.status)) this.store.update(id,{status:'cancelled',stage:'Cancelled'}); }
  kick() { if(!this.busy) void this.drain(); }
  private async drain() {
    this.busy=true;
    try { for(;;) { const job=this.store.list().reverse().find(r=>r.status==='queued'); if(!job) break; await this.run(job); } }
    finally { this.busy=false; }
  }
  /** Reading memory: flag related sources that strongly overlap a page read recently. Never fails the job. */
  private async annotateHistory(sources:Source[],reads:RecentRead[],settings:Settings,signal:AbortSignal):Promise<Source[]> {
    const key=(url:string)=>{try{return normalizeUrl(url);}catch{return url;}};
    const readKeys=reads.map(read=>key(read.url));
    return Promise.all(sources.map(async source=>{
      if(source.kind==='original') return source;
      let index=readKeys.indexOf(key(source.url)); // An exact page match needs no model call.
      if(index<0 && this.providers.historyOverlap) {
        try { index=(await this.providers.historyOverlap(source,reads,settings,signal)) ?? -1; }
        catch { signal.throwIfAborted(); index=-1; }
      }
      return index>=0 ? {...source,fromHistory:true,readContext:`You read ${reads[index].title} recently.`} : {...source,fromHistory:false};
    }));
  }
  private async run(job:Research) {
    const controller=new AbortController(); const signal=controller.signal; this.active.set(job.id,controller);
    const update=(changes:Partial<Research>)=>{signal.throwIfAborted();return this.store.update(job.id,changes);};
    const warnings:string[]=[]; const settings=this.config.get();
    try {
      update({status:'running',stage:'Reading the original',progress:12,error:undefined});
      const capture=await this.providers.resolve(job.input.capture,settings,signal);
      if(capture.text.trim().length<100) throw new Error('No readable article text was found. Open the article HTML or its arXiv abstract page and try again.');
      if(capture.coverage==='abstract') warnings.push('Only the abstract was available. This brief does not represent a full-paper review.');
      if(capture.coverage==='visible-content') warnings.push('This capture includes loaded page content only. It does not include the complete feed, hidden replies, or unloaded posts.');
      if(capture.coverage==='selection') warnings.push('This brief is scoped to the passage you selected.');
      if(capture.text.length>=120000) warnings.push('The captured source was limited to the first 120,000 characters.');
      update({input:{...job.input,capture},sources:uniqueSources(capture,[]),warnings});
      let sources=uniqueSources(capture,[]);
      // Reading memory: pages researched before this one steer synthesis and flag overlapping sources.
      const reads=recentReads(this.store.list(),job.id,capture.url);
      const libraryIntent=wantsLibrary(job.input.question);
      const libraryOnly=libraryIntent && !wantsExternalSources(job.input.question);
      if(libraryIntent) {
        update({stage:'Finding connections in your library',progress:24});
        const saved=savedOriginals(job.input.question,this.store.list(),job.id);
        sources=uniqueSources(capture,saved);
        if(!saved.length) warnings.push('No other completed briefs matched this saved-library request.');
      }
      if(job.input.enrich && settings.exaKey && !libraryOnly) {
        update({stage:'Planning the search',progress:28});
        let queries:string[];
        try { queries=await this.providers.plan(capture,job.input.question,settings,signal); }
        catch(e) {signal.throwIfAborted();warnings.push('Search planning was unavailable; searched using the page title and your question.'); queries=[`${capture.title} ${job.input.question || 'related research limitations'}`.slice(0,500)];}
        update({stage:'Finding related work with Exa',progress:43,warnings});
        const results=await Promise.allSettled(queries.map(async query=>({query,candidates:await this.providers.search(query,settings,signal,!!capture.arxivId)})));
        signal.throwIfAborted();
        const unfiltered=results.flatMap(r=>r.status==='fulfilled'?r.value.candidates:[]);
        const candidates=results.flatMap(r=>r.status==='fulfilled'?relevantResults(r.value.query,r.value.candidates):[]);
        for(const r of results) if(r.status==='rejected') warnings.push(r.reason instanceof Error?r.reason.message:'An Exa search failed.');
        if(candidates.length<unfiltered.length) warnings.push(`${unfiltered.length-candidates.length} weakly matched search ${unfiltered.length-candidates.length===1?'result was':'results were'} omitted.`);
        const existing=sources.slice(1).map(({id:_id,...source})=>source);
        sources=uniqueSources(capture,[...existing,...candidates]);
        if(sources.length===1) warnings.push('No usable related-source text was returned. The brief uses the original only.');
      } else if(job.input.enrich && !libraryOnly) warnings.push('Exa is not connected. Saved the original without external enrichment.');
      update({sources,stage:'Writing the research brief',progress:72,warnings});
      let brief=extractiveBrief(capture); let mode:Research['mode']='extractive';
      if(settings.llmKey) {
        if(capture.text.length>45000) warnings.push('The complete source capture is saved, but AI synthesis used the first 45,000 characters. Claims beyond that model context are not represented in the brief.');
        try { brief=await this.providers.synthesize(capture,job.input.question,sources,settings,signal,reads); mode='synthesis'; }
        catch(e) {signal.throwIfAborted();warnings.push('Synthesis was unavailable or failed citation checks. Saved source excerpts instead. '+(e instanceof Error?e.message:''));}
      } else warnings.push('No language model is connected. This is an extractive source digest, not an AI synthesis.');
      let picks:SourcePick[]=[]; let bridge:ReadingBridge|undefined;
      if(mode==='synthesis') {
        // Layer 1: choose the sharpest related sources before uncited ones are dropped. Failure is silent.
        if(this.providers.json && sources.length>1) {
          update({stage:'Choosing the sharpest sources',progress:84});
          try { picks=await pickSources(this.providers.json,capture,brief,sources,reads,settings,signal); }
          catch { signal.throwIfAborted(); }
        }
        const used=new Set([...[brief.overview,...brief.takeaways,...brief.connections].flatMap(f=>f.sourceIds),...picks.map(pick=>pick.sourceId)]);
        sources=sources.filter(s=>used.has(s.id));
        if((job.input.enrich||libraryIntent) && sources.length===1 && !warnings.some(w=>w.includes('related-source'))) warnings.push('No external connection was included: the retrieved material did not support a useful, source-linked addition.');
      }
      if(mode==='synthesis' && reads.length && sources.length>1) {
        update({stage:'Checking your recent reading',progress:92});
        sources=await this.annotateHistory(sources,reads,settings,signal);
      }
      // Layer 3: look for a page that bridges two earlier reads. Failure is silent.
      if(mode==='synthesis' && this.providers.json && reads.filter(read=>read.researchId).length>=2) {
        update({stage:'Mapping your earlier reading',progress:96});
        try { bridge=await bridgeReads(this.providers.json,capture,brief,reads,settings,signal); }
        catch { signal.throwIfAborted(); }
      }
      update({brief,mode,sources,picks:picks.length?picks:undefined,bridge,warnings:[...new Set(warnings)],status:'complete',stage:'Research ready to discuss',progress:100});
    } catch(e) {
      if(!signal.aborted && this.store.get(job.id)) this.store.update(job.id,{status:'failed',stage:'Research paused',error:e instanceof Error?e.message:'Research failed. Try again.',warnings});
    } finally { this.active.delete(job.id); }
  }
}
