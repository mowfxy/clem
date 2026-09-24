import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { diffIndex, relevant, FolderWatcher, type FolderEvent } from "../../desktop/folder-watch.ts";
import type { IndexedFile } from "../../desktop/folders.ts";

const file = (path: string, hash: string): IndexedFile => ({ path, hash, mtime: 0, size: 1, text: "" });

test("index diff reports content changes, not touches", () => {
  const delta = diffIndex([file("a.md", "1"), file("b.md", "2"), file("gone.md", "3")], [file("a.md", "1"), file("b.md", "9"), file("new.md", "4")]);
  assert.deepEqual(delta, { added: ["new.md"], changed: ["b.md"], removed: ["gone.md"] });
  assert.ok(relevant("notes/week1.md") && relevant("notes"));
  assert.ok(!relevant("node_modules/x.js") && !relevant(".git/HEAD") && !relevant("photo.png") && !relevant("secrets.txt"));
});

test("watcher debounces, reports outside changes and absorbs Mowr's own edits", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let disk = [file("a.md", "1")];
  const emitted: FolderEvent[] = [];
  const fake = new EventEmitter() as EventEmitter & { close(): void };
  let listener: (event: string, name: string | null) => void = () => {};
  fake.close = () => {};
  const watcher = new FolderWatcher(async () => disk, (e) => emitted.push(e), (_p, l) => { listener = l; return fake as never; });
  watcher.sync([{ id: "f", scope: "subject:bio", path: "C:/Notes/Bio" }]);
  await Promise.resolve();
  disk = [file("a.md", "2"), file("b.md", "3")];
  listener("change", "a.md"); listener("change", "b.md"); listener("change", "image.png");
  t.mock.timers.tick(1500);
  await watcher.check("f");
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], { folderId: "f", scope: "subject:bio", folder: "Bio", added: ["b.md"], changed: ["a.md"], removed: [] });
  disk = [file("a.md", "5"), file("b.md", "3")];
  watcher.absorb("f");
  await watcher.check("f");
  assert.equal(emitted.length, 1, "Mowr's own write is not announced");
  watcher.sync([]);
  assert.deepEqual(watcher.watching(), []);
});
