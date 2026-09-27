import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GrokProvider,parseModels,parseGrokReply,parseBilling,grokModelName,grokModels} from '../desktop/grok.ts';

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
  assert.deepEqual(parseBilling({result:{config:{creditUsagePercent:120,currentPeriod:{end:'2026-10-01'}},subscription_tier:'SUPERGROK'}}),{percentUsed:100,periodEnd:'2026-10-01',plan:'SUPERGROK'});
  assert.equal(parseBilling({result:{}}),undefined);
});
test('status: signed in with models and real plan usage, or sign-in needed',async()=>{
  const ok=await new FakeGrok('ok').status();
  assert.equal(ok.connected,true);assert.deepEqual(ok.models,['grok-4.6','grok-build-0.1','grok-4.3-mini']);
  assert.deepEqual(ok.usage,{percentUsed:37.4,periodEnd:'2026-10-01T00:00:00Z',plan:'SUPERGROK'});
  const out=await new FakeGrok('signed-out').status();
  assert.equal(out.installed,true);assert.equal(out.connected,false);assert.match(out.error!,/Sign in/);
});
test('a reply comes back text-only, with long prompts passed as a file',async()=>{
  const long='Explain limits. '+'x'.repeat(50000);
  const events=await run(new FakeGrok('ok'),long);
  assert.equal(events[0].text,'[grok-4.6] '+long);assert.equal(events[1].type,'done');
});
test('failures turn into clear messages',async()=>{
  await assert.rejects(run(new FakeGrok('limit'),'Hi'),/no usage left/);
  await assert.rejects(run(new FakeGrok('signed-out'),'Hi'),/Sign in/);
  await assert.rejects(run(new FakeGrok('ok'),'Hi','grok:grok-9'),/not available on your plan/);
});
test('a reply split inside a multi-byte character arrives intact',async()=>{
  const events=await run(new FakeGrok('split'),'hi');
  assert.equal(events[0].text,'Caf\u00e9 \u2014 \u0645\u0631\u062d\u0628\u0627');
});
