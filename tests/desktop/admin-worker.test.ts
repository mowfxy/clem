import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../../cloudflare/account-worker.js";

function setup() {
  const database = new DatabaseSync(":memory:");
  for (const file of ["account-schema.sql", "sync-schema.sql", "admin-schema.sql"])
    database.exec(readFileSync(new URL("../../cloudflare/" + file, import.meta.url), "utf8"));
  const DB = {
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
    database.prepare("INSERT INTO mowr_support(id,owner_id,category,subject,message) VALUES(?,?,?,?,?)").run("case-0001", "member-id", "Report a bug", "Export fails", "The export button does nothing.");

    current = people.owner;
    const me = await (await call("/admin/me", undefined, "https://admin.mowrai.com")).json();
    assert.equal(me.role, "owner");
    const preflight = await worker.fetch(new Request("https://account.example/admin/me", { method: "OPTIONS", headers: { Origin: "https://admin.mowrai.com" } }), env);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://admin.mowrai.com");
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
    const audit = await (await call("/admin/audit")).json();
    assert.ok(audit.entries.some((e: any) => e.action === "user.suspend"));
  } finally {
    globalThis.fetch = original;
  }
});
