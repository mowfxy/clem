import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
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
  let args: string[] = [];
  codex.start = async (a: string[]) => {
    args = a;
    const p = fake();
    p.stdin.on("finish", () => {
      p.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\n");
      setTimeout(() => p.emit("close", 0), 5);
    });
    return p;
  };
  await codex.run("id", "prompt", () => {}, [], {
    model: "model-a",
    reasoning: "high",
  });
  assert.equal(args[args.indexOf("--model") + 1], "model-a");
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.indexOf('cli_auth_credentials_store="keyring"') > args.indexOf('exec'));
  assert.ok(args.includes('forced_login_method="chatgpt"'));
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
  codex.start=async()=>{const p=fake();p.stdin.on("finish",()=>{
    p.stdout.write(JSON.stringify({type:"turn.failed",error:{message:"401 Unauthorized: private diagnostic secret-value"}})+"\n");
    setTimeout(()=>p.emit("close",1),5);
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
