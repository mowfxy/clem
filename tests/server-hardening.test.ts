import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
// Retired legacy uploads stay retired here (cloud.test.ts turns them on to test the legacy readers).
delete process.env.MOWR_LEGACY_WORKSPACE;
delete process.env.VERCEL;
const pg = new PGlite();
for (const file of ["001_core.sql", "002_accounts.sql", "003_github.sql"]) await pg.exec(await fs.readFile("database/" + file, "utf8"));
process.env.DATABASE_URL = "postgresql://test:test@local.neon.tech/test";
process.env.SESSION_SECRET = "test-session-secret-32-characters-minimum";
process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-secret-at-least-thirty-two-characters";
neonConfig.fetchFunction = async (_url: any, init: any) => {
  try {
    const body = JSON.parse(init.body);
    // A little network latency, so concurrent requests interleave the way they do against a real database.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r = await pg.query(body.query, body.params);
    return Response.json({
      fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: (r.rows as any[]).map((row) => r.fields.map((f) => (row[f.name] === null ? null : typeof row[f.name] === "object" ? JSON.stringify(row[f.name]) : String(row[f.name])))),
      rowCount: r.affectedRows || r.rows.length,
    });
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 400 });
  }
};
const { default: app, exposable } = await import("../server/app.ts");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const port = (server.address() as any).port;
const request = (path: string, method = "GET", body?: unknown, cookie = "") =>
  fetch(`http://127.0.0.1:${port}/api/${path}`, { method, headers: { Origin: "http://127.0.0.1:5173", "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
after(async () => {
  server.close();
  await pg.close();
});

test("retired workspace, scope and file uploads stay closed whatever the path's case", async () => {
  for (const [path, method] of [["workspace", "PUT"], ["Workspace", "PUT"], ["WORKSPACE", "PUT"], ["scopes", "POST"], ["Scopes", "POST"], ["Files/reserve", "POST"], ["fIlEs/x/complete", "POST"]])
    assert.equal((await request(path, method, { ownerId: "x", state: {}, revision: 0 })).status, 410, `${method} ${path}`);
  // Saving edits to a cloud document is not an upload and stays open (it reaches its own route, not the 410).
  assert.notEqual((await request("files/123e4567-e89b-12d3-a456-426614174000/edits", "PUT", { revision: 0, content: {} })).status, 410);
});

test("parallel requests cannot create more than five automations", async () => {
  const signup = await request("auth/signup", "POST", { name: "Ava", email: "ava@example.test", password: "Long-example-password1" });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0];
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => request("automations", "POST", { name: "Routine " + i, prompt: "Summarise the news", model: "anthropic", schedule: "daily" }, cookie)),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  const refused = results.find((r) => r.status !== 200)!;
  assert.match((await refused.json()).error, /at most five/);
  assert.equal((await (await request("automations", "GET", undefined, cookie)).json()).length, 5);
});

test("only messages Mowr wrote reach people; library and runtime errors stay generic", () => {
  assert.equal(exposable(new Error("Connect Google Drive first.")), true);
  assert.equal(exposable(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(exposable(Object.assign(new Error("Invalid login: 535 5.7.8 smtp.example rejected"), { code: "EAUTH" })), false);
  class StorageError extends Error {}
  assert.equal(exposable(new StorageError("bucket mowr-files row-level security")), false);
  assert.equal(exposable("text"), false);
});

test("credentials saved under SESSION_SECRET still open after CREDENTIAL_ENCRYPTION_KEY is added", async () => {
  const { encrypt, decrypt } = await import("../server/vault.ts");
  const saved = { ...process.env };
  try {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const old = encrypt("old-refresh-token", "alice");
    process.env.CREDENTIAL_ENCRYPTION_KEY = "a-new-dedicated-credential-key-of-32-plus-chars";
    assert.equal(decrypt(old.ciphertext, old.nonce, "alice"), "old-refresh-token");
    assert.throws(() => decrypt(old.ciphertext, old.nonce, "bob"));
    // New credentials use the dedicated key: they survive SESSION_SECRET being rotated away.
    const fresh = encrypt("new-refresh-token", "alice");
    process.env.SESSION_SECRET = "a-completely-different-session-secret-value";
    assert.equal(decrypt(fresh.ciphertext, fresh.nonce, "alice"), "new-refresh-token");
    assert.throws(() => decrypt(old.ciphertext, old.nonce, "alice"));
    process.env.CREDENTIAL_ENCRYPTION_KEY = "short";
    assert.throws(() => encrypt("x", "alice"), /strong/);
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEY = saved.CREDENTIAL_ENCRYPTION_KEY;
    process.env.SESSION_SECRET = saved.SESSION_SECRET;
  }
});

test("a deployment uses the server's own provider keys only when it opts in", async () => {
  const { serverKeysAllowed, requestSpec, modelCatalog } = await import("../server/providers.ts");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-test-server-key", ANTHROPIC_MODEL: "claude-test" });
    assert.equal(serverKeysAllowed(), true); // local development
    assert.equal(requestSpec("anthropic", [{ role: "user", content: "hi" }]).headers["x-api-key"], "sk-test-server-key");
    process.env.VERCEL = "1";
    assert.equal(serverKeysAllowed(), false);
    assert.throws(() => requestSpec("anthropic", [{ role: "user", content: "hi" }]), /connect your own model/);
    assert.equal(modelCatalog().find((m) => m.id === "anthropic")!.connected, false);
    // A person's own key still works on the deployment.
    assert.equal(requestSpec("anthropic", [{ role: "user", content: "hi" }], { key: "sk-own", model: "claude-own" }).headers["x-api-key"], "sk-own");
    process.env.MOWR_SERVER_KEYS = "true";
    assert.equal(serverKeysAllowed(), true);
  } finally {
    for (const name of ["VERCEL", "MOWR_SERVER_KEYS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});
