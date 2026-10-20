import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, undoChange, locate, sha } from "../../desktop/folder-edits.ts";
import type { Folder } from "../../desktop/folders.ts";

async function workspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "clem-edits-")));
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

test("Windows line breaks: a find written with \n matches a \r\n file, and new text keeps the file's line breaks and BOM", async () => {
  const { base, root, folders } = await workspace();
  try {
    const file = join(root, "src", "win.py");
    await writeFile(file, "\uFEFFa = 1\r\nb = 2\r\nc = 3\r\n");
    await applyChange(folders, "chat:a", { path: "src/win.py", find: "a = 1\nb = 2", replace: "a = 1\nb = 20\nb2 = 21" });
    assert.equal(await readFile(file, "utf8"), "\uFEFFa = 1\r\nb = 20\r\nb2 = 21\r\nc = 3\r\n");
    await applyChange(folders, "chat:a", { path: "src/win.py", content: "x = 1\ny = 2\n" });
    assert.equal(await readFile(file, "utf8"), "\uFEFFx = 1\r\ny = 2\r\n");
    // A plain \n file stays as it is.
    await applyChange(folders, "chat:a", { path: "src/app.py", find: "x = 1\ny = 2", replace: "x = 1\ny = 5" });
    assert.equal(await readFile(join(root, "src", "app.py"), "utf8"), "x = 1\ny = 5\n");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("an approval applies only to the file as it was shown: a change made since is never overwritten", async () => {
  const { base, root, folders } = await workspace();
  try {
    const shown = sha("x = 1\ny = 2\n");
    await writeFile(join(root, "src", "app.py"), "x = 1\ny = 2\nz = 3\n");
    await assert.rejects(() => applyChange(folders, "chat:a", { path: "src/app.py", content: "replaced\n", base: shown }), /changed since this change was shown/);
    assert.equal(await readFile(join(root, "src", "app.py"), "utf8"), "x = 1\ny = 2\nz = 3\n");
    await applyChange(folders, "chat:a", { path: "src/app.py", content: "replaced\n", base: sha("x = 1\ny = 2\nz = 3\n") });
    assert.equal(await readFile(join(root, "src", "app.py"), "utf8"), "replaced\n");
    // A new file was shown as new: if one appeared meanwhile, it is not overwritten.
    await writeFile(join(root, "src", "late.md"), "mine\n");
    await assert.rejects(() => applyChange(folders, "chat:a", { path: "src/late.md", content: "new\n", base: null }), /changed since/);
    await applyChange(folders, "chat:a", { path: "src/fresh.md", content: "new\n", base: null });
    assert.equal(await readFile(join(root, "src", "fresh.md"), "utf8"), "new\n");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("a subfolder named like the linked folder is reached as written; the folder's own name is still accepted", async () => {
  const { base, root, folders } = await workspace();
  try {
    // The linked folder is "project"; it holds project/notes.md and its own notes.md.
    await mkdir(join(root, "project"), { recursive: true });
    await writeFile(join(root, "project", "notes.md"), "inner\n");
    await writeFile(join(root, "notes.md"), "outer\n");
    assert.equal((await locate(folders, "project/notes.md")).absolute, join(root, "project", "notes.md"));
    assert.equal((await locate(folders, "notes.md")).absolute, join(root, "notes.md"));
    // Without such a subfolder, a leading folder name means the folder itself, for reading and for new files.
    assert.equal((await locate(folders, "project/src/app.py")).absolute, join(root, "src", "app.py"));
    await rm(join(root, "project"), { recursive: true });
    const made = await locate(folders, "project/docs/new.md", true);
    assert.equal(made.absolute, join(root, "docs", "new.md"));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("files the folder's .gitignore or .clemignore leave out cannot be read or changed", async () => {
  const { base, root, folders } = await workspace();
  try {
    await writeFile(join(root, ".clemignore"), "private/\n*.log.txt\n");
    await mkdir(join(root, "src", "private"), { recursive: true });
    await writeFile(join(root, "src", "private", "diary.md"), "keep out\n");
    await writeFile(join(root, "src", ".gitignore"), "generated.json\n");
    await writeFile(join(root, "src", "generated.json"), "{}");
    await writeFile(join(root, "run.log.txt"), "log");
    for (const path of ["src/private/diary.md", "src/generated.json", "run.log.txt"]) await assert.rejects(() => locate(folders, path), /not in a linked folder/, path);
    await assert.rejects(() => applyChange(folders, "chat:a", { path: "src/private/new.md", content: "x" }), /not in a linked folder/);
    assert.ok((await locate(folders, "src/app.py")).exists);
  } finally { await rm(base, { recursive: true, force: true }); }
});
