import test from "node:test";
import assert from "node:assert/strict";
import { changes, syncable, listFolder } from "../src/space/drive-sync.ts";

test("drive sync picks up new and changed files only", () => {
  const known = { a: { fileId: "f-a", modified: "2026-09-01" }, b: { fileId: "f-b", modified: "2026-09-02" } };
  const result = changes([
    { id: "a", name: "Lecture 1.pdf", mimeType: "application/pdf", modifiedTime: "2026-09-01" },
    { id: "b", name: "Lecture 2.pdf", mimeType: "application/pdf", modifiedTime: "2026-09-20" },
    { id: "c", name: "Lecture 3.pdf", mimeType: "application/pdf", modifiedTime: "2026-09-21" },
  ], known);
  assert.deepEqual(result.added.map((e) => e.id), ["c"]);
  assert.deepEqual(result.updated.map((e) => e.id), ["b"]);
});

test("drive sync reads documents, not folders, shortcuts or huge files", () => {
  assert.ok(syncable({ id: "1", name: "Notes", mimeType: "application/vnd.google-apps.document" }));
  assert.ok(syncable({ id: "2", name: "slides.pptx", mimeType: "application/octet-stream" }));
  assert.ok(!syncable({ id: "3", name: "Week 1", mimeType: "application/vnd.google-apps.folder" }));
  assert.ok(!syncable({ id: "4", name: "video.mp4", mimeType: "video/mp4" }));
  assert.ok(!syncable({ id: "5", name: "big.pdf", mimeType: "application/pdf", size: "40000000" }));
});

test("drive sync walks subfolders", async () => {
  const tree: Record<string, { id: string; name: string; mimeType: string }[]> = {
    root: [{ id: "w1", name: "Week 1", mimeType: "application/vnd.google-apps.folder" }, { id: "p1", name: "Syllabus.pdf", mimeType: "application/pdf" }],
    w1: [{ id: "p2", name: "Lecture 1.pdf", mimeType: "application/pdf" }],
  };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify({ files: tree[new URL(url, "http://x").searchParams.get("folder")!] || [] }))) as typeof fetch;
  try { assert.deepEqual((await listFolder("root")).map((f) => f.id).sort(), ["p1", "p2"]); }
  finally { globalThis.fetch = original; }
});
