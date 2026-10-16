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
  await web.waitForSelector(".sx-hero");
  await shot(web, "website-visual", async () => { await web.locator("#visuals").scrollIntoViewIfNeeded(); await web.evaluate(() => scrollBy(0, 40)); await web.waitForSelector(".sx-demo-stage canvas", { timeout: 20000 }); await web.waitForTimeout(2500); });
  await shot(web, "website-open-source", async () => { await web.locator("#open-source").scrollIntoViewIfNeeded(); await web.evaluate(() => scrollBy(0, -140)); await web.waitForTimeout(900); });
  // The banner at the top of the README, drawn in Mowr's own type (also a good GitHub social preview, 1280×640).
  const banner = await (await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 })).newPage();
  await banner.goto("http://127.0.0.1:5200/");
  await banner.setContent(`<style>
    @font-face{font-family:Serif;src:url(/fonts/MowafySerif-Regular.woff2)}@font-face{font-family:Sans;src:url(/fonts/MowafySans-Regular.woff2)}
    body{margin:0;width:1280px;height:640px;display:grid;place-items:center;background:radial-gradient(55% 70% at 50% 38%,#26221f,#121211 70%);color:#f0efeb;overflow:hidden}
    main{text-align:center}svg{width:74px;height:74px}
    h1{font:400 112px/1 Serif;letter-spacing:-.045em;margin:26px 0 18px}
    p{font:400 27px/1.4 Sans;color:#b5b4ad;margin:0}
    small{display:block;margin-top:34px;font:400 17px/1 Sans;letter-spacing:.16em;text-transform:uppercase;color:#85847e}
  </style><main>${(await readFile("public/logo.svg", "utf8"))}<h1>Your space to think.</h1><p>A calm Windows workspace for projects, study and documents.</p><small>Free · Open source · MIT</small></main>`);
  await banner.evaluate(() => document.fonts.ready);
  await banner.waitForTimeout(400);
  await banner.screenshot({ path: resolve("docs/assets/banner.png") });
  console.log("saved banner");
} finally { await site.close(); await browser.close(); }
