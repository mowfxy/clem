import test from "node:test";
import assert from "node:assert/strict";
import { EssentialSync } from "../desktop/essential-sync.ts";
import { requestSchema } from "../desktop/contracts.ts";
import { applyEssentials, essentials } from "../src/essential-state.ts";

const skill = (id: string) => ({ id, name: id, description: "", category: "", icon: "skills", steps: ["one", "two"], builtin: false as const });
const note = (id: string, text: string) => ({ id, text });
const blank = { studySets: [], plans: [], chats: [], spaces: [], files: [], skills: [], visuals: [], automations: [], name: "Thinker", memory: "", quiet: false } as any;

/** A vault and a cloud that hold what the real ones would, answering `?since=` as the real one does. */
function world(kind: "skills" | "notes", items: any[]) {
  const store = new Map<string, unknown>([[`essential-me-${kind}`, { data: items, revision: 4 }]]);
  const remote = { data: items, revision: 4 }, uploads: any[][] = [];
  let offline = false;
  const vault = { read: async (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback), write: async (key: string, value: unknown) => void store.set(key, value) };
  const auth = {
    user: async () => ({ id: "me" }),
    cloud: async (path: string, body?: { revision: number; data: any[] }) => {
      if (offline) throw Error("offline");
      if (!body) return path.endsWith("?since=" + remote.revision) ? { unchanged: true, revision: remote.revision } : { data: remote.data, revision: remote.revision };
      assert.equal(body.revision, remote.revision, "uploads against the revision it read");
      uploads.push(body.data);
      remote.data = body.data;
      remote.revision++;
      return { revision: remote.revision };
    },
  };
  return { sync: new EssentialSync(vault as never, auth as never), store, remote, uploads, goOffline: (value = true) => { offline = value; } };
}

/** The real load, with the desktop's local server and the browser's stores standing in. */
async function loadedWorkspace(saved: unknown) {
  const global = globalThis as any;
  global.window = { clemDesktop: {} };
  const empty = { get() { const request: any = {}; queueMicrotask(() => request.onsuccess?.()); return request; } };
  const database = { createObjectStore() {}, transaction: () => ({ objectStore: () => empty }) };
  global.indexedDB = { open() { const request: any = { result: database }; queueMicrotask(() => request.onsuccess?.()); return request; } };
  global.fetch = async () => new Response(JSON.stringify(saved));
  const { loadState } = await import("../src/store.ts");
  return loadState();
}

for (const [kind, one, two] of [["skills", skill("a"), skill("b")], ["notes", note("a", "Nurse"), note("b", "Lives in Cairo")]] as const) {
  test(`${kind}: a lost workspace restores from the cloud and uploads nothing empty`, async () => {
    const w = world(kind, [one, two]);
    const { data, error } = await w.sync.exchange("me", kind, [], { noBaseline: true });
    assert.equal(error, undefined);
    assert.deepEqual(data, [one, two]);
    assert.deepEqual(w.uploads, [], "the cloud copy is left alone");
    assert.deepEqual(w.remote.data, [one, two]);
  });

  test(`${kind}: without the flag the same empty list is a person deleting everything, and that still reaches the cloud`, async () => {
    const w = world(kind, [one, two]);
    const { data } = await w.sync.exchange("me", kind, []);
    assert.deepEqual(data, []);
    assert.deepEqual(w.remote.data, []);
  });

  test(`${kind}: deleting one still reaches the cloud`, async () => {
    const w = world(kind, [one, two]);
    await w.sync.exchange("me", kind, [two]);
    assert.deepEqual(w.remote.data, [two]);
  });

  test(`${kind}: what was made after a loss joins the cloud copy instead of replacing it`, async () => {
    const made = kind === "skills" ? skill("z") : note("z", "Moved to Berlin");
    const w = world(kind, [one]);
    const { data } = await w.sync.exchange("me", kind, [made], { noBaseline: true });
    assert.deepEqual(data, [one, made]);
    assert.deepEqual(w.remote.data, [one, made]);
  });
}

test("a workspace whose file was missing asks not to be compared with the baseline", async () => {
  const state = await loadedWorkspace(null);
  assert.equal(state.essentialsUnsynced, true);
  assert.equal(essentials(state).noBaseline, true);
  assert.equal(requestSchema.parse({ action: "essentialSync", ...essentials(state) }).noBaseline, true, "the flag survives the desktop contract");
});

test("a saved workspace with everything deleted is an ordinary sync", async () => {
  const state = await loadedWorkspace(blank);
  assert.equal(state.essentialsUnsynced, undefined);
  assert.deepEqual(essentials(state), { skills: [], notes: [] });
});

test("the mark is saved with the workspace, so a restart before the first sync stays safe", async () => {
  const state = await loadedWorkspace(JSON.parse(JSON.stringify({ ...blank, essentialsUnsynced: true })));
  assert.equal(essentials(state).noBaseline, true);
});

test("a lost workspace, start to finish: restored once, then deleting works again", async () => {
  const kept = note("personal", "Nurse");
  const w = world("notes", [kept]);
  let state = { ...blank, essentialsUnsynced: true };

  // Offline the first time: nothing changes, and the workspace stays marked.
  w.goOffline();
  const failed = await w.sync.exchange("me", "notes", essentials(state).notes, { noBaseline: essentials(state).noBaseline });
  state = applyEssentials(state, { skills: [], notes: failed.data as never, error: failed.error });
  assert.equal(essentials(state).noBaseline, true);
  assert.deepEqual(w.remote.data, [kept]);

  w.goOffline(false);
  const restored = await w.sync.exchange("me", "notes", essentials(state).notes, { noBaseline: essentials(state).noBaseline });
  state = applyEssentials(state, { skills: [], notes: restored.data as never });
  assert.equal(state.memory, "Nurse");
  assert.equal("essentialsUnsynced" in state, false);
  assert.equal(essentials(state).noBaseline, undefined);

  // From here on the person is in charge: clearing the note clears it everywhere.
  state = { ...state, memory: "" };
  await w.sync.exchange("me", "notes", essentials(state).notes.filter((n) => n.id !== "personal"), { noBaseline: essentials(state).noBaseline });
  assert.deepEqual(w.remote.data, []);
});
