// Budgets from the performance pass (docs/PERFORMANCE-GUC-VPS.md), on a large fake GUC (504 files in three courses):
// requests per sync and check must not grow, and writing a sync stays a statement per table, not per row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bench } from "../scripts/bench-guc-engine.ts";

test("syncs and checks keep their request and statement budgets on a large CMS", async () => {
  const { out, plans } = await bench();
  assert.deepEqual(
    [out.initialSyncRequests, out.resyncRequests, out.firstCheckRequests, out.oneNewFileRequests, out.unchangedCheckRequests],
    [11, 7, 169, 2, 1], "requests: initial sync (now with CheckGrade, exam seats and mail), unchanged re-sync, first check (168 files + page), one new file, unchanged check");
  assert.equal(out.oneNewFileSaved, 1);
  assert.ok(Number(out.initialSyncStatements) <= 60, `initial sync wrote row by row (${out.initialSyncStatements} statements)`);
  assert.ok(Number(out.oneNewFileStatements) <= 60, `a changed page rewrote row by row (${out.oneNewFileStatements} statements)`);
  assert.ok(Number(out.unchangedCheckStatements) <= 30, `unchanged check: ${out.unchangedCheckStatements} statements`);
  assert.ok(Number(out.ackInboxStatements) <= 2, `acknowledging the inbox: ${out.ackInboxStatements} statements`);
  assert.match(plans["materials by course"], /guc_materials_course/);
  assert.match(plans["events since"], /guc_events_recent/);
});
