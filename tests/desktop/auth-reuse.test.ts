import { test } from "node:test";
import assert from "node:assert/strict";
import { DesktopAuth } from "../../desktop/auth.ts";

/** A sign-in whose server check can be counted and made to reject. */
function signedIn() {
  const calls = { getUser: 0 };
  let reject = false;
  const auth = new DesktopAuth({} as any, { url: "", key: "", service: "" });
  auth.client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t1", user: { id: "u1" } } }, error: null }),
      getUser: async () => { calls.getUser++; return reject ? { data: { user: null }, error: { message: "invalid JWT", status: 401 } } : { data: { user: { id: "u1" } }, error: null }; },
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
    },
  } as any;
  return { auth, calls, age: (ms: number) => { (auth as any).verified.at = Date.now() - ms; }, rejectNext: () => { reject = true; } };
}

test("a chat message reuses a sign-in checked minutes ago and has it checked again beside the answer", async () => {
  const { auth, calls, age, rejectNext } = signedIn();
  assert.equal((await auth.user(true, false, 10 * 60_000))?.id, "u1");
  assert.equal(calls.getUser, 1);
  // Within a minute nothing is asked again.
  await auth.user(true, false, 10 * 60_000);
  assert.equal(calls.getUser, 1);
  // Five minutes later the message goes at once; the server is asked beside it.
  age(5 * 60_000);
  rejectNext();
  assert.equal((await auth.user(true, false, 10 * 60_000))?.id, "u1");
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(calls.getUser, 2);
  // The server rejected the sign-in: the next request is checked again and fails.
  assert.equal(await auth.user(true, false, 10 * 60_000), null);
  assert.equal(calls.getUser, 3);
});

test("other requests still check a sign-in older than a minute before they run", async () => {
  const { auth, calls, age } = signedIn();
  await auth.user();
  age(5 * 60_000);
  await auth.user();
  assert.equal(calls.getUser, 2);
  // A security action always asks the server.
  await auth.user(true, true, 10 * 60_000);
  assert.equal(calls.getUser, 3);
});
