import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GrokProvider,parseModels,parseGrokReply,parseGrokEfforts,parseBilling,grokModelName,grokModels} from '../desktop/grok.ts';

// Runs the fake grok (tests/fixtures/fake-grok.mjs) through node instead of a real grok.exe.
class FakeGrok extends GrokProvider {
  mode:string;
  constructor(mode:string){super(mkdtempSync(join(tmpdir(),'grok-')));this.mode=mode;}
  async start(args:string[]){return spawn(process.execPath,[join(import.meta.dirname,'fixtures','fake-grok.mjs'),...args],{env:{...process.env,XAI_API_KEY:'',FAKE_GROK:this.mode},stdio:'pipe'}) as any;}
}
const run=async(p:GrokProvider,prompt:string,model='grok:grok-4.6')=>{const events:any[]=[];await p.run('r1',prompt,model,e=>events.push(e));return events;};

test('the model list and sign-in state come from `grok models`',()=>{
  const out=parseModels('You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-build-0.1\n');
  assert.deepEqual(out,{loggedIn:true,models:['grok-4.6','grok-build-0.1'],defaultModel:'grok-4.6'});
  assert.equal(parseModels('You are not authenticated.\n').loggedIn,false);
  assert.equal(grokModelName('grok-build-0.1'),'Grok Build 0.1');
  assert.deepEqual(grokModels({models:['grok-build-0.1','grok-4.6'],defaultModel:'grok-4.6'}).map(m=>[m.id,m.provider]),[['grok:grok-4.6','xAI'],['grok:grok-build-0.1','xAI']]);
});
test('replies and plan usage are read from Grok’s own formats',()=>{
  assert.deepEqual(parseGrokReply('{\n  "text": "Hi",\n  "stopReason": "end_turn"\n}\n'),{text:'Hi'});
  assert.deepEqual(parseGrokReply('{"type":"error","message":"boom"}\n'),{error:'boom'});
  // The stream's result is the last message: notes the agent wrote before using its own tools are not part of it.
  assert.deepEqual(parseGrokReply('{"type":"assistant","message":{"content":[{"type":"text","text":"I will look."}]}}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}\n{"type":"result","subtype":"success","is_error":false,"result":"Done."}\n'),{text:'Done.'});
  assert.deepEqual(parseGrokReply('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Rate limit"}\n'),{error:'Rate limit'});
  assert.deepEqual(parseGrokEfforts({_meta:{modelState:{availableModels:[{modelId:'grok-4.7',_meta:{supportsReasoningEffort:true,reasoningEffort:'high',reasoningEfforts:[{value:'xhigh'},{value:'high',default:true},{value:'low'}]}}]}}}),{'grok-4.7':{levels:['low','high','xhigh'],default:'high'}});
  assert.deepEqual(parseBilling({result:{config:{creditUsagePercent:120,currentPeriod:{end:'2026-10-01'}},subscription_tier:'SUPERGROK'}}),{percentUsed:100,periodEnd:'2026-10-01',plan:'SUPERGROK'});
  assert.equal(parseBilling({result:{}}),undefined);
});
test('status: signed in with models and real plan usage, or sign-in needed',async()=>{
  const ok=await new FakeGrok('ok').status();
  assert.equal(ok.connected,true);assert.deepEqual(ok.models,['grok-4.6','grok-build-0.1','grok-4.3-mini']);
  assert.deepEqual(ok.usage,{percentUsed:37.4,periodEnd:'2026-10-01T00:00:00Z',plan:'SUPERGROK'});
  // Thinking levels come from Grok's own model list, lowest first, so the composer offers them as it does ChatGPT's.
  const listed=grokModels(ok);
  assert.deepEqual(listed.find(m=>m.id==='grok:grok-4.6')!.reasoningEfforts.map(e=>e.reasoningEffort),['low','medium','high','xhigh']);
  assert.equal(listed.find(m=>m.id==='grok:grok-4.6')!.defaultReasoningEffort,'high');
  assert.deepEqual(listed.find(m=>m.id==='grok:grok-build-0.1')!.reasoningEfforts,[]);
  const out=await new FakeGrok('signed-out').status();
  assert.equal(out.installed,true);assert.equal(out.connected,false);assert.match(out.error!,/Sign in/);
});
test('a reply comes back text-only, with long prompts passed as a file',async()=>{
  const long='Explain limits. '+'x'.repeat(50000);
  const events=await run(new FakeGrok('ok'),long);
  assert.equal(events.find(e=>e.type==='delta').text,'[grok-4.6] '+long);assert.equal(events.at(-1).type,'done');
});
test('failures turn into clear messages',async()=>{
  await assert.rejects(run(new FakeGrok('limit'),'Hi'),/no usage left/);
  await assert.rejects(run(new FakeGrok('signed-out'),'Hi'),/Sign in/);
  await assert.rejects(run(new FakeGrok('ok'),'Hi','grok:grok-9'),/not available on your plan/);
});
test('a reply split inside a multi-byte character arrives intact',async()=>{
  const events=await run(new FakeGrok('split'),'hi');
  assert.equal(events.find(e=>e.type==='delta').text,'Caf\u00e9 \u2014 \u0645\u0631\u062d\u0628\u0627');
});
test('a tool loop continues one Grok session; a session Grok no longer has is reported so the loop can resend',async()=>{
  const {SessionLost}=await import('../desktop/kinetra-turn.ts');
  const id='0b8f6a54-3d0e-4a39-9a0d-6d3a4b1d9c11';
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('ok');
  await grok.run('r',"one",'grok:grok-4.6',()=>{},[],{id,resume:false});
  await grok.run('r',"two",'grok:grok-4.6',()=>{},[],{id,resume:true});
  const turns=grok.args.filter(a=>a.includes('--prompt-file'));
  assert.deepEqual(turns[0].slice(turns[0].indexOf('--session-id'),turns[0].indexOf('--session-id')+2),['--session-id',id]);
  assert.deepEqual(turns[1].slice(turns[1].indexOf('--resume'),turns[1].indexOf('--resume')+2),['--resume',id]);
  await assert.rejects(new FakeGrok('lost').run('r','x','grok:grok-4.6',()=>{},[],{id,resume:true}),SessionLost);
  await new FakeGrok('lost').run('r','x','grok:grok-4.6',()=>{},[],{id,resume:false}).catch(()=>{}); // a first step never resumes
});

test('a Grok CLI without sessions is told apart from a failure, and later steps run without session flags',async()=>{
  const {SessionLost}=await import('../desktop/kinetra-turn.ts');
  const id='0b8f6a54-3d0e-4a39-9a0d-6d3a4b1d9c11';
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('old');
  await assert.rejects(grok.run('r','first','grok:grok-4.6',()=>{},[],{id,resume:false}),SessionLost);
  const events:any[]=[];
  await grok.run('r','again','grok:grok-4.6',e=>events.push(e),[],{id,resume:false});
  assert.match(events.find(e=>e.type==='delta').text,/again/);
  const last=grok.args.filter(a=>a.includes('--prompt-file')).at(-1)!;
  assert.ok(!last.includes('--session-id')&&!last.includes('--resume'));
});

test('only Grok’s final message is the reply, and the chosen thinking level is passed on',async()=>{
  const events:any[]=[];
  await new FakeGrok('steps').run('r','hi','grok:grok-4.6',e=>events.push(e));
  assert.equal(events.find(e=>e.type==='delta').text,'{"kinetra":{"action":"help"}}');
  assert.ok(events.some(e=>e.type==='status'&&e.text==='Reading a file…'));
  const chosen:any[]=[];
  await new FakeGrok('ok').run('r','hi','grok:grok-4.6',e=>chosen.push(e),[],undefined,'xhigh');
  assert.equal(chosen.find(e=>e.type==='delta').text,'[grok-4.6 xhigh] hi');
  const unlisted:any[]=[];
  await new FakeGrok('ok').run('r','hi','grok:grok-build-0.1',e=>unlisted.push(e),[],undefined,'xhigh');
  assert.equal(unlisted.find(e=>e.type==='delta').text,'[grok-build-0.1] hi');
});

test('Grok’s reply streams as partial events while it is written; the reply itself is still the final message',async()=>{
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('stream');const events:any[]=[];
  await grok.run('r','what is this?','grok:grok-4.6',e=>events.push(e));
  assert.ok(grok.args.find(a=>a.includes('--prompt-file'))!.includes('--include-partial-messages'));
  const partial=events.filter(e=>e.type==='partial');
  assert.deepEqual(partial.map(e=>[e.text,e.fresh]),[["I'll look ",true],['at it.',false],['The picture ',true],['shows a ',false],['pulley.',false]]);
  assert.deepEqual(events.filter(e=>e.type==='delta').map(e=>e.text),['The picture shows a pulley.']);
  assert.ok(events.findIndex(e=>e.type==='partial')<events.findIndex(e=>e.type==='delta'));
});

test('a Grok build without partial messages answers in one piece, and is not asked for them again',async()=>{
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('nopartial');
  const first:any[]=[];await grok.run('r','hi','grok:grok-4.6',e=>first.push(e));
  assert.equal(first.find(e=>e.type==='delta').text,'[grok-4.6] hi');
  const runs=grok.args.filter(a=>a.includes('--prompt-file'));
  assert.deepEqual(runs.map(a=>a.includes('--include-partial-messages')),[true,false]);
  await grok.run('r','again','grok:grok-4.6',()=>{});
  assert.equal(grok.args.filter(a=>a.includes('--prompt-file')).at(-1)!.includes('--include-partial-messages'),false);
});

test('the steps of a tool loop reuse the sign-in check; usage is read again the next time the window asks',async()=>{
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('ok');
  for(let step=0;step<3;step++)await grok.run('r','step','grok:grok-4.6',()=>{});
  const count=(name:string)=>grok.args.filter(a=>a[0]===name).length;
  assert.equal(count('models'),1);
  assert.equal(count('agent'),1);
  await grok.status();
  assert.equal(count('models'),2,'an answer changed the plan usage');
  await grok.status();
  assert.equal(count('models'),2);
});

test('an older sign-in check does not hold up an answer: the answer starts at once and the check is renewed after it',async()=>{
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('ok');
  await grok.status();
  const started=(from:number)=>grok.args.slice(from).map(a=>a.includes('--prompt-file')?'answer':a[0]);
  // The last check is from an hour ago.
  (grok as any).statusCache.at-=60*60_000;
  const before=grok.args.length;
  const events:any[]=[];
  await grok.run('r','hi','grok:grok-4.6',e=>events.push(e));
  assert.equal(events.find(e=>e.type==='delta').text,'[grok-4.6] hi');
  await (grok as any).statusRequest;
  assert.deepEqual(started(before)[0],'answer');
  assert.deepEqual(started(before).slice(1).sort(),['agent','models']);
  // A check a day old is not trusted: the answer waits for a fresh one.
  (grok as any).statusCache.at-=25*60*60_000;
  const later=grok.args.length;
  await grok.run('r','hi','grok:grok-4.6',()=>{});
  assert.deepEqual(started(later).at(-1),'answer');
  assert.deepEqual(started(later).slice(0,-1).sort(),['agent','models']);
});

test('the model list and the agent handshake are read side by side, and callers share one check',async()=>{
  class Spy extends FakeGrok{args:string[][]=[];async start(args:string[]){this.args.push(args);return super.start(args);}}
  const grok=new Spy('ok');
  const [a,b]=await Promise.all([grok.status(true),grok.status(true)]);
  assert.equal(a,b);
  assert.deepEqual(grok.args.map(x=>x[0]).sort(),['agent','models']);
  assert.equal(grok.args[0][0],'agent','the handshake starts without waiting for the model list');
  assert.equal(a.connected,true);assert.equal(a.usage?.plan,'SUPERGROK');
});
