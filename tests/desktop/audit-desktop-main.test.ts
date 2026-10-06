import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locate } from "../../desktop/folder-edits.ts";
import type { Folder } from "../../desktop/folders.ts";

test("a colon in a path segment (an NTFS alternate data stream) is refused", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "mowr-ads-")));
  try {
    await mkdir(join(base, "src"), { recursive: true });
    await writeFile(join(base, "src", "a.txt"), "hello");
    const folders: Folder[] = [{ id: "11111111-1111-4111-8111-111111111111", scope: "chat:a", path: base }];
    await assert.rejects(() => locate(folders, "src/a.txt:hidden.txt", true), /outside/);
    assert.ok((await locate(folders, "src/a.txt")).exists);
  } finally { await rm(base, { recursive: true, force: true }); }
});
