import test from "node:test";
import assert from "node:assert/strict";
import { heicBytes, isHeic, looksHeic } from "../../src/desktop/heic.ts";
import { contentSecurityPolicy } from "../../desktop/csp.ts";

const box = (brands: string) => new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftyp" + brands.padEnd(16, "\0"))]);

test("HEIC photos are recognised by name, type or the brand in their first bytes", async () => {
  assert.ok(isHeic({ name: "IMG_0042.HEIC" }) && isHeic({ name: "x.heif" }) && isHeic({ name: "x", type: "image/heic" }) && isHeic({ name: "x", type: "image/heif-sequence" }));
  assert.ok(!isHeic({ name: "photo.jpg", type: "image/jpeg" }) && !isHeic({ name: "heic.txt" }));
  assert.ok(heicBytes(box("heic")) && heicBytes(box("mif1heic")) && heicBytes(box("heix")));
  assert.ok(!heicBytes(box("isom")) && !heicBytes(box("avif")) && !heicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])));
  // Shared without an extension or type: the bytes decide. A PDF or text file is never read as one.
  assert.ok(await looksHeic(new Blob([box("heic")], { type: "application/octet-stream" })));
  assert.ok(await looksHeic(new Blob([box("heic")])));
  assert.ok(!(await looksHeic(new Blob([box("heic")], { type: "application/pdf" }))));
  assert.ok(!(await looksHeic(new Blob(["plain text"], { type: "text/plain" }))));
});

test("only the photo converter's own worker may compile WebAssembly, and nothing else is loosened", () => {
  const heic = contentSecurityPolicy("/assets/heic-worker-3vFx_qqu.js");
  assert.match(heic, /^default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'$/);
  assert.doesNotMatch(heic, /unsafe-eval'(?!;)/);
  assert.doesNotMatch(contentSecurityPolicy("/assets/App-DKgRH1DI.js"), /wasm-unsafe-eval/);
  assert.doesNotMatch(contentSecurityPolicy("/assets/heic-worker-x.js.evil/../App.js"), /wasm-unsafe-eval/);
  assert.match(contentSecurityPolicy("/assets/run-worker-abc.js"), /'unsafe-eval'/);
});
