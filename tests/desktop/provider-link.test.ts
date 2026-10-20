import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ProviderLink } from "../../desktop/provider-link.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
function setup(remote: { id: string; kind: "codex" | "claude"; label: string; hash: string; data: string }[]) {
  const store = new Map<string, unknown>(), puts: unknown[] = [];
  const vault = { read: async (k: string, d: unknown) => (store.has(k) ? store.get(k) : d), write: async (k: string, v: unknown) => { store.set(k, v); } };
  const auth = { user: async () => ({ id: "owner" }), cloud: async (path: string, body?: any) => { if (path === "/providers") return { items: remote }; puts.push(body); return { ok: true }; } };
  return { vault, auth, puts, store };
}

test("linked sign-ins are restored, newer local ones are kept, stale ones replaced", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-link-"));
  const fresh = JSON.stringify({ tokens: "cloud" });
  const env = setup([{ id: "a", kind: "codex", label: "", hash: sha(fresh), data: fresh }, { id: "claude", kind: "claude", label: "", hash: sha(fresh), data: fresh }]);
  const link = new ProviderLink(env.auth as any, env.vault as any, root);
  // Missing locally: restored.
  let result = await link.restore("owner");
  assert.deepEqual(result.written.sort(), ["a", "claude"]);
  assert.equal(await readFile(link.codexFile("owner", "a"), "utf8"), fresh);
  // Refreshed here since the last upload: kept, then uploaded by backup.
  const local = JSON.stringify({ tokens: "local-newer" });
  await writeFile(link.codexFile("owner", "a"), local);
  result = await link.restore("owner");
  assert.deepEqual(result.written, []);
  assert.equal(await readFile(link.codexFile("owner", "a"), "utf8"), local);
  await link.backup("owner", "a", "codex");
  assert.equal((env.puts.at(-1) as any).data, local);
});

test("a copy this PC uploaded is replaced when the account holds a newer one", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-link-"));
  const old = JSON.stringify({ tokens: "old" }), newer = JSON.stringify({ tokens: "rotated-elsewhere" });
  const env = setup([{ id: "a", kind: "codex", label: "", hash: sha(newer), data: newer }]);
  env.store.set("provider-link-owner", { a: sha(old) });
  const link = new ProviderLink(env.auth as any, env.vault as any, root);
  await mkdir(join(root, "owner", "accounts", "a"), { recursive: true });
  await writeFile(link.codexFile("owner", "a"), old);
  const result = await link.restore("owner");
  assert.deepEqual(result.written, ["a"]);
  assert.equal(await readFile(link.codexFile("owner", "a"), "utf8"), newer);
});

test("a linked entry whose id is not a plain name is never written to disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-link-"));
  const data = JSON.stringify({ tokens: "x" });
  const env = setup([{ id: "../../escape", kind: "codex", label: "", hash: sha(data), data }, { id: "b", kind: "other" as any, label: "", hash: sha(data), data }]);
  const link = new ProviderLink(env.auth as any, env.vault as any, root);
  const result = await link.restore("owner");
  assert.deepEqual(result.written, []);
  assert.deepEqual(result.codex, []);
  await assert.rejects(readFile(join(root, "escape", "auth.json"), "utf8"));
  await assert.rejects(readFile(link.claudeFile("owner"), "utf8"));
});
