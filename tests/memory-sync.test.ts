import test from "node:test";
import assert from "node:assert/strict";
import { EssentialSync } from "../desktop/essential-sync.ts";
import { mergeSync } from "../core/sync.ts";

const record = (id: string, text: string) => ({
  id, scope: "user:me", key: "topic:Background", text, kind: "fact", confirmed: true, confidence: 1,
  source: { id: "chat:a", locator: "x", at: "2026-01-01T00:00:00.000Z" },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", derivedFrom: [], sharedWith: [],
});
/** A vault and a cloud that hold what the real ones would. */
function world(cloud: any[], baseline: any[]) {
  const store = new Map<string, unknown>([["essential-me-memory", { data: baseline, revision: 4 }]]);
  const remote = { data: cloud, revision: 4 }, uploads: any[][] = [];
  let offline = false;
  const vault = { read: async (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback), write: async (key: string, value: unknown) => void store.set(key, value) };
  const auth = {
    user: async () => ({ id: "me" }),
    cloud: async (_path: string, body?: { revision: number; data: any[] }) => {
      if (offline) throw Error("offline");
      if (!body) return { data: remote.data, revision: remote.revision };
      assert.equal(body.revision, remote.revision, "uploads against the revision it read");
      uploads.push(body.data);
      remote.data = body.data;
      remote.revision++;
      return { revision: remote.revision };
    },
  };
  return { sync: new EssentialSync(vault as never, auth as never), remote, uploads, goOffline: () => { offline = true; } };
}

test("the bug this guards: a baseline with an empty list reads as everything deleted", () => {
  const a = record("a", "Nurse");
  assert.deepEqual(mergeSync([a], [], [a]), []);
});

test("a memory file that went missing restores from the cloud and uploads nothing empty", async () => {
  const a = record("a", "Nurse"), b = record("b", "Lives in Cairo");
  const w = world([a, b], [a, b]);
  const { data, error } = await w.sync.exchange("me", "memory", [], { noBaseline: true });
  assert.equal(error, undefined);
  assert.deepEqual(data, [a, b]);
  assert.deepEqual(w.uploads, [], "the cloud copy is left alone");
  assert.deepEqual(w.remote.data, [a, b]);
});

test("what was learned before the first sync after a loss is added to the cloud copy, not put in its place", async () => {
  const a = record("a", "Nurse"), fresh = record("z", "Lives in Berlin");
  const w = world([a], [a]);
  const { data } = await w.sync.exchange("me", "memory", [fresh], { noBaseline: true });
  assert.deepEqual(data, [a, fresh]);
  assert.deepEqual(w.remote.data, [a, fresh]);
});

test("offline during a restore, nothing is uploaded and the error is passed on", async () => {
  const a = record("a", "Nurse");
  const w = world([a], [a]);
  w.goOffline();
  const { data, error } = await w.sync.exchange("me", "memory", [], { noBaseline: true });
  assert.match(error!, /^Saved locally\. offline/);
  assert.deepEqual(data, []);
  assert.deepEqual(w.remote.data, [a]);
});

test("an ordinary sync still treats a forgotten memory as forgotten", async () => {
  const a = record("a", "Nurse"), b = record("b", "Lives in Cairo");
  const w = world([a, b], [a, b]);
  const { data } = await w.sync.exchange("me", "memory", [b]);
  assert.deepEqual(data, [b]);
  assert.deepEqual(w.remote.data, [b]);
});
