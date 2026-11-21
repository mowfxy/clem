// With a VPS worker running Clem's jobs, the hub reads the worker's database, so the PC's AI runs every guc.* request
// there (desktop/engine/ai-tools.ts runGucTool `remote`): a Coming up item it adds is one the hub then shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGucTool } from "../desktop/engine/ai-tools.ts";

const engine = { owner: "u1" } as never;

test("guc.* runs on the worker when there is one; an older worker or none runs it here; a worker's failure is said", async () => {
  const sent: unknown[] = [];
  let changed = 0;
  const out = await runGucTool({ engine, owner: "u1", subjects: [{ id: "s1", name: "Physics" }], scope: "s1", changed: () => changed++, remote: async (request, ctx) => { sent.push([request, ctx]); return "Added PHYST 301 Quiz 3"; } },
    { action: "guc.correct", do: "add", subject: "Physics", title: "Quiz 3", date: "2026-12-03" });
  assert.equal(out, "Added PHYST 301 Quiz 3");
  assert.deepEqual(sent, [[{ action: "guc.correct", do: "add", subject: "Physics", title: "Quiz 3", date: "2026-12-03" }, { subjects: [{ id: "s1", name: "Physics" }], scope: "s1", now: undefined }]]);
  assert.equal(changed, 1, "the window refreshes its cards");
  // A worker too old for it (or none running): the request runs here, as before.
  const here = await runGucTool({ engine, owner: "u1", subjects: [], remote: async () => { throw Error("Not allowed: worker.gucTool"); } }, { action: "guc.help" });
  assert.match(String(here), /guc\.deadlines/);
  // The worker failed: said, never quietly done on this PC's copy instead.
  const failed = await runGucTool({ engine, owner: "u1", subjects: [], remote: async () => { throw Error("socket hang up"); } }, { action: "guc.help" });
  assert.deepEqual(failed, { error: "Your VPS couldn't do that just now: socket hang up" });
  // Not a guc.* request: never sent.
  const unknown = await runGucTool({ engine, owner: "u1", subjects: [], remote: async () => { throw Error("sent"); } }, { action: "nope" });
  assert.match(JSON.stringify(unknown), /Unknown GUC action/);
});
