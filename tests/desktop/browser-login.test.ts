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
