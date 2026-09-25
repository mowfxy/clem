import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AntigravityProvider,parseModelList,parseReply,modelName,antigravityModels} from '../desktop/antigravity.ts';

// Runs the fake agy (tests/fixtures/fake-agy.mjs) through node instead of a real agy.exe.
class FakeAgy extends AntigravityProvider {
  mode:string;
  constructor(mode:string){super(mkdtempSync(join(tmpdir(),'agy-')));this.mode=mode;}
  // @ts-ignore test seam over the private spawn helper
  async start(args:string[]){return spawn(process.execPath,[join(import.meta.dirname,'fixtures','fake-agy.mjs'),...args],{env:{...process.env,FAKE_AGY:this.mode},stdio:'pipe'});}
}
const run=async(p:AntigravityProvider,prompt:string,model='antigravity:gemini-3.8-flash-high')=>{const events:any[]=[];await p.run('r1',prompt,model,e=>events.push(e));return events;};

test('only Gemini models are offered, with readable names',()=>{
  assert.deepEqual(parseModelList('gemini-3.8-flash-high\n  gemini-3.1-pro   Gemini 3.1 Pro\nclaude-sonnet-4.6\n\ngpt-oss-120b\n'),['gemini-3.8-flash-high','gemini-3.1-pro']);
  assert.equal(modelName('gemini-3.8-flash-high'),'Gemini 3.8 Flash (high)');
  assert.equal(modelName('gemini-3.1-pro'),'Gemini 3.1 Pro');
  assert.deepEqual(antigravityModels(['gemini-3.1-pro']).map(m=>[m.id,m.provider]),[['antigravity:gemini-3.1-pro','Google']]);
});
test('the documented JSON envelope is read, and non-success statuses become errors',()=>{
  assert.deepEqual(parseReply('{"status":"SUCCESS","response":"Hi"}'),{text:'Hi'});
  assert.deepEqual(parseReply('noise\n{"event":"result","result":{"status":"SUCCESS","response":"Streamed"}}\n'),{text:'Streamed'});
  assert.deepEqual(parseReply('{"status":"ERROR","error":"quota"}'),{error:'quota'});
  assert.deepEqual(parseReply('not json'),{});
});
test('status reports signed-in with models, or sign-in needed',async()=>{
  assert.deepEqual(await new FakeAgy('ok').status(),{installed:true,connected:true,models:['gemini-3.8-flash-high','gemini-3.8-flash-low']});
  const out=await new FakeAgy('signed-out').status();
  assert.equal(out.installed,true);assert.equal(out.connected,false);assert.match(out.error!,/Sign in/);
});
test('a reply comes back through stdin/stream-json, never with permissions skipped',async()=>{
  const long='Explain partial derivatives. '+'x'.repeat(40000);
  const events=await run(new FakeAgy('ok'),long);
  assert.equal(events[0].type,'delta');assert.equal(events[0].text,'[gemini-3.8-flash-high] '+long);assert.equal(events[1].type,'done');
});
test('older agy without stream-json input falls back to -p for short prompts',async()=>{
  const events=await run(new FakeAgy('no-stream'),'Hello');
  assert.equal(events[0].text,'[gemini-3.8-flash-high] via -p Hello');
});
test('failures turn into clear messages',async()=>{
  await assert.rejects(run(new FakeAgy('quota'),'Hi'),/no Antigravity usage left/);
  await assert.rejects(run(new FakeAgy('signed-out'),'Hi'),/Sign in/);
  await assert.rejects(run(new FakeAgy('ok'),'Hi','antigravity:gemini-9-ultra'),/not available on your plan/);
});
