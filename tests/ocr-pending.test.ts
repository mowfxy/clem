import { test } from "node:test";
import assert from "node:assert/strict";

// The desktop bridge, a canvas and an IndexedDB that never opens: no page reading is kept between calls here.
let reply: () => Promise<any> = async () => ({ texts: [] });
(globalThis as any).window = { mowrDesktop: { onChat: () => () => {}, invoke: async (r: any) => (r.action === "ocr" ? reply() : {}) } };
(globalThis as any).document = { createElement: () => ({ getContext: () => ({ fillRect() {} }), toBlob: (done: (b: Blob) => void) => done(new Blob([new Uint8Array([1])])) }) };
(globalThis as any).indexedDB = { open: () => { const r: any = { error: Error("no IndexedDB") }; queueMicrotask(() => r.onerror?.()); return r; } };
const { scannedText } = await import("../src/desktop/ocr.ts");
const page = { getViewport: () => ({ width: 600, height: 800 }), render: () => ({ promise: Promise.resolve() }), cleanup() {} };
const pdf = { getPage: async () => page };

test("a scanned page Windows failed to read stays pending instead of being kept as empty", async () => {
  reply = async () => ({ texts: ["Page one text", null] });
  const read = await scannedText(pdf, [1, 2], "file:1", Date.now() + 10_000);
  assert.equal(read.texts.get(1), "Page one text");
  assert.equal(read.texts.has(2), false);
  assert.deepEqual(read.pending, [2]);
});

test("no OCR language on the PC leaves every page pending", async () => {
  reply = async () => { throw Error("Windows has no OCR language installed"); };
  const read = await scannedText(pdf, [1, 2], "file:2", Date.now() + 10_000);
  assert.equal(read.texts.size, 0);
  assert.deepEqual(read.pending, [1, 2]);
});
