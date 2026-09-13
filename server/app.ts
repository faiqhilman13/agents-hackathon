import express from 'express';
import { resolve } from 'node:path';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store';
import { Configuration, settingsPatchSchema } from './settings';
import { ResearchQueue } from './research';
import { normalizeUrl, researchSchema } from '../shared/schema';
import { seedDemo } from './demo';
import { chat } from './chat';
import { providers as realProviders, type Providers } from './providers';
import { askLibrary, challengeQuestions, findGaps, weeklyReflection } from './layers';

export function createApp(dir:string, options:{port?:number;providers?:Providers;recover?:boolean}={}) {
  const store=new Store(dir); const config=new Configuration(dir); const queue=new ResearchQueue(store,config,options.providers);
  const app=express(); const port=options.port ?? 4317;
  const local=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const origin=req.get('origin');
    if(origin && !local.has(origin) && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {res.status(403).json({error:'This local API accepts requests from Margin only.'});return;}
    if(origin) {res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');}
    res.set('Access-Control-Allow-Headers','Content-Type, Authorization');res.set('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','same-origin');res.set('X-Frame-Options','DENY');
    if(req.method==='OPTIONS') {res.sendStatus(204);return;} next();
  });
  app.use(express.json({limit:'2mb'}));
  app.get('/api/status',(_req,res)=>res.json({ok:true,...config.public()}));
  app.get('/api/connection',(req,res)=>{
    // Only the local library can bootstrap pairing. Extension pages must paste this token once.
    let referer='';try{referer=new URL(req.get('referer')||'').origin;}catch{/* absent */}
    if(!local.has(referer) || (req.get('origin') && !local.has(req.get('origin')!))) {res.status(403).json({error:'Open the local library to pair the extension.'});return;}
    res.json({token:config.token});
  });
  app.use('/api',(req,res,next)=>{
    const value=req.get('authorization')?.replace(/^Bearer /,'') || '';
    const a=Buffer.from(value),b=Buffer.from(config.token);
    if(a.length!==b.length || !timingSafeEqual(a,b)) {res.status(401).json({error:'Pair Margin with your local server in the extension settings.'});return;} next();
  });
  app.get('/api/settings',(_req,res)=>res.json(config.public()));
  app.post('/api/settings',(req,res)=>{
    const data=settingsPatchSchema.parse(req.body);
    res.json(config.save(data));
  });
  app.get('/api/research',(_req,res)=>res.json(store.list()));
  // Auto-read reuses the latest research for a page instead of queueing the same page again.
  // Registered before /api/research/:id so "by-url" is not treated as an id.
  app.get('/api/research/by-url',(req,res)=>{
    const url=typeof req.query.url==='string'?req.query.url:'';
    let key='';
    try{key=normalizeUrl(url);}catch{res.status(400).json({error:'Provide a valid page URL.'});return;}
    const item=store.list().find(entry=>{
      if(entry.mode==='demo') return false;
      try{return normalizeUrl(entry.input.capture.url)===key;}catch{return false;}
    });
    if(!item){res.status(404).json({error:'No research for this page yet.'});return;}
    res.json(item);
  });
  app.get('/api/research/:id',(req,res)=>{const item=store.get(req.params.id); if(!item){res.status(404).json({error:'Brief not found.'});return;}res.json(item);});
  app.post('/api/research',(req,res)=>{
    const data=researchSchema.parse(req.body);
    if(store.list().filter(r=>['running','queued'].includes(r.status)).length>=10) {res.status(429).json({error:'Finish or cancel a queued research job first.'});return;}
    const {item,created}=store.create(data);res.status(created?202:200).json(item);queue.kick();
  });
  app.post('/api/demo',(_req,res)=>res.json(seedDemo(store)));
  app.patch('/api/research/:id',(req,res)=>{
    if(!store.get(req.params.id)){res.status(404).json({error:'Brief not found.'});return;}
    const patch=z.object({notes:z.string().max(20000).optional(),favorite:z.boolean().optional(),collection:z.string().trim().min(1).max(60).optional(),inLibrary:z.literal(true).optional()}).strict().parse(req.body);
    res.json(store.update(req.params.id,patch));
  });
  app.post('/api/research/:id/cancel',(req,res)=>{queue.cancel(req.params.id);res.json({ok:true});});
  app.post('/api/research/:id/retry',(req,res)=>{
    const item=store.get(req.params.id);if(!item){res.status(404).json({error:'Brief not found.'});return;}
    if(!['failed','cancelled'].includes(item.status)){res.status(409).json({error:'Only failed or cancelled research can be retried.'});return;}
    const updated=store.update(item.id,{status:'queued',progress:0,stage:'Waiting to retry',error:undefined});res.json(updated);queue.kick();
  });
  const chatting=new Set<string>();
  app.post('/api/research/:id/chat',async(req,res)=>{
    const id=req.params.id;const item=store.get(id);
    if(!item||item.status!=='complete'){res.status(409).json({error:'Wait for the brief to finish before asking a follow-up.'});return;}
    if(chatting.has(id)){res.status(409).json({error:'An answer is already being written.'});return;}
    if(item.mode==='demo'){res.status(409).json({error:'This is an illustrative example. Research a real tab to start a conversation.'});return;}
    const {message}=z.object({message:z.string().trim().min(1).max(4000)}).parse(req.body);
    chatting.add(id);
    try {
      const result=await chat(item,message,config.get(),new AbortController().signal,store.list(),options.providers);
      const latest=store.get(id);if(!latest) {res.status(404).json({error:'This brief was deleted.'});return;}
      const now=new Date().toISOString();
      const notes=result.noteToAppend?[latest.notes,result.noteToAppend].filter(Boolean).join('\n\n'):latest.notes;
      if(notes.length>20000) throw new Error('This brief has reached the 20,000-character note limit. Edit or shorten its notes before adding more.');
      res.json(store.update(id,{sources:result.sources,notes,...(result.saveToLibrary?{inLibrary:true}:{}),messages:[...(latest.messages||[]),{role:'user',text:message,createdAt:now},{role:'assistant',text:result.text,sourceIds:result.sourceIds,createdAt:now}].slice(-100) as NonNullable<typeof item.messages>}));
    } finally {chatting.delete(id);}
  });
  // Reading layers 4-7. Each runs only when the user asks, and needs a connected language model.
  const layerContext=(res:express.Response)=>{
    const settings=config.get(); const providerSet=options.providers ?? realProviders;
    if(!settings.llmKey || !providerSet.json) {res.status(409).json({error:'Connect a language model in Settings to use this.'});return undefined;}
    return {settings,json:providerSet.json,search:(query:string,s:typeof settings,signal:AbortSignal)=>providerSet.search(query,s,signal)};
  };
  app.post('/api/research/:id/challenge',async(req,res)=>{
    const item=store.get(req.params.id);
    if(!item || item.status!=='complete' || !item.brief) {res.status(409).json({error:'Wait for the brief to finish before testing your thinking.'});return;}
    const context=layerContext(res); if(!context) return;
    res.json({questions:await challengeQuestions(context.json,item,store.list(),context.settings,AbortSignal.timeout(90000))});
  });
  app.post('/api/library/ask',async(req,res)=>{
    const {message,conversation}=z.object({message:z.string().trim().min(1).max(4000),conversation:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(6000)})).max(20).default([])}).parse(req.body);
    const context=layerContext(res); if(!context) return;
    res.json(await askLibrary(context.json,message,store.list(),context.settings,AbortSignal.timeout(90000),conversation));
  });
  app.post('/api/library/gaps',async(req,res)=>{
    const {topic}=z.object({topic:z.string().trim().min(3).max(500)}).parse(req.body);
    const context=layerContext(res); if(!context) return;
    res.json(await findGaps(context.json,context.search,topic,store.list(),context.settings,AbortSignal.timeout(120000)));
  });
  app.get('/api/library/reflection',async(_req,res)=>{
    const context=layerContext(res); if(!context) return;
    res.json(await weeklyReflection(context.json,context.search,store.list(),context.settings,AbortSignal.timeout(120000)));
  });
  app.delete('/api/research/:id',(req,res)=>{queue.cancel(req.params.id);store.delete(req.params.id);res.json({ok:true});});
  app.use(express.static(resolve('dist/extension'),{index:'index.html'}));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    res.status(error instanceof z.ZodError?400:500).json({error:error instanceof z.ZodError?error.issues.map(i=>i.message).join(' '):error instanceof Error?error.message:'Something went wrong.'});
  });
  if(options.recover!==false) queue.recover();
  return {app,store,config,queue};
}
