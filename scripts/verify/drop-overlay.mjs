// Files held over a chat: one even sheet over the whole window, sidebar and title bar included, in both themes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/drop-overlay";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const fixture = await openFixture(browser, { port: 5231, replies: ["Work through each loop in turn. ".repeat(30)] });
const { page, errors } = fixture;
try {
  const box = page.locator(".composer textarea");
  await box.fill("Solve this circuit");
  await box.press("Enter");
  await page.getByText("Work through each loop").first().waitFor({ timeout: 8000 });
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(700);
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(["x"], "quiz.txt", { type: "text/plain" })); return d; });
    await page.dispatchEvent(".messages", "dragenter", { dataTransfer: dt });
    await page.locator(".drop-overlay").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${theme}.png` });
    if (!process.env.LOOK) {
      const r = await page.evaluate(() => {
        const el = document.querySelector(".drop-overlay"), b = el.getBoundingClientRect();
        // What the sheet paints over: it takes no pointer, so it is made hittable for the look-up only.
        el.style.pointerEvents = "auto";
        const tops = [[40, 40], [100, innerHeight - 40], [innerWidth / 2, 15], [innerWidth - 30, 15], [innerWidth - 30, innerHeight - 30]].map(([x, y]) => el.contains(document.elementFromPoint(x, y)));
        el.style.pointerEvents = "";
        return { box: [b.x, b.y, b.width, b.height], win: [0, 0, innerWidth, innerHeight], tops, pointer: getComputedStyle(el).pointerEvents, bg: getComputedStyle(el).backgroundColor };
      });
      assert.deepEqual(r.box, r.win, "the sheet is the whole window");
      assert.ok(r.tops.every(Boolean), "nothing shows above it: " + r.tops);
      assert.equal(r.pointer, "none");
      assert.ok(r.bg.startsWith(theme === "dark" ? "rgba(2, 4, 10" : "rgba(223, 232, 242"), "theme colour: " + r.bg);
    }
    await page.dispatchEvent(".messages", "dragleave", { dataTransfer: dt });
    await page.locator(".drop-overlay").waitFor({ state: "detached" });
  }
  assert.deepEqual(errors, []);
  console.log("drop overlay ok");
} finally {
  await fixture.close();
  await browser.close();
}
