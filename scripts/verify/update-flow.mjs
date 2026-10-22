// End to end on the packaged build (release/win-unpacked): a copy of it checks a local release feed, refuses a
// download whose SHA-512 doesn't match latest.yml, then downloads and verifies the real installer until it is ready to
// install. It stops there: installing would replace (and close) the Clem installed on this PC.
// Run after npm run desktop:installer.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const installer = `Clem-Setup-${pkg.version}.exe`, release = process.env.CLEM_RELEASE_DIR || "release";
const latest = await readFile(join(release, "latest.yml"), "utf8");
assert.match(latest, new RegExp(`version: ${pkg.version.replace(/\./g, "\.")}`), "latest.yml is for this version");
const sha512 = latest.match(/^sha512: (.+)$/m)[1], size = (await stat(join(release, installer))).size;
const feed = (hash) => `version: 0.3.0-preview.999\nfiles:\n  - url: ${installer}\n    sha512: ${hash}\n    size: ${size}\npath: ${installer}\nsha512: ${hash}\nreleaseDate: '${new Date().toISOString()}'\n`;
let served = feed("A".repeat(86) + "==");
const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1));
  if (name === "latest.yml") { res.writeHead(200, { "content-type": "text/yaml" }); return res.end(served); }
  if (name === installer) { res.writeHead(200, { "content-length": size, "content-type": "application/octet-stream" }); return createReadStream(join(release, installer)).pipe(res); }
  res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}`;

const copy = await mkdtemp(join(tmpdir(), "clem-update-app-")), userData = await mkdtemp(join(tmpdir(), "clem-update-data-"));
await cp(join(release, "win-unpacked"), copy, { recursive: true });
const config = await readFile(join(copy, "resources", "app-update.yml"), "utf8");
assert.match(config, /url: https:\/\/github\.com\/mowfxy\/clem-releases\/releases\/latest\/download/, "the installed app reads the GitHub release feed");
const cacheDir = config.match(/updaterCacheDirName: (.+)/)[1].trim();
await writeFile(join(copy, "resources", "app-update.yml"), config.replace(/url: .+/, `url: ${url}`));

const app = await electron.launch({ executablePath: join(copy, "Clem.exe"), args: ["--user-data-dir=" + userData], timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.clemDesktop?.update === "function");
  const state = () => page.evaluate(() => window.clemDesktop.update());
  const until = async (test, ms = 240000) => { const end = Date.now() + ms; let s; while (Date.now() < end) { s = await state(); if (test(s)) return s; await page.waitForTimeout(500); } throw Error("Timed out at " + JSON.stringify(s)); };
  const first = await state();
  assert.equal(first.supported, true);
  assert.equal(first.version, pkg.version);
  assert.equal(first.automatic, true, "automatic updates are on by default");
  // A download that doesn't match the release is discarded.
  await page.evaluate(() => window.clemDesktop.update({ op: "check" }));
  const bad = await until((s) => s.phase === "error");
  assert.match(bad.error, /didn’t match the release/, JSON.stringify(bad));
  console.log("Rejected a mismatched download:", bad.error);
  // The real one downloads (automatic) and waits, verified, to install.
  served = feed(sha512);
  await page.evaluate(() => window.clemDesktop.update({ op: "check" }));
  const seen = new Set();
  const ready = await until((s) => { seen.add(s.phase); return s.phase === "ready"; });
  assert.equal(ready.next, "0.3.0-preview.999");
  console.log("Downloaded and verified:", JSON.stringify(ready), "phases seen:", [...seen].join(", "));
  // Switching automatic updates off and on is kept. It ends off: quitting with an update waiting would otherwise
  // install it over the Clem on this PC.
  assert.equal((await page.evaluate(() => window.clemDesktop.update({ automatic: true }))).automatic, true);
  assert.equal((await page.evaluate(() => window.clemDesktop.update({ automatic: false }))).automatic, false);
} finally {
  await app.firstWindow().then((page) => page.evaluate(() => window.clemDesktop.update({ automatic: false }))).catch(() => {});
  await app.close().catch(() => {});
  server.close();
  await rm(copy, { recursive: true, force: true }).catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
  // The copy's pending download must not linger where the installed Clem keeps its updates. The installer.exe beside it
  // is the installed Clem's own (the base for differential downloads) and stays.
  await rm(join(process.env.LOCALAPPDATA, cacheDir, "pending"), { recursive: true, force: true }).catch(() => {});
}
console.log("Update flow on the packaged build: ok");
