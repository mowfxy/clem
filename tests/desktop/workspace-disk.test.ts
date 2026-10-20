import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceDisk } from "../../desktop/workspace-disk.ts";
test("workspace persists per account and refuses traversal without masking corrupted state", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-disk-test-"));
  try {
    const disk = new WorkspaceDisk(root);
    assert.equal(await disk.readState("one"), null);
    await disk.writeState("one", { chats: ["saved"] });
    await disk.writeFile("one", "file", new Uint8Array([1, 2, 3]));
    assert.deepEqual(await new WorkspaceDisk(root).readState("one"), {
      chats: ["saved"],
    });
    assert.equal(await disk.readFile("two", "file"), null);
    await assert.rejects(disk.writeFile("one", "../escape", new Uint8Array()));
    await assert.rejects(disk.readState("../two"));
    await writeFile(join(root, "Accounts", "one", "workspace.json"), "{broken");
    await assert.rejects(disk.readState("one"));
    await disk.deleteFile("one", "file");
    assert.equal(await disk.readFile("one", "file"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
