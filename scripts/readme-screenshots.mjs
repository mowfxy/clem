// README screenshots of the real interface, from the demo fixture (scripted replies, no model calls), plus the website.
//   node scripts/readme-screenshots.mjs   → docs/assets/screenshots/*.png
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openFixture } from "./verify/local-power-fixture.mjs";

const out = resolve("docs/assets/screenshots");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const viewport = { width: 1600, height: 1000 };
const { page, close } = await openFixture(browser, { port: 5199, viewport, deviceScaleFactor: 1 });
const shot = async (target, name, step) => {
  try { await step(); await target.waitForTimeout(1400); await target.screenshot({ path: join(out, name + ".png") }); console.log("saved", name); }
  catch (error) { console.log("skipped", name, String(error).split("\n")[0]); }
};
try {
  await page.waitForTimeout(2500);
  const nav = (label) => page.locator("nav, aside").getByText(label, { exact: true }).first().click();
  await shot(page, "home", async () => {});
  await shot(page, "chat", async () => { await page.getByText("Osmosis lab write-up").first().click(); });
  await shot(page, "subject", async () => { await nav("Subjects"); await page.getByText("Biology 101").first().click(); });
  await shot(page, "files", async () => { await nav("Files"); });
} finally { await close(); }

// The website, served on its own.
const site = await createServer({ server: { host: "127.0.0.1", port: 5200, strictPort: true }, logLevel: "error" });
await site.listen();
try {
  const web = await (await browser.newContext({ viewport })).newPage();
  await web.goto("http://127.0.0.1:5200/#/");
  await web.waitForSelector(".cx-hero");
  await shot(web, "website-visual", async () => { await web.locator("#visuals").scrollIntoViewIfNeeded(); await web.evaluate(() => scrollBy(0, 40)); await web.waitForSelector(".cx-demo-stage canvas", { timeout: 20000 }); await web.waitForTimeout(2500); });
  await shot(web, "website-open-source", async () => { await web.locator("#open-source").scrollIntoViewIfNeeded(); await web.evaluate(() => scrollBy(0, -140)); await web.waitForTimeout(900); });
  // The banner at the top of the README, in M4 Labs' terminal style with Clem's lockup (also a good GitHub social preview, 1280×640).
  const banner = await (await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 })).newPage();
  await banner.goto("http://127.0.0.1:5200/");
  await banner.setContent(`<style>
    @font-face{font-family:Mono;src:url(/fonts/JetBrainsMono.woff2);font-weight:100 800}@font-face{font-family:Word;src:url(/fonts/Outfit.woff2);font-weight:100 900}
    body{margin:0;width:1280px;height:640px;box-sizing:border-box;padding:72px 88px;display:flex;flex-direction:column;justify-content:space-between;background:#0b0b0a;color:#F4F2EC;font-family:Mono;overflow:hidden}
    .top{display:flex;justify-content:space-between;font-size:18px;color:#8a897f}.top b{color:#F4F2EC;font-weight:400}
    .lock{display:flex;align-items:center;gap:30px}.lock svg{width:120px;height:120px}.lock span{font:600 140px/1 Word;letter-spacing:-.03em}
    h1{font-weight:400;font-size:44px;letter-spacing:-.02em;margin:0}h1 i{display:inline-block;width:.55em;height:.95em;background:#F4F2EC;border-radius:3px;margin-left:.2em;vertical-align:-.12em}
    p{margin:14px 0 0;font-size:20px;color:#8a897f}
  </style><div class="top"><span><b>m4labs:~$</b> clem --about</span><span>an M4 Labs project</span></div>
  <div class="lock">${(await readFile("public/logo.svg", "utf8"))}<span>clem</span></div>
  <div><h1>Your space to think.<i></i></h1><p>A calm Windows workspace for projects, study and documents · free · open source · MIT</p></div>`);
  await banner.evaluate(() => document.fonts.ready);
  await banner.waitForTimeout(400);
  await banner.screenshot({ path: resolve("docs/assets/banner.png") });
  console.log("saved banner");
} finally { await site.close(); await browser.close(); }
