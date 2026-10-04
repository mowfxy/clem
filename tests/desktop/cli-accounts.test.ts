import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliAccounts } from "../../desktop/cli-accounts.ts";
import { claudeUsage, parseRateLimit } from "../../desktop/claude.ts";
import { grokUsage } from "../../desktop/grok.ts";

class MemoryVault {
  data = new Map<string, unknown>();
  async read<T>(key: string, fallback: T) { return (this.data.has(key) ? this.data.get(key) : fallback) as T; }
  async write(key: string, value: unknown) { this.data.set(key, value); }
}
type Fake = { busy: boolean; connected: boolean; email: string; left: number | null; loggedOut: boolean; cancel(): void; stop(): void; logout(): Promise<void>; endSession(): Promise<void>; forget(): void };
function setup(spec: Record<string, { connected?: boolean; left?: number | null }> = {}) {
  const root = mkdtempSync(join(tmpdir(), "cli-accounts-"));
  const vault = new MemoryVault();
  const made = new Map<string, Fake>();
  const accounts = new CliAccounts<Fake>("claude", vault as any, {
    make: (_owner, id) => {
      const s = spec[id] || {};
      const fake: Fake = { busy: false, connected: s.connected ?? true, email: id + "@example.com", left: s.left === undefined ? 80 : s.left, loggedOut: false, cancel() {}, stop() {}, async logout() { this.loggedOut = true; }, async endSession() {}, forget() {} };
      made.set(id, fake);
      return fake;
    },
    folder: (_owner, id) => join(root, id),
    describe: async (p) => ({ connected: p.connected, email: p.email, ...(p.left === null ? {} : { usage: { rateLimits: { primary: { usedPercent: 100 - p.left, windowDurationMins: 300, resetsAt: Date.now() / 1000 + 3600 } } } }) }),
  });
  return { accounts, vault, made, root };
}

test("Claude and Grok usage read in ChatGPT's shape, so they show and switch the same way", () => {
  const now = 1_800_000_000;
  const five = parseRateLimit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.92, resetsAt: now + 600 } })!;
  const week = parseRateLimit({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "seven_day", resetsAt: now + 9000 } })!;
  const usage = claudeUsage([five, week], now)!;
  assert.equal(Math.round(usage.rateLimits!.primary!.usedPercent!), 92);
  assert.equal(usage.rateLimits!.secondary!.usedPercent, 100);
  assert.equal(usage.ordinaryUsageAllowed, false);
  // A window that has reset is shown as full again.
  assert.equal(claudeUsage([five], now + 700)!.rateLimits!.primary!.usedPercent, 0);
  assert.deepEqual(grokUsage({ percentUsed: 12, periodEnd: "2026-10-07T21:23:27Z", period: "USAGE_PERIOD_TYPE_WEEKLY" }), { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: Math.round(Date.parse("2026-10-07T21:23:27Z") / 1000) } } });
});

test("with automatic switching, a nearly used-up account hands the next request to one with usage left", async () => {
  const { accounts, vault } = setup({ default: { left: 4 }, b: { left: 3 }, c: { left: 60 } });
  await vault.write("claude-accounts-o", { active: "default", ids: ["default", "b", "c"] });
  assert.deepEqual(await accounts.selectForTask("o", false), { active: "default", switched: false });
  const moved = await accounts.selectForTask("o", true);
  assert.equal(moved.active, "c");
  assert.equal(moved.switched, true);
  assert.equal((await accounts.selected("o")).id, "c");
});

test("a request the plan refuses moves to another account, and the refused one waits for its reset", async () => {
  const { accounts, vault } = setup({ default: { left: 50 }, b: { left: null } });
  await vault.write("claude-accounts-o", { active: "default", ids: ["default", "b"] });
  assert.equal(await accounts.failover("o", "default", false), null);
  const next = await accounts.failover("o", "default", true);
  assert.equal(next?.id, "b");
  assert.equal((await accounts.selected("o")).id, "b");
  // Refused accounts are shown as out of usage and are not chosen again until they reset.
  const listed = await accounts.list("o");
  assert.equal(listed.accounts.find((a) => a.id === "default")!.usage!.ordinaryUsageAllowed, false);
  assert.equal(await accounts.failover("o", "b", true), null);
});

test("accounts are added, used and removed like ChatGPT's; an added one's folder goes with it", async () => {
  const { accounts, made, root } = setup();
  let signedIn = 0;
  const { id } = await accounts.add("o", async () => { signedIn++; });
  assert.equal(signedIn, 1);
  mkdirSync(join(root, id), { recursive: true });
  made.get(id)!.connected = false;
  assert.equal((await accounts.list("o")).accounts.find((a) => a.id === id)!.pending, true);
  await assert.rejects(accounts.activate("o", id), /Sign in/);
  made.get(id)!.connected = true;
  await accounts.activate("o", id);
  assert.equal((await accounts.selected("o")).id, id);
  made.get(id)!.busy = true;
  await assert.rejects(accounts.remove("o", id), /Finish or stop/);
  made.get(id)!.busy = false;
  await accounts.remove("o", id);
  assert.equal(made.get(id)!.loggedOut, true);
  assert.equal(existsSync(join(root, id)), false);
  assert.deepEqual(await accounts.ids("o"), ["default"]);
  assert.equal((await accounts.selected("o")).id, "default");
});
