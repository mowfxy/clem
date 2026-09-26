import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { reasoningHeadline, streamCodex } from "../../desktop/codex-stream.ts";
import { Codex, codexFailureMessage } from "../../desktop/codex.ts";
function fake() {
  const p: any = new EventEmitter();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.stdin = new PassThrough();
  p.kill = () => {
    p.emit("close", 0);
    return true;
  };
  return p;
}
test("Codex catalog initializes, paginates, filters hidden models and caches", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.status = async () => true;
  let starts = 0;
  codex.start = async () => {
    starts++;
    const p = fake();
    p.stdin.on("data", (data: Buffer) => {
      const req = JSON.parse(data.toString());
      if (!req.id) return;
      const result =
        req.method === "initialize"
          ? {}
          : {
              data: [
                {
                  model: req.params.cursor ? "model-b" : "model-a",
                  displayName: "Available",
                  supportedReasoningEfforts: [
                    { reasoningEffort: "medium", description: "Balanced" },
                  ],
                  defaultReasoningEffort: "medium",
                },
                { model: "hidden", hidden: true },
              ],
              nextCursor: req.params.cursor ? null : "next",
            };
      queueMicrotask(() =>
        p.stdout.write(JSON.stringify({ id: req.id, result }) + "\n"),
      );
    });
    return p;
  };
  const models = await codex.models();
  assert.deepEqual(
    models.map((m: any) => m.id),
    ["model-a", "model-b"],
  );
  assert.equal(models[0].reasoningEfforts[0].reasoningEffort, "medium");
  await codex.models();
  assert.equal(starts, 1);
});
test("Codex execution passes selected model and effort and rejects unsupported effort", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.status = async () => true;
  codex.models = async () => [
    { id: "model-a", reasoningEfforts: [{ reasoningEffort: "high" }] },
  ];
  let args: string[] = [], turn:any, thread:any;
  codex.start = async (a: string[]) => {
    args = a;const p=fake();
    p.stdin.on("data",(data:Buffer)=>{const req=JSON.parse(data.toString());
      if(req.method==="initialize")queueMicrotask(()=>p.stdout.write(JSON.stringify({id:1,result:{}})+"\n"));
      if(req.method==="thread/start"){thread=req.params;queueMicrotask(()=>p.stdout.write(JSON.stringify({id:2,result:{thread:{id:"t"}}})+"\n"));}
      if(req.method==="turn/start"){turn=req.params;queueMicrotask(()=>p.stdout.write(JSON.stringify({method:"turn/completed",params:{threadId:"t",turn:{status:"completed"}}})+"\n"));}
    });return p;
  };
  await codex.run("id", "prompt", () => {}, [], {model:"model-a",reasoning:"high"});
  assert.equal(turn.model,"model-a");assert.equal(turn.effort,"high");
  assert.equal(thread.ephemeral,true);assert.equal(thread.sandbox,"read-only");
  assert.equal(thread.config["features.shell_tool"],false);
  assert.ok(args.includes('cli_auth_credentials_store="file"'));
  await assert.rejects(
    () =>
      codex.run("id", "prompt", () => {}, [], {
        model: "model-a",
        reasoning: "ultra",
      }),
    /unavailable/,
  );
});

test('Codex account usage reads real RPC buckets, caches, and keeps missing usage distinct from zero',async()=>{
 const codex:any=new Codex('fixture','fixture','fixture');let starts=0,unavailable=false;
 codex.start=async()=>{starts++;const p=fake();p.stdin.on('data',(data:Buffer)=>{const req=JSON.parse(data.toString());if(!req.id)return;const result=req.method==='initialize'?{}:req.method==='account/read'?{account:{type:'chatgpt',email:'fixture@example.com',planType:'plus'}}:{rateLimits:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:1900000000}},rateLimitsByLimitId:{codex:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:1900000000}}}};queueMicrotask(()=>p.stdout.write(JSON.stringify(req.method==='account/rateLimits/read'&&unavailable?{id:req.id,error:{message:'unavailable'}}:{id:req.id,result})+'\n'));});return p;};
 const account=await codex.account();assert.equal(account.email,'fixture@example.com');assert.equal(account.usage.rateLimitsByLimitId.codex.primary.usedPercent,42);await codex.account();assert.equal(starts,1);unavailable=true;const missing=await codex.account(true);assert.equal(missing.connected,true);assert.equal(missing.usage,null);assert.match(missing.usageError,/unavailable/);
});

test("device login remains resumable and exposes completion failures", async () => {
 const codex:any=new Codex('fixture','fixture','fixture');const p=fake();
 codex.start=async()=>{setTimeout(()=>p.stdout.write('https://auth.openai.com/codex/device ABCD-EFGH'),0);return p;};
 const challenge=await codex.login();assert.equal(codex.loginState().pending,true);
 assert.deepEqual(await codex.login(),challenge);
 p.stderr.write('Failed to save to keyring');p.emit('close',1);
 assert.equal(codex.loginState().pending,false);
 assert.match(codex.loginState().loginError,/Windows could not save/);
});
test("successful device login invalidates disconnected account cache", async () => {
 const codex:any=new Codex('fixture','fixture','fixture');const p=fake();
 codex.start=async()=>{setTimeout(()=>p.stdout.write('https://auth.openai.com/codex/device ABCD-EFGH'),0);return p;};
 await codex.login();codex.accountCache={at:Date.now(),value:{connected:false}};
 p.emit('close',0);assert.equal(codex.accountCache,null);assert.equal(codex.loginState().loginError,null);
});

test("a slow usage service does not discard a confirmed sign-in", async (t) => {
 t.mock.timers.enable({apis:['setTimeout']});
 const codex:any=new Codex('fixture','fixture','fixture');
 codex.start=async()=>{const p=fake();p.stdin.on('data',(data:Buffer)=>{
   const req=JSON.parse(data.toString());
   if(req.method==='initialize')queueMicrotask(()=>p.stdout.write(JSON.stringify({id:req.id,result:{}})+'\n'));
   if(req.method==='account/read')queueMicrotask(()=>p.stdout.write(JSON.stringify({id:req.id,result:{account:{type:'chatgpt',email:'fixture@example.com',planType:'plus'}}})+'\n'));
 });return p;};
 const pending=codex.account();
 for(let i=0;i<10;i++)await Promise.resolve();
 t.mock.timers.tick(20001);
 const account=await pending;
 assert.equal(account.connected,true);
 assert.equal(account.usage,null);
 assert.match(account.usageError,/timed out/);
});

test("Codex retains a terminal provider failure and exposes only curated text", async () => {
  const codex:any=new Codex("fixture","fixture","fixture");
  codex.status=async()=>true;
  codex.start=async()=>{const p=fake();p.stdin.on("data",()=>{
    queueMicrotask(()=>p.stdout.write(JSON.stringify({id:1,error:{message:"401 Unauthorized: private diagnostic secret-value"}})+"\n"));
  });return p;};
  await assert.rejects(codex.run("failed","prompt",()=>{}),error=>{
    assert.match(codexFailureMessage(error),/Retry sign-in/);
    assert.ok(!codexFailureMessage(error).includes("secret-value"));return true;
  });
  assert.equal(codex.busy,false);
  assert.match(codexFailureMessage(Error("429 rate limit")),/usage limit/);
  assert.match(codexFailureMessage(Error("Codex request timed out")),/too long/);
  assert.equal(codexFailureMessage(Error("Request cancelled")),"Request stopped.");
});

test("Codex streams prose before completion without exposing tool envelopes",async()=>{
 const codex:any=new Codex("fixture","fixture","fixture");
 const events:any[]=[];let completed=false;
 codex.runOnce=async(_id:any,_input:any,emit:any)=>{
   emit({type:"delta",text:"Hello"});
   assert.equal(events[0].text,"Hello");assert.equal(completed,false);
   emit({type:"delta",text:" there"});completed=true;
 };
 await codex.run("stream","hello",(e:any)=>events.push(e));
 assert.equal(events.filter(e=>e.type==="delta").map(e=>e.text).join(""),"Hello there");
 assert.equal(events.at(-1).type,"done");
 let calls=0;events.length=0;
 codex.runOnce=async(_id:any,_input:any,emit:any)=>{
   if(calls++===0){emit({type:"delta",text:'{'});emit({type:"delta",text:'"kinetra":{"action":"bad"}}'});assert.equal(events.length,0);}
   else emit({type:"delta",text:"Cannot run that tool."});
 };
 await codex.run("tools","test",(e:any)=>events.push(e));
 assert.equal(events.filter(e=>e.type==="delta").map(e=>e.text).join(""),"Cannot run that tool.");
});

test("app-server deltas arrive before completion and final items are not duplicated",async()=>{
 const p=fake(),chunks:string[]=[];let turnStarted=false;
 p.stdin.on("data",(data:Buffer)=>{const req=JSON.parse(data.toString());
  if(req.id===1)queueMicrotask(()=>p.stdout.write(JSON.stringify({id:1,result:{}})+"\n"));
  if(req.id===2)queueMicrotask(()=>p.stdout.write(JSON.stringify({id:2,result:{thread:{id:"stream-thread"}}})+"\n"));
  if(req.id===3){turnStarted=true;queueMicrotask(()=>{
   p.stdout.write(JSON.stringify({method:"item/agentMessage/delta",params:{threadId:"stream-thread",itemId:"a",delta:"Hello"}})+"\n");
   assert.deepEqual(chunks,["Hello"]);
   p.stdout.write(JSON.stringify({method:"item/completed",params:{threadId:"stream-thread",item:{id:"a",type:"agentMessage",text:"Hello there"}}})+"\n");
   p.stdout.write(JSON.stringify({method:"turn/completed",params:{threadId:"stream-thread",turn:{status:"completed"}}})+"\n");
  });}
 });
 await streamCodex(p,"hello",{model:"a",reasoning:"low"},[],text=>chunks.push(text),()=>false);
 assert.equal(turnStarted,true);assert.equal(chunks.join(""),"Hello there");
});

test("reasoning summaries become a few words on what the model is doing", () => {
  assert.equal(reasoningHeadline("**Checking the formula**\n\nI need to"), "Checking the formula…");
  assert.equal(reasoningHeadline("**Comparing the two sources and deciding which one fits best.**"), "Comparing the two sources and deciding…");
  assert.equal(reasoningHeadline("**Still typing"), null);
  assert.equal(reasoningHeadline("No headline here"), null);
});

test("Claude's stream-json events become the same short progress labels as ChatGPT's", async () => {
  const { claudeStatus } = await import("../../desktop/claude.ts");
  assert.equal(claudeStatus({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } }), "Thinking it through…");
  assert.equal(claudeStatus({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } }), "Writing the answer…");
  assert.equal(claudeStatus({ type: "assistant", message: { content: [{ type: "server_tool_use", name: "web_search", input: { query: "krebs cycle video" } }] } }), "Searching the web for “krebs cycle video”…");
  assert.equal(claudeStatus({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } }), null);
});
