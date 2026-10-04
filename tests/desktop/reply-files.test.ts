import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { ReplyFiles, photoFit, REPLY_LIMITS } from "../../desktop/reply-files.ts";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const png = (w: number, h: number) => {
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const chunk = (type: string, data: Buffer) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); return out; };
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.alloc(8))), chunk("IEND", Buffer.alloc(0))]));
};
const make = async (action: string, spec: any) => {
  const name = action === "file" ? spec.name : action === "image" ? "Figure.png" : (spec.title || "Doc") + "." + action;
  const bytes = action === "image" ? png(400, 300) : new TextEncoder().encode(JSON.stringify(spec));
  return { bytes, name, type: action === "image" ? "image/png" : "application/pdf", info: { sections: spec.sections?.length } };
};

test("a reply makes several files, revises one in place by id, and keeps their order", async () => {
  const files = new ReplyFiles(make);
  const a = await files.handle({ action: "pdf", title: "Notes", sections: [{ heading: "A", text: "x" }] });
  const b = await files.handle({ action: "docx", title: "Essay", sections: [] });
  const fig = await files.handle({ action: "image", name: "Figure", svg: "<svg/>" });
  assert.deepEqual([a.id, b.id, fig.id], ["f1", "f2", "f3"]);
  // A corrected draft replaces the file; it does not become a fourth.
  const fixed = await files.handle({ action: "pdf", revise: "f1", title: "Notes", sections: [{ heading: "A", text: "better" }] });
  assert.equal(fixed.revised, true);
  assert.equal(files.size, 3);
  // Appending continues the earlier content.
  await files.handle({ action: "pdf", revise: "f1", append: true, sections: [{ heading: "B", text: "more" }] });
  const list = files.list();
  assert.deepEqual(list.map((f) => f.name), ["Notes.pdf", "Essay.docx", "Figure.png"]);
  assert.match(new TextDecoder().decode(list[0].bytes), /better[\s\S]*more/);
  assert.deepEqual(list.map((f) => f.photo), [false, false, true]);
});

test("a reply refuses what Telegram would not carry, with a message the model can act on", async () => {
  const files = new ReplyFiles(make);
  await assert.rejects(files.handle({ action: "pdf", revise: "f9", title: "x" }), /No file with id "f9"/);
  await assert.rejects(files.handle({ action: "pdf", append: true, sections: [{}] }), /needs "revise"/);
  await files.handle({ action: "pdf", title: "One", sections: [] });
  await assert.rejects(files.handle({ action: "docx", revise: "f1", title: "One" }), /revise it with the action that made it/);
  for (let i = 1; i < REPLY_LIMITS.files; i++) await files.handle({ action: "file", name: `n${i}.txt`, content: "x" });
  await assert.rejects(files.handle({ action: "file", name: "extra.txt", content: "x" }), /at most 10 files/);
  // Revising an existing file is still allowed at the limit.
  await files.handle({ action: "pdf", revise: "f1", title: "One", sections: [] });
  const big = new ReplyFiles(async () => ({ bytes: new Uint8Array(REPLY_LIMITS.file + 1), name: "big.pdf", type: "application/pdf" }));
  await assert.rejects(big.handle({ action: "pdf", title: "big" }), /Telegram replies carry files up to 20 MB/);
  const total = new ReplyFiles(async () => ({ bytes: new Uint8Array(REPLY_LIMITS.file), name: "p" + Math.random() + ".pdf", type: "application/pdf" }));
  await total.handle({ action: "pdf" }); await total.handle({ action: "pdf" }); await total.handle({ action: "pdf" });
  await assert.rejects(total.handle({ action: "pdf" }), /total over 60 MB/);
  await assert.rejects(new ReplyFiles(make).handle({ action: "pdf", title: "x" }, () => true), /cancelled/);
});

test("only pictures Telegram accepts as photos are sent as photos", () => {
  assert.equal(photoFit("image/png", png(1200, 800)), true);
  assert.equal(photoFit("image/png", png(9000, 1500)), false, "width + height over 10000");
  assert.equal(photoFit("image/png", png(4000, 100)), false, "ratio over 20");
  assert.equal(photoFit("image/svg+xml", new TextEncoder().encode("<svg/>")), false);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 2, 0x58, 3, 0x20, 3, 1, 0x22, 0]);
  assert.equal(photoFit("image/jpeg", jpeg), true);
});

test("the Telegram service sends the text, then every file in order (photos as photos), and names any that fail", async () => {
  const sent: string[] = [];
  const real = globalThis.fetch;
  let polled = false;
  globalThis.fetch = (async (url: string, init: any) => {
    const method = String(url).split("/").pop()!;
    if (method === "getUpdates") {
      if (!polled) { polled = true; return Response.json({ ok: true, result: [{ update_id: 1, message: { chat: { id: 2, type: "private" }, from: { id: 1 }, text: "make files" } }] }); }
      await new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
    }
    if (method === "sendMessage") sent.push("text:" + JSON.parse(init.body).text.slice(0, 80));
    else if (method === "sendPhoto") { const name = (init.body.get("photo") as File).name; if (name === "bad.png") return new Response("no", { status: 400 }); sent.push("photo:" + name); }
    else if (method === "sendDocument") { const name = (init.body.get("document") as File).name; if (name === "lost.pdf") return new Response("no", { status: 500 }); sent.push("document:" + name); }
    return Response.json({ ok: true, result: {} });
  }) as any;
  // service.ts uses TypeScript constructor shorthand that Node cannot strip, so it is bundled first.
  const out = "desktop-dist/telegram-service-test.mjs";
  await build({ entryPoints: ["desktop/messaging/service.ts"], outfile: out, bundle: true, platform: "node", format: "esm" });
  const { TelegramService } = await import(pathToFileURL(out).href);
  let config: any = { token: "t", offset: 0, routes: [{ chatId: 2, senderId: 1, scope: "project:a" }], enabled: true, seen: [] };
  const vault: any = { read: async () => config, write: async (_: string, value: any) => { config = value; } };
  const bytes = new Uint8Array([1]);
  const service = new TelegramService(vault, async () => ({ text: "Here you go", documents: [
    { name: "a.pdf", mime: "application/pdf", bytes, photo: false }, { name: "fig.png", mime: "image/png", bytes, photo: true },
    { name: "bad.png", mime: "image/png", bytes, photo: true }, { name: "lost.pdf", mime: "application/pdf", bytes, photo: false }, { name: "b.docx", mime: "application/msword", bytes, photo: false } ] }));
  try {
    service.start("me");
    for (let i = 0; i < 100 && sent.length < 6; i++) await new Promise((done) => setTimeout(done, 20));
  } finally { service.stop(); globalThis.fetch = real; }
  assert.deepEqual(sent, ["text:Here you go", "document:a.pdf", "photo:fig.png", "document:bad.png", "document:b.docx", "text:This file could not be sent: lost.pdf. Ask again to get it."]);
});
