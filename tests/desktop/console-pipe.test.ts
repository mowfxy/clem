import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAIN_LOG, noteEvent, startMainLog } from "../../desktop/diagnostics.ts";

test("a closed console pipe never crashes Clem, and the warning still reaches its log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-log-"));
  const writes = [process.stdout.write, process.stderr.write];
  try {
    startMainLog(dir);
    // What Clem sees when the updater that started it has gone: every console write fails with EPIPE.
    const broken = () => { throw Object.assign(Error("EPIPE: broken pipe, write"), { code: "EPIPE" }); };
    process.stdout.write = broken as any;
    process.stderr.write = broken as any;
    assert.doesNotThrow(() => noteEvent("update:", "checking"));
    assert.doesNotThrow(() => console.error("an error"));
    assert.doesNotThrow(() => console.log("[clem timing] 1 s"));
    process.stdout.write = writes[0];
    process.stderr.write = writes[1];
    // The same failure raised later, as the stream's error event, is not an uncaught exception either.
    assert.ok(process.stderr.listenerCount("error") > 0 && process.stdout.listenerCount("error") > 0);
    assert.doesNotThrow(() => process.stderr.emit("error", Object.assign(Error("EPIPE"), { code: "EPIPE" })));
    const log = await readFile(join(dir, MAIN_LOG), "utf8");
    assert.match(log, /update: checking/);
    assert.match(log, /an error/);
  } finally {
    process.stdout.write = writes[0];
    process.stderr.write = writes[1];
    await rm(dir, { recursive: true, force: true });
  }
});
