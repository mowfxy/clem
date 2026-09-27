import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, undoChange, locate } from "../../desktop/folder-edits.ts";
import type { Folder } from "../../desktop/folders.ts";

async function workspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "mowr-edits-")));
  const root = join(base, "project"), other = join(base, "other");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(other, { recursive: true });
  await writeFile(join(root, "src", "app.py"), "x = 1\ny = 2\n");
  await writeFile(join(other, "secret.txt"), "outside");
  const folders: Folder[] = [{ id: "11111111-1111-4111-8111-111111111111", scope: "chat:a", path: root }];
  return { base, root, other, folders };
}

test("approved edits change only files inside the linked folder and can be undone", async () => {
  const { base, root, folders } = await workspace();
  try {
    const change = await applyChange(folders, "chat:a", { path: "src/app.py", find: "y = 2", replace: "y = 3", summary: "Bump y" });
    assert.equal(await readFile(join(root, "src", "app.py"), "utf8"), "x = 1\ny = 3\n");
    assert.deepEqual([change.added, change.removed], [1, 1]);
    await undoChange(folders, change);
    assert.equal(await readFile(join(root, "src", "app.py"), "utf8"), "x = 1\ny = 2\n");
    await assert.rejects(() => undoChange(folders, { ...change, undone: true }), /already undone/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("paths cannot escape the folder, reach secrets or unsupported files", async () => {
  const { base, folders } = await workspace();
  try {
    await assert.rejects(() => locate(folders, "../other/secret.txt"), /outside/);
    await assert.rejects(() => locate(folders, "../other/notes.txt"), /outside/);
    assert.ok((await locate(folders, "./src/app.py")).exists);
    await assert.rejects(() => locate(folders, "C:\\Windows\\win.ini"), /inside a linked folder/);
    await assert.rejects(() => locate(folders, "src/.env"), /outside|only changes/);
    await assert.rejects(() => locate(folders, "src/password.txt"), /outside/);
    await assert.rejects(() => locate(folders, "src/tool.exe"), /only changes text/);
    await assert.rejects(() => locate(folders, "src/missing.py"), /not in a linked folder/);
    assert.ok((await locate(folders, "project/src/app.py")).exists, "a leading folder name is accepted");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("undo refuses to overwrite newer work and new files are removed on undo", async () => {
  const { base, root, folders } = await workspace();
  try {
    const change = await applyChange(folders, "chat:a", { path: "src/app.py", content: "print('hi')\n" });
    await writeFile(join(root, "src", "app.py"), "someone else edited this\n");
    await assert.rejects(() => undoChange(folders, change), /changed after this edit/);
    const created = await applyChange(folders, "chat:a", { path: "notes/todo.md", content: "- one\n" });
    assert.equal(created.before, null);
    await undoChange(folders, created);
    assert.equal(existsSync(join(root, "notes", "todo.md")), false);
    await assert.rejects(() => applyChange(folders, "chat:a", { path: "src/app.py", find: "not there", replace: "x" }), /no longer in the file/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("a new file cannot be created through a linked subfolder that points outside", async () => {
  const { base, root, other, folders } = await workspace();
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(other, join(root, "escape"), "junction");
    await assert.rejects(() => applyChange(folders, "chat:a", { path: "escape/new/notes.txt", content: "leak" }), /not in a linked folder/);
    assert.equal(existsSync(join(other, "new")), false);
    await applyChange(folders, "chat:a", { path: "src/new/notes.txt", content: "ok" });
    assert.equal(await readFile(join(root, "src", "new", "notes.txt"), "utf8"), "ok");
  } finally { await rm(base, { recursive: true, force: true }); }
});
