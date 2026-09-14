import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {annotatedPdf} from '../src/pdf-annotations.ts';
import {reviseSelection} from '../src/document-revision.ts';

test('PDF notes preserve source pages and flow onto additional pages without clipping',async()=>{
 const source=await PDFDocument.create();source.addPage([300,400]);
 const original=new Blob([new Uint8Array(await source.save())]);
 const result=await PDFDocument.load(await(await annotatedPdf(original,[{page:1,text:Array.from({length:100},(_,i)=>'Note line '+i).join('\n')}])).arrayBuffer());
 assert.equal(result.getPage(0).getWidth(),300);
 assert.equal(result.getPage(0).getHeight(),400);
 assert.ok(result.getPageCount()>=4);
 assert.equal((await PDFDocument.load(await original.arrayBuffer())).getPageCount(),1);
 await assert.rejects(()=>annotatedPdf(original,[{page:2,text:'Invalid page'}]),/no longer/);
 await assert.rejects(()=>annotatedPdf(original,[{page:1,text:'日本語'}]),/Latin characters/);
});

test('AI revisions handle split stream events and reject incomplete edits',async()=>{
 const fetchOriginal=globalThis.fetch;
 try{
  let sent:Record<string,unknown>={};
  globalThis.fetch=async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(new ReadableStream({start(controller){for(const part of ['{"type":"del','ta","text":"Clear "}\n','{"type":"delta","text":"text."}\n{"type":"done"}\n'])controller.enqueue(new TextEncoder().encode(part));controller.close();}}));};
  const updates:string[]=[];
  assert.equal(await reviseSelection('openai','old text','Clarify',new AbortController().signal,t=>updates.push(t)),'Clear text.');
  assert.deepEqual(updates,['Clear ','Clear text.']);assert.equal(sent.mode,'step');
  globalThis.fetch=async()=>new Response('{"type":"delta","text":"partial"}\n');
  await assert.rejects(()=>reviseSelection('openai','old','Edit',new AbortController().signal,()=>{}),/interrupted/);
 }finally{globalThis.fetch=fetchOriginal;}
});
