import { randomUUID } from 'node:crypto';
import type { Store } from './store';
export function seedDemo(store:Store) {
  const existing=store.list().find(r=>r.mode==='demo'); if(existing) return existing.inLibrary===true?existing:store.update(existing.id,{inLibrary:true});
  const {item}=store.create({requestId:randomUUID(),question:'How does retrieval help a language model use knowledge?',collection:'Machine learning',enrich:false,capture:{
    url:'https://arxiv.org/abs/2005.11401',title:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',authors:['Patrick Lewis et al.'],
    text:'Illustrative demo notes: Retrieval-augmented generation combines a language model with retrieved documents. The retrieval component selects passages that become evidence for generation. This separates some external knowledge from the model parameters. The quality of the result depends on retrieval and the way the generator uses the retrieved passages.',
    selection:'',description:'',capturedAt:new Date().toISOString(),coverage:'abstract'
  }});
  return store.update(item.id,{status:'complete',stage:'Example brief',progress:100,mode:'demo',inLibrary:true,warnings:['Illustrative example with hand-authored notes. No live extraction, Exa search, or model call was performed.'],sources:[
    {id:'S0',kind:'original',title:item.input.capture.title,url:item.input.capture.url,text:item.input.capture.text},
    {id:'S1',kind:'related',title:'REALM: Retrieval-Augmented Language Model Pre-Training',url:'https://arxiv.org/abs/2002.08909',text:'Illustrative reading note: REALM explores retrieval during language-model pre-training. Read the linked paper to verify the comparison.'}
  ],brief:{title:item.input.capture.title,overview:{text:'An example of a research brief that connects what you are reading to a wider body of work. This paper explores using retrieved documents alongside a language model for knowledge-intensive tasks.',sourceIds:['S0']},
    takeaways:[{text:'Separate the model’s learned parameters from an external collection of documents. That distinction makes the role of retrieval easier to examine.',sourceIds:['S0']},{text:'Read retrieval quality and generation quality as two separate questions. Finding a relevant passage does not establish that an answer uses it faithfully.',sourceIds:['S0']}],
    connections:[{title:'A useful comparison: retrieval during pre-training',relationship:'context',text:'REALM is a suggested next read for comparing where retrieval enters a learning pipeline. This connection is an illustrative reading prompt, not a verified result from a live search.',sourceIds:['S0','S1']}],questions:['How is the retrieval component trained?','Which experiments isolate the contribution of retrieved evidence?'],tags:['Retrieval','Language models','NLP']}});
}
