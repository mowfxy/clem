import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../../cloudflare/account-worker.js";

function setup() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["account-schema.sql", "sync-schema.sql", "admin-schema.sql", "provider-links.sql"])
    database.exec(readFileSync(new URL("../../cloudflare/" + file, import.meta.url), "utf8"));
  const DB = {
    async batch(statements: any[]) { for (const statement of statements) await statement.run(); },
    prepare(sql: string) {
      return {
        bind(...values: any[]) {
          const statement = database.prepare(sql);
          return {
            first: async () => statement.get(...values) || null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => statement.run(...values),
          };
        },
      };
    },
  };
  return { database, env: { DB, SUPABASE_URL: "https://auth.example", SUPABASE_ANON_KEY: "public" } as any };
}

test("staff portal enforces roles, moderates accounts and manages complimentary access", async () => {
  const { database, env } = setup(), original = globalThis.fetch;
  const people: Record<string, any> = {
    owner: { id: "owner-id", email: "m@mohamedmowafy.com", email_confirmed_at: "2026-09-19" },
    member: { id: "member-id", email: "member@example.com", email_confirmed_at: "2026-09-19" },
    helper: { id: "helper-id", email: "helper@example.com", email_confirmed_at: "2026-09-19" },
  };
  let current = people.member;
  globalThis.fetch = (async () => Response.json(current)) as any;
  const call = (path: string, body?: unknown, origin?: string) =>
    worker.fetch(new Request("https://account.example" + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer x.e30.y", "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
  try {
    // Each person is seen once so staff can find them by email.
    for (const key of ["member", "helper", "owner"]) { current = people[key]; await call("/entitlement"); }
    current = people.member;
    assert.equal((await call("/admin/me")).status, 403);
    database.prepare("INSERT INTO clem_support(id,owner_id,category,subject,message) VALUES(?,?,?,?,?)").run("case-0001", "member-id", "Report a bug", "Export fails", "The export button does nothing.");

    current = people.owner;
    const me = await (await call("/admin/me", undefined, "https://admin.m4labs.xyz")).json();
    assert.equal(me.role, "owner");
    const preflight = await worker.fetch(new Request("https://account.example/admin/me", { method: "OPTIONS", headers: { Origin: "https://admin.m4labs.xyz" } }), env);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://admin.m4labs.xyz");
    const foreign = await worker.fetch(new Request("https://account.example/admin/me", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
    assert.equal(foreign.headers.get("Access-Control-Allow-Origin"), null);

    // Complimentary access unlocks the app and can be revoked.
    assert.equal((await call("/admin/users/member-id/grant", { days: 30, reason: "Beta tester" })).status, 200);
    current = people.member;
    assert.equal((await (await call("/entitlement")).json()).reason, "complimentary");
    current = people.owner;
    const detail = await (await call("/admin/users/member-id")).json();
    assert.equal(detail.user.plan, "complimentary");
    assert.equal(detail.user.email, "member@example.com");
    assert.equal((await call("/admin/users/member-id/revoke-grant", { grantId: detail.grants[0].id })).status, 200);

    // Suspension blocks access and checkout; owners cannot be suspended.
    assert.equal((await call("/admin/users/member-id/suspend", { reason: "Abuse", days: 7 })).status, 200);
    assert.equal((await call("/admin/users/owner-id/suspend", { reason: "x" })).status, 409);
    current = people.member;
    const blocked = await (await call("/entitlement")).json();
    assert.deepEqual([blocked.active, blocked.reason, blocked.message], [false, "suspended", "Abuse"]);
    current = people.owner;
    await call("/admin/users/member-id/unsuspend", {});
    current = people.member;
    assert.equal((await (await call("/entitlement")).json()).reason, "free");

    // Support staff can answer cases but cannot grant access.
    current = people.owner;
    assert.equal((await call("/admin/team", { email: "helper@example.com", role: "support" })).status, 200);
    current = people.helper;
    assert.equal((await call("/admin/users/member-id/grant", { days: 1 })).status, 403);
    assert.equal((await call("/admin/cases/case-0001/reply", { body: "Fixed in the next build." })).status, 200);
    assert.equal((await call("/admin/cases/case-0001/reply", { body: "Customer on old build", internal: true })).status, 200);

    // The person sees the staff reply, not the internal note, and replying reopens the case.
    current = people.member;
    const mine = await (await call("/support/cases")).json();
    assert.equal(mine.cases[0].status, "pending");
    assert.equal(mine.cases[0].unread, true);
    assert.deepEqual(mine.cases[0].messages.map((m: any) => m.author), ["staff"]);
    assert.equal((await call("/support/cases/case-0001/reply", { body: "Thanks!" })).status, 200);
    current = people.owner;
    const inbox = await (await call("/admin/cases")).json();
    assert.equal(inbox.cases[0].status, "open");
    assert.equal(inbox.cases[0].awaiting_staff, true);

    // Other people cannot read the case.
    current = people.helper;
    assert.equal((await call("/support/cases/case-0001/reply", { body: "hi there" })).status, 404);

    // Announcements reach signed-in people until archived.
    current = people.owner;
    const posted = await (await call("/admin/announcements", { title: "Maintenance", body: "Sign-in may pause tonight.", tone: "warning", days: 2 })).json();
    current = people.member;
    assert.equal((await (await call("/announcements")).json()).announcements[0].title, "Maintenance");
    current = people.owner;
    await call(`/admin/announcements/${posted.announcement.id}/archive`, {});
    assert.equal((await (await call("/admin/announcements", { title: "x", body: "y", link: "https://evil.example" })).status), 400);
    current = people.member;
    assert.equal((await (await call("/announcements")).json()).announcements.length, 0);

    current = people.owner;
    const overview = await (await call("/admin/overview")).json();
    assert.equal(overview.users, 3);
    assert.equal(overview.openCases, 1);
    // Clem is free: the overview reports welcome progress, not plans or revenue.
    assert.equal(Object.values(overview.setup as Record<string, number>).reduce((a, b) => a + b, 0), 3);
    assert.equal(overview.mrrCents, undefined);
    const settingUp = await (await call("/admin/users?plan=setup")).json();
    assert.equal(settingUp.total, 3);
    const audit = await (await call("/admin/audit")).json();
    assert.ok(audit.entries.some((e: any) => e.action === "user.suspend"));
  } finally {
    globalThis.fetch = original;
  }
});

test("the app reports anonymous usage counts and staff see them as stats", async () => {
  const { env } = setup(), original = globalThis.fetch;
  const people: Record<string, any> = {
    owner: { id: "owner-id", email: "m@mohamedmowafy.com", email_confirmed_at: "2026-09-19" },
    member: { id: "member-id", email: "member@example.com", email_confirmed_at: "2026-09-19" },
  };
  let current = people.member;
  globalThis.fetch = (async () => Response.json(current)) as any;
  const call = (path: string, body?: unknown) =>
    worker.fetch(new Request("https://account.example" + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer x.e30.y", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
  const today = new Date().toISOString().slice(0, 10);
  const hours = Array(24).fill(0); hours[22] = 5;
  try {
    const report = { days: [{ day: today, hours, rows: [{ provider: "claude", model: "sonnet", reasoning: "high", turns: 4, images: 1 }, { provider: "chatgpt", model: "gpt-5.5", reasoning: "", turns: 2, images: 0 }] }] };
    assert.equal((await call("/usage", report)).status, 200);
    // Resending the same running totals does not double count.
    assert.equal((await call("/usage", report)).status, 200);
    assert.equal((await call("/usage", { days: [{ day: today, rows: [{ provider: "other", model: "x", turns: 1, images: 0 }] }] })).status, 400);
    // A day from before a long break is dropped, so the rest of that report still counts.
    assert.equal((await call("/usage", { days: [{ day: "2020-01-01", rows: [] }] })).status, 200);
    assert.equal((await call("/admin/stats")).status, 403);
    current = people.owner;
    const stats = await (await call("/admin/stats?days=7")).json();
    assert.equal(stats.turns, 6);
    assert.equal(stats.people, 1);
    assert.equal(stats.images, 1);
    assert.equal(stats.providers[0].provider, "claude");
    assert.equal(stats.models[0].model, "sonnet");
    assert.equal(stats.byHour[22], 5);
    assert.equal(stats.series.length, 7);
    assert.equal(stats.multiProvider, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("suspension, legacy support ids, audit visibility and exact people totals", async () => {
  const { database, env } = setup(), original = globalThis.fetch;
  const uuid = "5f0c7a52-3d4e-4b1a-9c6e-2a7b8d9e0f11";
  const people: Record<string, any> = {
    owner: { id: "owner-id", email: "m@mohamedmowafy.com", email_confirmed_at: "2026-09-19" },
    admin: { id: "admin-id", email: "admin@example.com", email_confirmed_at: "2026-09-19" },
    helper: { id: "helper-id", email: "helper@example.com", email_confirmed_at: "2026-09-19" },
    member: { id: uuid, email: "member@example.com", email_confirmed_at: "2026-09-19" },
  };
  let current = people.member;
  globalThis.fetch = (async () => Response.json(current)) as any;
  const call = (path: string, body?: unknown, raw?: string) =>
    worker.fetch(new Request("https://account.example" + path, {
      method: body !== undefined || raw !== undefined ? "POST" : "GET",
      headers: { Authorization: "Bearer x.e30.y", "Content-Type": "application/json" },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    }), env);
  try {
    for (const key of ["member", "admin", "helper", "owner"]) { current = people[key]; await call("/entitlement"); }
    // A case filed on clem.m4labs.xyz before owner ids were unified still reaches its owner and staff.
    database.prepare("INSERT INTO clem_support(id,owner_id,category,subject,message) VALUES(?,?,?,?,?)").run("case-legacy1", "supabase:" + uuid, "Report a bug", "Old case", "Filed with the prefixed id.");
    database.prepare("INSERT INTO clem_support(id,owner_id,category,subject,message) VALUES(?,?,?,?,?)").run("case-current", uuid, "Report a bug", "New case", "Filed with the bare id.");
    current = people.member;
    assert.equal((await (await call("/support/cases")).json()).cases.length, 2);
    assert.equal((await call("/profile", undefined, "{not json")).status, 400);

    current = people.owner;
    await call("/admin/team", { email: "admin@example.com", role: "admin" });
    await call("/admin/team", { email: "helper@example.com", role: "support" });
    const detail = await (await call("/admin/users/" + uuid)).json();
    assert.equal(detail.user.cases, 2);
    assert.equal(detail.cases.length, 2);
    assert.equal(detail.user.email, "member@example.com");
    const opened = await (await call("/admin/cases/case-legacy1")).json();
    assert.equal(opened.case.owner_id, uuid);
    assert.equal(opened.case.email, "member@example.com");
    assert.equal(opened.otherCases.length, 1);
    const inbox = await (await call("/admin/cases")).json();
    assert.ok(inbox.cases.every((c: any) => c.owner_id === uuid && c.email === "member@example.com"));
    const all = await (await call("/admin/users")).json();
    assert.equal(all.total, 4);
    assert.equal(all.users.filter((u: any) => u.id.startsWith("supabase:")).length, 0);

    // A suspended person keeps support (to appeal) but loses every other feature.
    assert.equal((await call(`/admin/users/${uuid}/suspend`, { reason: "Abuse" })).status, 200);
    assert.equal((await (await call("/admin/users?plan=suspended")).json()).total, 1);
    assert.equal((await (await call("/admin/overview")).json()).suspended, 1);
    current = people.member;
    assert.equal((await call("/support/cases")).status, 200);
    assert.equal((await (await call("/entitlement")).json()).reason, "suspended");
    for (const path of ["/sync/notes", "/providers"]) assert.equal((await call(path)).status, 403);
    assert.equal((await call("/usage", { days: [] })).status, 403);
    assert.equal((await call("/profile", { username: "member1", displayName: "M", step: 1, memory: true })).status, 403);

    // Support staff do not see the admin-only audit log through the overview or a person's history.
    current = people.helper;
    const overview = await (await call("/admin/overview")).json();
    assert.deepEqual(overview.recentAudit, []);
    assert.equal(overview.users, 4);
    assert.deepEqual((await (await call("/admin/users/" + uuid)).json()).history, []);
    current = people.admin;
    assert.ok((await (await call("/admin/users/" + uuid)).json()).history.length > 0);

    // A suspended admin loses the portal and cannot lift their own suspension.
    current = people.owner;
    assert.equal((await call("/admin/users/admin-id/suspend", { reason: "Compromised" })).status, 200);
    current = people.admin;
    assert.equal((await call("/admin/me")).status, 403);
    assert.equal((await call("/admin/users/admin-id/unsuspend", {})).status, 403);
    current = people.owner;
    assert.equal((await call("/admin/users/owner-id/unsuspend", {})).status, 409);
    assert.equal((await call("/admin/users/admin-id/unsuspend", {})).status, 200);
    current = people.admin;
    assert.equal((await call("/admin/me")).status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test("usage from several PCs adds up without double counting resends", async () => {
  const { env } = setup(), original = globalThis.fetch;
  let current: any = { id: "member-id", email: "member@example.com", email_confirmed_at: "2026-09-19" };
  globalThis.fetch = (async () => Response.json(current)) as any;
  const session = (id: string) => "Bearer x." + Buffer.from(JSON.stringify({ session_id: id })).toString("base64url") + ".y";
  const call = (path: string, body?: unknown, auth = "Bearer x.e30.y") =>
    worker.fetch(new Request("https://account.example" + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
  const today = new Date().toISOString().slice(0, 10);
  const report = (turns: number, hour: number) => {
    const hours = Array(24).fill(0); hours[hour] = turns;
    return { days: [{ day: today, hours, rows: [{ provider: "claude", model: "sonnet", reasoning: "", turns, images: 0 }] }] };
  };
  try {
    assert.equal((await call("/usage", report(3, 9), session("laptop"))).status, 200);
    assert.equal((await call("/usage", report(3, 9), session("laptop"))).status, 200);
    assert.equal((await call("/usage", report(5, 20), session("desktop"))).status, 200);
    assert.equal((await call("/usage", { ...report(2, 20), device: "named-device-1" })).status, 200);
    current = { id: "owner-id", email: "m@mohamedmowafy.com", email_confirmed_at: "2026-09-19" };
    const stats = await (await call("/admin/stats?days=7")).json();
    assert.equal(stats.turns, 10);
    assert.equal(stats.people, 1);
    assert.equal(stats.byHour[9], 3);
    assert.equal(stats.byHour[20], 7);
  } finally {
    globalThis.fetch = original;
  }
});

test("sync accepts collections above 1 MB that core/sync allows", async () => {
  const { env } = setup(), original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ id: "sync-big", email: "a@example.test", email_confirmed_at: "2026-09-20" })) as any;
  try {
    const data = Array.from({ length: 60 }, (_, i) => ({ id: "n" + i, text: ("note " + i + " ").repeat(3000).slice(0, 30000) }));
    const body = JSON.stringify({ revision: 0, data });
    assert.ok(body.length > 1_000_000);
    const r = await worker.fetch(new Request("https://account.example/sync/notes", { method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" }, body }), env);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).revision, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("database worker refuses every request when its secret is missing", async () => {
  const { default: database } = await import("../../cloudflare/database-worker.js");
  const request = () => new Request("https://db.example", { method: "POST", headers: { Authorization: "Bearer undefined" }, body: JSON.stringify({ queries: [{ sql: "SELECT 1", params: [] }] }) });
  const env: any = { DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => [{ results: [] }] } };
  assert.equal((await database.fetch(request(), env)).status, 401);
  assert.equal((await database.fetch(request(), { ...env, DATABASE_SECRET: "" })).status, 401);
  // Workers provide crypto.subtle.timingSafeEqual; Node does not.
  const subtle: any = crypto.subtle, had = subtle.timingSafeEqual;
  subtle.timingSafeEqual ??= (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
  try { assert.equal((await database.fetch(request(), { ...env, DATABASE_SECRET: "undefined" })).status, 200); }
  finally { if (!had) delete subtle.timingSafeEqual; }
});

test("accounts list every M4 Labs account from the directory, and staff without an authenticator get MFA_REQUIRED", async () => {
  const { env } = setup(), original = globalThis.fetch;
  env.SUPABASE_SERVICE_ROLE_KEY = "service";
  const owner = { id: "owner-id", email: "m@mohamedmowafy.com", email_confirmed_at: "2026-09-19" };
  const clem = { id: "clem-id", email: "clem@example.com", email_confirmed_at: "2026-09-19" };
  const directory = [
    { id: "owner-id", email: owner.email, created_at: "2026-09-01T00:00:00Z", last_sign_in_at: new Date().toISOString() },
    { id: "clem-id", email: clem.email, created_at: "2026-09-02T00:00:00Z", last_sign_in_at: null },
    { id: "fresh-id", email: "fresh@example.com", created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString() },
  ];
  let current: any = clem;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/admin/users?")) return Response.json({ users: directory });
    if (String(url).includes("/admin/users/fresh-id")) return Response.json({ ...directory[2], app_metadata: { providers: ["google"] } });
    return Response.json(current);
  }) as any;
  const call = (path: string) => worker.fetch(new Request("https://account.example" + path, { headers: { Authorization: "Bearer x.e30.y" } }), env);
  try {
    await call("/entitlement");
    current = owner;
    await call("/entitlement");
    const all = await (await call("/admin/users")).json();
    assert.equal(all.total, 3);
    assert.deepEqual(all.users.find((u: any) => u.id === "fresh-id").products, []);
    assert.deepEqual(all.users.find((u: any) => u.id === "clem-id").products, ["clem"]);
    assert.deepEqual((await (await call("/admin/users?plan=account")).json()).users.map((u: any) => u.id), ["fresh-id"]);
    const fresh = await (await call("/admin/users/fresh-id")).json();
    assert.equal(fresh.user.email, "fresh@example.com");
    assert.equal((await (await call("/admin/overview")).json()).accounts.total, 3);

    env.ADMIN_REQUIRE_MFA = "true";
    const denied = await call("/admin/me");
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "MFA_REQUIRED");
  } finally {
    globalThis.fetch = original;
  }
});
