// Checks the chat box grows with a long message up to a cap, then scrolls with its own thin bar, and that the word
// layer behind it wraps and scrolls exactly with the box.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/composer-grow";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const fixture = await openFixture(browser);
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const box = page.locator(".composer textarea");
const measure = () => box.evaluate((el) => { const m = el.previousElementSibling; return { h: el.clientHeight, scroll: el.scrollHeight, top: el.scrollTop, mirrorTop: m.scrollTop, width: el.clientWidth, mirrorWidth: m.clientWidth }; });
try {
  await box.fill("Short question");
  const short = await measure();
  await box.fill(Array.from({ length: 4 }, (_, i) => `Line ${i + 1} of a longer message`).join("\n"));
  const mid = await measure();
  check(mid.h > short.h && mid.scroll <= mid.h + 1, `grows to fit four lines (${short.h} → ${mid.h}px, no scroll)`);
  await box.fill("sry" + "y".repeat(3000));
  await box.press("End");
  const long = await measure();
  check(long.h < long.scroll && long.h <= 270, `stops at the cap and scrolls (${long.h}px of ${long.scroll}px)`);
  check(Math.abs(long.top - long.mirrorTop) <= 1, "word layer scrolls with the box");
  check(long.width === long.mirrorWidth, `word layer wraps at the box's width (${long.width} / ${long.mirrorWidth})`);
  await page.screenshot({ path: out + "/long.png" });
  // Switching theme repaints the words in the new ink, as applyTheme does it (theme.ts).
  const flip = (theme) => box.evaluate((el, theme) => {
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent("clem-theme", { detail: theme }));
    return { ink: getComputedStyle(el).color, words: getComputedStyle(el.previousElementSibling).color };
  }, theme);
  for (const theme of ["light", "dark", "light"]) {
    const c = await flip(theme);
    check(c.ink === c.words, `${theme}: words follow the box's ink (${c.words} / ${c.ink})`);
  }
  await page.screenshot({ path: out + "/light.png" });
  await flip("dark");
  await box.fill("");
  const back = await measure();
  check(back.h === short.h, `shrinks back when cleared (${back.h}px)`);
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
