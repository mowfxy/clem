// README screenshots of the real interface, from the demo fixture (scripted replies, no model calls).
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

await browser.close();
