// README screenshots of the real interface, from the demo fixture (scripted replies, no model calls), plus the website.
//   node scripts/readme-screenshots.mjs   → docs/assets/screenshots/*.png
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
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

// The website, served on its own: its live visual and open-source line for the README, and its first screen (the
// sunrise set in type) as the README banner and the site's og:image.
const site = await createServer({ server: { host: "127.0.0.1", port: 5200, strictPort: true }, logLevel: "error" });
await site.listen();
try {
  const web = await (await browser.newContext({ viewport, reducedMotion: "reduce" })).newPage();
  await web.goto("http://127.0.0.1:5200/#/");
  await web.waitForSelector(".cs-sky[data-drawn]", { timeout: 15000 });
  const part = async (name, selector) => {
    try { const el = web.locator(selector).first(); await el.scrollIntoViewIfNeeded(); await web.waitForTimeout(900); await el.screenshot({ path: join(out, name + ".png") }); console.log("saved", name); }
    catch (error) { console.log("skipped", name, String(error).split("\n")[0]); }
  };
  await part("website-visual", ".cs-centred");
  await part("website-open-source", ".cs-open");
  for (const [path, width, height] of [["docs/assets/banner.png", 1280, 640], ["public/og.png", 1200, 630]]) {
    const hero = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: path.endsWith("banner.png") ? 2 : 1, reducedMotion: "reduce" })).newPage();
    await hero.goto("http://127.0.0.1:5200/#/");
    await hero.waitForSelector(".cs-sky[data-drawn]", { timeout: 15000 });
    await hero.waitForTimeout(1600);
    await hero.screenshot({ path: resolve(path) });
    console.log("saved", path);
  }
} finally { await site.close(); await browser.close(); }
