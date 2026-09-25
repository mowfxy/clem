import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JavaScript worker module
import { handleProviders } from "../cloudflare/provider-vault.js";

/** A tiny stand-in for the D1 statements the vault uses. */
function fakeDb() {
  const rows = new Map<string, Record<string, string>>();
  return {
    rows,
    prepare(sql: string) {
      let args: string[] = [];
      const statement = {
        bind(...values: string[]) { args = values; return statement; },
        async all() { return { results: [...rows.values()].filter((r) => r.user_id === args[0]) }; },
        async first() { return { n: [...rows.values()].filter((r) => r.user_id === args[0] && r.id !== args[1]).length }; },
        async run() {
          if (sql.startsWith("DELETE")) rows.delete(args[0] + ":" + args[1]);
          else { const [user_id, id, kind, label, hash, iv, payload, created_at, updated_at] = args; rows.set(user_id + ":" + id, { user_id, id, kind, label, hash, iv, payload, created_at, updated_at }); }
          return {};
        },
      };
      return statement;
    },
  };
}
const env = { DB: fakeDb(), PROVIDER_VAULT_KEY: Buffer.alloc(32, 7).toString("base64") };
const call = (user: string, path: string, body?: unknown) => handleProviders(new Request("https://x" + path, body ? { method: "POST", body: JSON.stringify(body) } : {}), env, { id: user }, path).then((r: Response) => r.json());

test("provider sign-ins are encrypted at rest and returned only to their owner", async () => {
  const secret = JSON.stringify({ tokens: { refresh_token: "rt-secret-value" } });
  assert.deepEqual(await call("alice", "/providers/put", { id: "acct-1", kind: "codex", label: "a@example.com", hash: "h1", data: secret }).then((r: { ok: boolean }) => r.ok), true);
  const stored = [...env.DB.rows.values()][0];
  assert.ok(!stored.payload.includes("rt-secret-value") && !Buffer.from(stored.payload, "base64").toString().includes("rt-secret-value"));
  assert.equal((await call("alice", "/providers")).items[0].data, secret);
  assert.deepEqual((await call("bob", "/providers")).items, []);
  // A row copied to another owner no longer decrypts, because the ciphertext is bound to its owner.
  env.DB.rows.set("bob:acct-1", { ...stored, user_id: "bob" });
  assert.deepEqual((await call("bob", "/providers")).items, []);
  await call("alice", "/providers/delete", { id: "acct-1" });
  assert.deepEqual((await call("alice", "/providers")).items, []);
});

test("provider vault rejects unknown kinds and malformed credentials", async () => {
  assert.match((await call("alice", "/providers/put", { id: "x", kind: "other", data: "{}" })).error, /Unsupported/);
  assert.match((await call("alice", "/providers/put", { id: "x", kind: "claude", data: "not json" })).error, /Invalid/);
  assert.match((await call("alice", "/providers/put", { id: "../x", kind: "claude", data: "{}" })).error, /Invalid connection/);
});
