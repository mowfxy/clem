import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPglite } from "../desktop/engine/db.ts";
import { Jobs } from "../desktop/engine/jobs.ts";

const until = async (check: () => Promise<boolean>, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await check()) return;
  throw Error("timed out");
};

test("pg-boss on PGlite retries a failed job and keeps jobs and schedules across a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-jobs-"));
  try {
    let { pg } = await openPglite(dir);
    let jobs = new Jobs(pg);
    await jobs.start();
    let runs = 0;
    await jobs.queue("guc.sync", async () => { if (++runs === 1) throw Error("GUC is down"); }, { retries: 2, delay: 1, poll: 0.5 });
    const id = (await jobs.send("guc.sync", { owner: "o" }))!;
    await until(async () => (await jobs.job("guc.sync", id))?.state === "completed");
    assert.equal(runs, 2);
    assert.equal((await jobs.job("guc.sync", id))!.retryCount, 1);
    await jobs.schedule("guc.sync", "0 */3 * * *");
    await jobs.stop();
    await pg.close();

    // A job sent while nothing works it, and the schedule, are still there after reopening.
    ({ pg } = await openPglite(dir));
    jobs = new Jobs(pg);
    await jobs.start();
    const waiting = (await jobs.send("guc.sync", {}, { startAfter: 3600 }))!;
    await jobs.stop();
    await pg.close();
    ({ pg } = await openPglite(dir));
    jobs = new Jobs(pg);
    await jobs.start();
    assert.equal((await jobs.job("guc.sync", waiting))?.state, "created");
    assert.deepEqual((await jobs.schedules()).map((s) => [s.name, s.cron, s.timezone]), [["guc.sync", "0 */3 * * *", "Africa/Cairo"]]);
    await jobs.stop();
    await pg.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
