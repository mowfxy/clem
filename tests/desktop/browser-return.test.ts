import test from "node:test";
import assert from "node:assert/strict";
import {
  rememberDesktopReturn,
  returnToDesktop,
  hasDesktopReturn,
} from "../../src/desktop-signin.ts";
test("browser stores only expiring callback metadata and submits tokens in POST fields", () => {
  const store = new Map<string, string>();
  const callback = "http://127.0.0.1:12345/signin/" + "a".repeat(64);
  const inputs: any[] = [];
  let submitted = false;
  const form: any = {
    append: (input: any) => inputs.push(input),
    submit: () => {
      submitted = true;
    },
  };
  Object.assign(globalThis, {
    location: {
      hash: "#/desktop-signin?callback=" + encodeURIComponent(callback),
    },
    sessionStorage: {
      setItem: (k: string, v: string) => store.set(k, v),
      getItem: (k: string) => store.get(k),
      removeItem: (k: string) => store.delete(k),
    },
    document: {
      createElement: (tag: string) => (tag === "form" ? form : {}),
      body: { append: () => {} },
    },
  });
  rememberDesktopReturn();
  assert.ok(hasDesktopReturn());
  assert.ok(
    returnToDesktop({
      access_token: "test-access",
      refresh_token: "test-refresh",
    } as any),
  );
  assert.equal(form.method, "POST");
  assert.equal(form.action, callback);
  assert.ok(submitted);
  assert.deepEqual(
    inputs.map((i) => i.value),
    ["test-access", "test-refresh"],
  );
  assert.equal(store.size, 0);
  assert.equal(hasDesktopReturn(), false);
  (globalThis as any).location.hash =
    "#/desktop-signin?callback=" + encodeURIComponent("https://evil.example/");
  assert.throws(rememberDesktopReturn);
});
