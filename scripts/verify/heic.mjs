// Converts a real HEIC photo with the app's own worker (src/desktop/heic-worker.ts, as built into dist/) in Electron,
// served from a mowr:// page with the app's real Content-Security-Policy (desktop/csp.ts), so a policy that blocks
// WebAssembly or the .wasm fetch shows up here. Run `npx vite build` first.
// Usage: node scripts/verify/heic.mjs <photo.heic> [out.jpg]
import { build } from "esbuild";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const photo = resolve(process.argv[2] || "");
const jpeg = resolve(process.argv[3] || join(tmpdir(), "mowr-heic-out.jpg"));
const out = join(tmpdir(), "mowr-verify-heic");
await mkdir(out, { recursive: true });
await build({ entryPoints: ["desktop/csp.ts"], outfile: join(out, "csp.cjs"), bundle: true, platform: "node", format: "cjs", logLevel: "warning" });
const worker = (await readdir("dist/assets")).find((f) => /^heic-worker-.+\.js$/.test(f));
if (!worker) throw Error("dist/assets has no heic-worker: run `npx vite build` first.");
await writeFile(join(out, "main.cjs"), `
const { app, BrowserWindow, protocol, net } = require("electron");
const { pathToFileURL } = require("url");
const { join, resolve } = require("path");
const fs = require("fs");
const { contentSecurityPolicy } = require(${JSON.stringify(join(out, "csp.cjs"))});
protocol.registerSchemesAsPrivileged([{ scheme: "mowr", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(async () => {
  const dist = resolve(${JSON.stringify(resolve("dist"))});
  protocol.handle("mowr", async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("<!doctype html><meta charset=utf-8>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": contentSecurityPolicy("/") } });
    const response = await net.fetch(pathToFileURL(join(dist, "." + decodeURIComponent(url.pathname))).toString());
    if (url.pathname.endsWith(".wasm")) response.headers.set("Content-Type", "application/wasm");
    response.headers.set("Content-Security-Policy", contentSecurityPolicy(url.pathname));
    return response;
  });
  const w = new BrowserWindow({ show: false });
  await w.loadURL("mowr://app/");
  const bytes = [...fs.readFileSync(${JSON.stringify(photo)})];
  const result = await w.webContents.executeJavaScript(\`new Promise(async (resolve) => {
    const worker = new Worker("mowr://app/assets/${worker}", { type: "module" });
    worker.onerror = (e) => resolve({ error: "worker error: " + (e.message || "failed to start") });
    worker.onmessage = async (e) => resolve(e.data.error ? { error: e.data.error } : { width: e.data.width, height: e.data.height, bytes: [...new Uint8Array(await e.data.jpeg.arrayBuffer())], type: e.data.jpeg.type });
    const t = Date.now();
    worker.postMessage({ id: 1, bytes: new Uint8Array(\${JSON.stringify(bytes)}).buffer, quality: 0.92 });
    setTimeout(() => resolve({ error: "timed out" }), 60000);
  })\`);
  if (result.error) { console.log("FAILED:", result.error); app.exit(1); return; }
  fs.writeFileSync(${JSON.stringify(jpeg)}, Buffer.from(result.bytes));
  console.log("converted:", result.width + "x" + result.height, result.type, Math.round(result.bytes.length / 1024) + " KB ->", ${JSON.stringify(jpeg)});
  // A file that is not a HEIC photo must fail with a message, not hang.
  const bad = await w.webContents.executeJavaScript(\`new Promise((resolve) => {
    const worker = new Worker("mowr://app/assets/${worker}", { type: "module" });
    worker.onmessage = (e) => resolve(e.data.error || "no error");
    worker.postMessage({ id: 2, bytes: new TextEncoder().encode("not a photo at all").buffer, quality: 0.9 });
    setTimeout(() => resolve("timed out"), 30000);
  })\`);
  console.log("garbage input ->", bad);
  app.quit();
});`);
const electron = createRequire(import.meta.url)("electron");
process.exit(spawnSync(electron, [join(out, "main.cjs")], { stdio: "inherit" }).status ?? 1);
