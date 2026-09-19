import test from "node:test";
import assert from "node:assert/strict";
import { browserLogin } from "../../desktop/browser-login.ts";
test("browser handoff rejects foreign origins and GET; accepts one bounded form POST", async () => {
  let accepted = 0,
    completed = 0;
  const flow = await browserLogin(
    async (tokens) => {
      assert.equal(tokens.access_token, "test-access");
      accepted++;
    },
    () => completed++,
  );
  const callback = new URLSearchParams(
    new URL(flow.url).hash.split("?")[1],
  ).get("callback")!;
  try {
    assert.equal((await fetch(callback)).status, 403);
    assert.equal(
      (
        await fetch(callback, {
          method: "POST",
          headers: { Origin: "https://evil.example" },
          body: new URLSearchParams({
            access_token: "test-access",
            refresh_token: "test-refresh",
          }),
        })
      ).status,
      403,
    );
    assert.equal(accepted, 0);
    const response = await fetch(callback, {
      method: "POST",
      headers: { Origin: "https://mowrai.com" },
      body: new URLSearchParams({
        access_token: "test-access",
        refresh_token: "test-refresh",
      }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /signed in/);
    assert.equal(accepted, 1);
    assert.equal(completed, 1);
    await assert.rejects(fetch(callback));
  } finally {
    flow.stop();
  }
});
test("cancelled browser handoff cannot receive a session", async () => {
  const flow = await browserLogin(
    async () => {
      throw Error("must not run");
    },
    () => {},
  );
  const callback = new URLSearchParams(
    new URL(flow.url).hash.split("?")[1],
  ).get("callback")!;
  flow.stop();
  await assert.rejects(fetch(callback));
});

test('opaque-origin handoff requires the callback nonce in its POST body',async()=>{
 for(const valid of [false,true]){
  let count=0;const flow=await browserLogin(async()=>{count++;},()=>{});
  const callback=new URLSearchParams(new URL(flow.url).hash.split('?')[1]).get('callback')!;
  try{
   assert.equal((await fetch(new URL('/.well-known/appspecific/com.chrome.devtools.json',callback))).status,404);
   const response=await fetch(callback,{method:'POST',headers:{Origin:'null'},body:new URLSearchParams({state:valid?new URL(callback).pathname.split('/').at(-1)!:'wrong',access_token:'fixture',refresh_token:'fixture'})});
   assert.equal(response.status,valid?200:400);assert.equal(count,valid?1:0);
  }finally{flow.stop();}
 }
});
