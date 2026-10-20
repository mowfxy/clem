import { test } from "node:test";
import assert from "node:assert/strict";
import { requestSchema } from "../desktop/contracts.ts";

// A stand-in for the preload bridge (desktop/preload.cjs): records each request and ends every chat at once.
const sent: any[] = [];
let listener: ((event: any) => void) | undefined;
(globalThis as any).window = {
  clemDesktop: {
    onChat: (l: (event: any) => void) => { listener = l; return () => { listener = undefined; }; },
    invoke: async (request: any) => { sent.push(request); if (request.action === "chat") queueMicrotask(() => listener?.({ id: request.id, type: "done" })); return {}; },
  },
};
const { desktopChat } = await import("../src/desktop/bridge.ts");

test("desktopChat hands the conversation's PDFs and their notes to the desktop app, within what a request takes", async () => {
  sent.length = 0;
  const pdfs = Array.from({ length: 25 }, (_, i) => ({ name: `Lecture ${i + 1}.pdf`, data: new Uint8Array([37, 80, 68, 70, i]) }));
  const pdfNotes = Array.from({ length: 50 }, (_, i) => `"Lecture ${i + 1}.pdf": attached whole as a PDF file.` + "x".repeat(i === 0 ? 3000 : 0));
  await desktopChat([{ role: "user", content: "Summarise the lectures" }], "chat:abc", new AbortController().signal, () => {}, { model: "claude:opus", pdfs, pdfNotes });
  const request = sent.find((r) => r.action === "chat");
  assert.ok(request, "a chat request was sent");
  assert.equal(request.pdfs.length, 20);
  assert.equal(request.pdfs[0].name, "Lecture 1.pdf");
  assert.ok(request.pdfs[0].data instanceof Uint8Array);
  assert.equal(request.pdfNotes.length, 40);
  assert.ok(request.pdfNotes.every((n: string) => n.length <= 2000));
  assert.equal(requestSchema.safeParse(request).success, true, "the desktop app's contract accepts the request");
});

test("desktopChat sends no PDF fields when there are none", async () => {
  sent.length = 0;
  await desktopChat([{ role: "user", content: "Hello" }], "chat:abc", new AbortController().signal, () => {}, { model: "codex:gpt", pdfs: [], pdfNotes: [] });
  const request = sent.find((r) => r.action === "chat");
  assert.equal("pdfs" in request, false);
  assert.equal("pdfNotes" in request, false);
  assert.equal(requestSchema.safeParse(request).success, true);
});
