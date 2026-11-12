// Looks at the website the way a visitor does: scrolls it in real steps at each width, keeps a picture of every stop, and
// reports console errors, broken images, horizontal scroll and links that lead nowhere. Needs the dev server on :5173.
//   node scripts/site/look.mjs [widths, e.g. 1440x900,390x844] [route, e.g. /#/about] [stops]
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const sizes = (process.argv[2] || "1440x900,1024x768,768x1024,390x844").split(",").map((s) => s.split("x").map(Number));
const route = process.argv[3] || "/", stops = Number(process.argv[4] || 0), out = "test-results/site-look";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => problems.push(`${width}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${width}: ${m.text().slice(0, 160)}`); });
    await page.goto("http://localhost:5173" + route);
    await page.waitForTimeout(2600);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const count = stops || Math.ceil(total / (height * 0.85)) + 1;
    for (let i = 0; i < count; i++) {
      const y = Math.min(total - height, Math.round((i * (total - height)) / Math.max(1, count - 1)));
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `${out}/${width}-${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 72 });
    }
    const report = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      broken: [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => i.src),
      deadLinks: [...document.querySelectorAll("a")].filter((a) => !a.getAttribute("href") || a.getAttribute("href") === "#").length,
      unnamed: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    }));
    console.log(width + "x" + height, "height", total, "stops", count, JSON.stringify(report));
    await page.close();
  }
} finally { await browser.close(); }
console.log(problems.length ? [...new Set(problems)].slice(0, 12).join("\n") : "no console errors");
