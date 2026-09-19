import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexFolder,
  link,
  retrieveFiles,
  inside,
  safeName,
} from "../../desktop/folders.ts";
test("folder index excludes secrets, detects edits and deletions, and stays within budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "mowr-index-test-"));
  try {
    await writeFile(join(root, "notes.md"), "Geometry uses metres");
    await writeFile(join(root, ".env"), "secret");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "notes.txt"), "ignored");
    const folder = await link(root, "project:geometry");
    const first = await indexFolder(folder);
    assert.equal(first.length, 1);
    assert.equal(retrieveFiles(first, "geometry", 8)[0].text.length, 8);
    await writeFile(join(root, "notes.md"), "Geometry has changed");
    const second = await indexFolder(folder, first);
    assert.notEqual(second[0].hash, first[0].hash);
    await rm(join(root, "notes.md"));
    assert.equal((await indexFolder(folder, second)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("boundary checks reject sibling prefixes and sensitive names", () => {
  assert.ok(!inside("C:\\allowed", "C:\\allowed-other\\x"));
  assert.ok(!safeName("credentials.json"));
  assert.ok(!safeName(".ssh"));
});
