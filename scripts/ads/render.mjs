// Renders a short ad: composes every frame in a browser (stage.js), scores it with the film's
// synthesised track and encodes a 1080p MP4 to ads/.   node scripts/ads/render.mjs <ad> [--preview]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { score } from "../film/score.mjs";
import { ADS } from "./ads.mjs";

const ad = process.argv[2], spec = ADS[ad], preview = process.argv.includes("--preview"), live = false;
if (!spec) throw Error("Usage: node scripts/ads/render.mjs <" + Object.keys(ADS).join("|") + "> [--preview]");
const dir = resolve(".work/ads", ad);
const FPS = 30;
const font = async (name) => "data:font/woff2;base64," + (await readFile(resolve("public/fonts", name))).toString("base64");
const [serif, sans, medium] = await Promise.all([font("SoftInkSerif-Book.woff2"), font("MowafySansText-Regular.woff2"), font("MowafySansText-Medium.woff2")]);
const log = JSON.parse(await readFile(join(dir, "log.json"), "utf8"));

const css = `
@font-face{font-family:MowrSerif;src:url(${serif})}
@font-face{font-family:MowrSans;src:url(${sans})}
@font-face{font-family:MowrSans;font-weight:500;src:url(${medium})}
*{box-sizing:border-box;margin:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#f3eee3;font-family:MowrSans;-webkit-font-smoothing:antialiased}
#stage{position:relative;width:1920px;height:1080px;overflow:hidden}
.bg{position:absolute;inset:0;background:radial-gradient(1400px 900px at 50% 38%,#fbf8f1 0%,#f3eee3 55%,#e9e2d3 100%)}
.app{position:absolute;left:0;top:0;width:${log.view.width}px;height:${log.view.height}px;transform-origin:0 0;overflow:hidden;background:#141414;will-change:transform}
.app img{display:block;width:100%;height:100%}
.fx{position:absolute;inset:0;pointer-events:none}
.cursor{position:absolute;left:0;top:0;width:44px;height:44px;transform-origin:9px 5px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
.cursor i{position:absolute;left:-14px;top:-18px;width:46px;height:46px;border-radius:50%;border:3px solid #f0c35b;opacity:0}
.ghost{position:absolute;left:0;top:0;display:flex;align-items:center;gap:14px;padding:14px 20px 14px 14px;border-radius:18px;background:linear-gradient(135deg,#27305a,#1d1f33);border:1px solid #4a5590;box-shadow:0 30px 60px -12px rgba(10,14,40,.6);color:#f4efe4;font:500 22px MowrSans;opacity:0;transform-origin:0 0;white-space:nowrap}
.ghost .gi{width:46px;height:46px;border-radius:12px;background:#f4efe4 url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 140 140" fill="none" stroke="#16224a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path transform="translate(-2.51 2.11)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(-1.88 1.58)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(-1.25 1.05)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(-0.63 0.53)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(0.00 0.00)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(0.63 -0.53)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(1.25 -1.05)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(1.88 -1.58)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/><path transform="translate(2.51 -2.11)" d="M20 64 L36 32 L52 66 L68 32 L80 56"/></svg>')}") center/34px no-repeat}
#cards{position:absolute;inset:0;transform-origin:50% 50%}
.card{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:radial-gradient(1400px 900px at 50% 38%,#fbf8f1 0%,#f3eee3 55%,#e9e2d3 100%);color:#16224a;transform-origin:50% 50%}
.card.on{display:flex}
.line{font:400 108px/1.12 MowrSerif;letter-spacing:-2.9px;text-align:center;white-space:nowrap}
.line .w,.line .word{display:inline-block}
.line.big{font-size:132px;letter-spacing:-3.8px}
.line .w{position:relative}
.l2{margin-top:6px}
.swap{display:inline-grid;vertical-align:baseline;justify-items:center;align-items:center}
.swap>*{grid-area:1/1}
.chip{display:inline-flex;align-items:center;gap:14px;padding:12px 30px 12px 18px;border-radius:24px;font:500 52px/1 MowrSans;letter-spacing:-1px;opacity:0;box-shadow:0 14px 40px -14px rgba(22,34,74,.35),inset 0 0 0 1.5px rgba(22,34,74,.08)}
.chip .ci{display:grid;place-items:center;width:62px;height:62px;border-radius:16px}
.chip .ci svg{width:34px;height:34px}
.c-notes{background:#e6edff;color:#244fc2}.c-notes .ci{background:#fff;color:#2d5bd6}
.c-pdf{background:#ffe3dc;color:#b73b2a}.c-pdf .ci{background:#fff;color:#d9473e}
.c-cards{background:#fff0d2;color:#9a6512}.c-cards .ci{background:#fff;color:#c98a1c}
.accent{position:relative;color:#d9473e}.accent2{color:#2f7d5b}
.ul{position:absolute;left:0;right:0;bottom:-6px;width:100%;height:26px;stroke-dasharray:1}
.sub{font:400 36px MowrSans;color:#5a607a;letter-spacing:-.3px}
.type-line{position:relative;font:400 104px/1.15 MowrSerif;letter-spacing:-3px;color:#16224a;height:128px;display:flex;align-items:center}
.typed.caret::after{content:"";display:inline-block;width:5px;height:92px;margin-left:6px;vertical-align:-10px;background:#16224a}
.tag{position:absolute;top:-8px;padding:5px 12px;border-radius:8px 8px 8px 2px;font:500 22px MowrSans;color:#fff;opacity:0;white-space:nowrap}
.tag-mowr{background:#d9473e}.tag-you{background:#2d5bd6}
.endmark{display:flex;align-items:center;gap:26px;font:400 150px/1 MowrSerif;letter-spacing:-5px;color:#16224a;opacity:0}
.endsub{font:400 34px MowrSans;color:#5a607a;opacity:0}.endsub b{font-weight:500;color:#d9473e}
.demo-tag{position:absolute;left:28px;bottom:22px;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.55);color:rgba(255,255,255,.75);font:500 15px MowrSans;letter-spacing:.2px}
body[data-block=title] .demo-tag{display:none}
`;
// file:// pages cannot load modules, so the stage runs as a classic script.
const stage = (await readFile(resolve("scripts/ads/stage.js"), "utf8")).replace(/^export /gm, "");
await writeFile(join(dir, "stage.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="stage"></div>
<script>window.FILM=${JSON.stringify({ log, framesBase: "frames/", live, spec })};</script><script>${stage.replace(/<\/script/g, "<\/script")}</script></body></html>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("stage:", e.message));
await page.goto(pathToFileURL(join(dir, "stage.html")).href);
await page.waitForFunction(() => window.FILM_DURATION > 0);
await page.evaluate(() => document.fonts.ready);
const { duration, cues, plan } = await page.evaluate(() => ({ duration: window.FILM_DURATION, cues: window.FILM_CUES, plan: window.FILM_PLAN }));
console.log(`Film: ${duration.toFixed(1)}s, ${cues.length} sound cues`);
console.log(plan.map((b) => `${b.id} ${b.start.toFixed(1)}–${(b.start + b.dur).toFixed(1)}`).join(" · "));

const audio = join(dir, "score.wav");
await score({ duration, cues, plan, file: audio });

const name = `mowr-ad-${ad}.mp4`;
const out = resolve("ads", preview ? name.replace(".mp4", "-preview.mp4") : name);
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", audio,
  "-c:v", "libx264", "-preset", preview ? "veryfast" : "slow", "-crf", preview ? "23" : "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "256k", "-shortest", out], { stdio: ["pipe", "inherit", "inherit"] });
const total = Math.ceil(duration * FPS), step = preview ? 2 : 1;
const started = Date.now();
for (let i = 0; i < total; i += step) {
  await page.evaluate((t) => window.renderAt(t), i / FPS);
  const jpg = await page.screenshot({ type: "jpeg", quality: 94 });
  for (let r = 0; r < step; r++) if (!ff.stdin.write(jpg)) await new Promise((res) => ff.stdin.once("drain", res));
  if (i % 150 === 0) console.log(`frame ${i}/${total} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((res, rej) => ff.on("close", (code) => (code ? rej(Error("ffmpeg failed")) : res())));
await browser.close();
console.log("Film ready:", out);
