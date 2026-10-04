// Renders the Mowr announcement film ("Look closer"): a walk through an eyepiece, every plate painted
// procedurally in the browser, scored with a synthesised track, encoded to a 1080×1080 MP4 at 24 fps.
//   node scripts/eyepiece/render.mjs                    full film → ads/mowr-announcement.mp4
//   node scripts/eyepiece/render.mjs --stills 1,4.2     PNG stills → .work/eyepiece/stills
//   node scripts/eyepiece/render.mjs --plates           every baked plate → .work/eyepiece/plates
//   node scripts/eyepiece/render.mjs --preview          half-rate draft
//   node scripts/eyepiece/render.mjs --audio            score only → .work/eyepiece/score.wav
import { chromium } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { score } from "./score.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1] ?? ""; };
const has = (k) => process.argv.includes(k);
const FPS = 24;
const work = resolve(".work/eyepiece");
await mkdir(work, { recursive: true });

// Mowafy Serif is pinned in scripts/eyepiece/fonts (see SOURCE.md there); Mowafy Sans comes from the app.
const font = async (name, dir = "public/fonts") => "data:font/woff2;base64," + (await readFile(resolve(dir, name))).toString("base64");
const [serif, serifBold, sans] = await Promise.all([font("MowafySerif-Regular.woff2", "scripts/eyepiece/fonts"), font("MowafySerif-Bold.woff2", "scripts/eyepiece/fonts"), font("MowafySans-Regular.woff2")]);
const src = (await Promise.all(["lib.js", "plates.js", "plates2.js", "plates3.js", "plates4.js", "plates5.js", "shaders.js", "page.js", "stage.js"].map((f) => readFile(resolve("scripts/eyepiece", f), "utf8")))).join("\n;\n");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:MowafySerif;src:url(${serif})}
@font-face{font-family:MowafySerif;font-weight:700;src:url(${serifBold})}
@font-face{font-family:MowafySans;src:url(${sans})}
*{margin:0}html,body{width:1080px;height:1080px;overflow:hidden;background:#000}canvas{display:block}
</style></head><body><span style="font-family:MowafySerif;position:absolute;opacity:0">a</span><span style="font-family:'Palace Script MT';position:absolute;opacity:0">a</span><span style="font-family:'Baskerville Old Face';position:absolute;opacity:0">a</span>
<script>${src.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
const page_ = join(work, "stage.html");
await writeFile(page_, html);

async function openStage() {
  const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("stage:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning" || m.text().startsWith("[stage]")) console.log(m.text()); });
  await page.goto(pathToFileURL(page_).href);
  await page.evaluate(() => document.fonts.ready);
  const t0 = Date.now();
  await page.evaluate(() => window.STAGE.build());
  console.log(`plates built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { browser, page };
}

if (has("--audio")) {
  const { browser, page } = await openStage();
  const { duration, cues } = await page.evaluate(() => ({ duration: window.STAGE.duration, cues: window.STAGE.cues }));
  await browser.close();
  await score({ duration, cues, file: join(work, "score.wav") });
  console.log("score:", join(work, "score.wav"));
  process.exit(0);
}

const { browser, page } = await openStage();
const duration = await page.evaluate(() => window.STAGE.duration);
const cues = await page.evaluate(() => window.STAGE.cues);

if (has("--plates")) {
  const dir = join(work, "plates"); await mkdir(dir, { recursive: true });
  const names = await page.evaluate(() => Object.keys(window.STAGE.plates));
  for (const n of names) {
    const data = await page.evaluate((n) => { const c = window.STAGE.plates[n]; const s = document.createElement("canvas"), k = Math.min(1, 1400 / Math.max(c.width, c.height)); s.width = c.width * k; s.height = c.height * k; s.getContext("2d").drawImage(c, 0, 0, s.width, s.height); return s.toDataURL("image/jpeg", 0.9); }, n);
    await writeFile(join(dir, n + ".jpg"), Buffer.from(data.split(",")[1], "base64"));
  }
  console.log("plates:", dir);
} else if (arg("--stills") !== null) {
  const dir = join(work, "stills"); await mkdir(dir, { recursive: true });
  for (const t of arg("--stills").split(",").map(Number)) {
    await page.evaluate((t) => window.STAGE.renderAt(t), t);
    await page.screenshot({ path: join(dir, `t${t.toFixed(2)}.png`) });
  }
  console.log("stills:", dir);
} else {
  const preview = has("--preview");
  const raw = join(work, "score.wav"), audio = join(work, "score-mastered.wav");
  await score({ duration, cues, file: raw });
  // two-pass loudness normalisation to -14 LUFS, true peak -1 dB, linear (no pumping)
  const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-af", "loudnorm=I=-14:TP=-1:LRA=20:print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const m = JSON.parse((probe.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `loudnorm=I=-14:TP=-1:LRA=20:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`, "-ar", "48000", audio]);
  const out = resolve("ads", preview ? "mowr-announcement-preview.mp4" : "mowr-announcement.mp4");
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", audio,
    "-c:v", "libx264", "-preset", preview ? "veryfast" : "slow", "-crf", preview ? "24" : "19", "-maxrate", "12M", "-bufsize", "24M", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "320k", "-shortest", out], { stdio: ["pipe", "inherit", "inherit"] });
  const total = Math.round(duration * FPS), step = preview ? 2 : 1, started = Date.now();
  for (let i = 0; i < total; i += step) {
    await page.evaluate((t) => window.STAGE.renderAt(t), i / FPS);
    const jpg = await page.screenshot({ type: "jpeg", quality: 96 });
    for (let r = 0; r < step; r++) if (!ff.stdin.write(jpg)) await new Promise((res) => ff.stdin.once("drain", res));
    if (i % 96 === 0) console.log(`frame ${i}/${total} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on("close", (code) => (code ? rej(Error("ffmpeg failed")) : res())));
  console.log("film:", out);
}
await browser.close();
