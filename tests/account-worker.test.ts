import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error plain JavaScript worker module
import { verifiedUser, emailProofAccepted } from "../cloudflare/account-worker.js";
// @ts-expect-error plain JavaScript worker module
import { handleAdmin } from "../cloudflare/admin.js";

/** D1's statement API over an in-memory SQLite database, enough for the account Worker's queries. */
function d1(...schemas: string[]) {
  const db = new DatabaseSync(":memory:");
  for (const file of schemas) db.exec(fs.readFileSync(file, "utf8"));
  return {
    db,
    prepare(sql: string) {
      let args: any[] = [];
      const statement = {
        bind(...values: any[]) { args = values; return statement; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
      };
      return statement;
    },
  };
}
const token = (claims: Record<string, unknown>) => "Bearer h." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".s";

test("a confirmed sign-in is reused briefly instead of asking Supabase on every call", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ id: "u1", email: "a@example.test" }); }) as typeof fetch;
  try {
    const env = { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "k" };
    const now = Date.now(), auth = token({ exp: Math.floor(now / 1000) + 3600 });
    assert.equal((await verifiedUser(env, auth, now)).id, "u1");
    assert.equal((await verifiedUser(env, auth, now + 30_000)).id, "u1");
    assert.equal(calls, 1);
    await verifiedUser(env, auth, now + 61_000); // past the minute: checked again
    assert.equal(calls, 2);
    // A token about to expire is never cached past its expiry.
    const short = token({ exp: Math.floor(now / 1000) + 5 });
    await verifiedUser(env, short, now);
    await verifiedUser(env, short, now + 6000);
    assert.equal(calls, 4);
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    assert.equal(await verifiedUser(env, token({ exp: 1 }), now), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("email two-step proof: off by default, and when on only the server's signed proof is accepted", async () => {
  const DB = { prepare: () => ({ bind: () => ({ first: async () => ({ email_mfa: 1 }) }) }) };
  const user = { id: "u1" }, auth = token({ session_id: "sess-1" }), now = Date.now();
  const expires = String(Math.floor(now / 1000) + 600);
  // The proof server/file-security.ts makes after a confirmed code.
  const proof = createHmac("sha256", "gate-secret").update(["u1", "sess-1", "session", expires].join("|")).digest("hex");
  const request = (value?: string) => new Request("https://accounts.test/sync/notes", { headers: value ? { "X-Mowr-Email-Proof": value } : {} });
  assert.equal(await emailProofAccepted(request(), { DB }, user, auth, now), true);
  const env = { DB, REQUIRE_EMAIL_PROOF: "true", FILE_GATE_SECRET: "gate-secret" };
  assert.equal(await emailProofAccepted(request(), env, user, auth, now), false);
  assert.equal(await emailProofAccepted(request(expires + "." + proof), env, user, auth, now), true);
  assert.equal(await emailProofAccepted(request(expires + "." + proof), env, user, token({ session_id: "other" }), now), false);
  assert.equal(await emailProofAccepted(request(expires + "." + proof), env, { id: "u2" }, auth, now), false);
  assert.equal(await emailProofAccepted(request(expires + "." + proof), env, user, auth, (Number(expires) + 1) * 1000), false);
  assert.equal(await emailProofAccepted(request(expires + "." + "0".repeat(64)), env, user, auth, now), false);
  const off = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
  assert.equal(await emailProofAccepted(request(), { ...env, DB: off }, user, auth, now), true);
});

test("the staff people list filters by plan in SQL, with exact totals", async () => {
  const env = { DB: d1("cloudflare/account-schema.sql", "cloudflare/admin-schema.sql") };
  const future = new Date(Date.now() + 30 * 86400000).toISOString(), past = new Date(Date.now() - 86400000).toISOString(), at = new Date().toISOString();
  const run = (sql: string, ...values: any[]) => env.DB.db.prepare(sql).run(...values);
  for (const id of ["owner1", "comp1", "sub1", "cancel1", "due1", "lapsed1", "free1", "revoked1"])
    run("INSERT INTO desktop_activity(user_id,email,first_seen_at,last_seen_at) VALUES(?,?,?,?)", id, id + "@example.test", at, at);
  run("INSERT INTO desktop_owner_grants(user_id,granted_at) VALUES('owner1',?)", at);
  run("INSERT INTO desktop_comp_grants(id,user_id,valid_until,created_by,created_at) VALUES('g1','comp1',?,'x',?)", future, at);
  run("INSERT INTO desktop_comp_grants(id,user_id,valid_until,created_by,created_at,revoked_at) VALUES('g2','revoked1',NULL,'x',?,?)", at, at);
  const sub = (id: string, user: string, status: string, until: string) => run("INSERT INTO desktop_subscriptions(subscription_id,user_id,status,valid_until,updated_at) VALUES(?,?,?,?,?)", id, user, status, until, at);
  sub("1", "sub1", "active", future);
  sub("2", "cancel1", "cancelled", future);
  sub("3", "due1", "past_due", future);
  sub("4", "lapsed1", "active", past);
  const staff = { id: "staff", email: "m@mohamedmowafy.com", email_confirmed_at: at };
  const list = async (plan: string) => {
    const path = "/admin/users";
    const response = await handleAdmin(new Request("https://accounts.test" + path + "?plan=" + plan), env, staff, path, token({}));
    return response.json();
  };
  const expected: Record<string, string[]> = { owner: ["owner1"], complimentary: ["comp1"], subscribed: ["sub1"], cancelling: ["cancel1"], past_due: ["due1"], lapsed: ["lapsed1"], free: ["free1", "revoked1"] };
  for (const [plan, ids] of Object.entries(expected)) {
    const found = await list(plan);
    assert.deepEqual(found.users.map((u: { id: string }) => u.id).sort(), ids, plan);
    assert.equal(found.total, ids.length, plan);
    for (const u of found.users) assert.equal(u.plan, plan);
  }
  assert.equal((await list("all")).total, 8);
  assert.equal((await list("nonsense")).total, 0);
});

test("adding staff refuses an email that two accounts have used", async () => {
  const env = { DB: d1("cloudflare/account-schema.sql", "cloudflare/admin-schema.sql") };
  const at = new Date().toISOString();
  for (const id of ["old-account", "new-account"])
    env.DB.db.prepare("INSERT INTO desktop_activity(user_id,email,first_seen_at,last_seen_at) VALUES(?,?,?,?)").run(id, "sam@example.test", at, at);
  const staff = { id: "staff", email: "m@mohamedmowafy.com", email_confirmed_at: at };
  const add = () => handleAdmin(new Request("https://accounts.test/admin/team", { method: "POST", body: JSON.stringify({ email: "sam@example.test", role: "support" }) }), env, staff, "/admin/team", token({}));
  await assert.rejects(add(), (e: { status: number }) => e.status === 409);
  env.DB.db.prepare("DELETE FROM desktop_activity WHERE user_id='old-account'").run();
  assert.equal((await (await add()).json()).ok, true);
  assert.equal((env.DB.db.prepare("SELECT user_id FROM desktop_admins").get() as { user_id: string }).user_id, "new-account");
});
