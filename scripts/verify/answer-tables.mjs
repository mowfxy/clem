// Answer tables use the room they need: a narrow header never breaks inside its word, a table with many columns grows
// beyond the text column when the window has room (never past the workspace), and one that still does not fit scrolls
// inside its frame. Also: a long message in the composer shows no scrollbar, and the chat menu is text only with a red Delete.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = "artifacts/answer-tables";
await mkdir(out, { recursive: true });
const plan = `Here is the week.

${"On each day, test yourself without notes before moving on, and note what you got wrong.\n\n".repeat(14)}

| Day | Data Structures and Algorithms | Math 301 | Physics 3 |
|---|---|---|---|
| 1 | Lecture 1 (48 pages): read it, then write a one-page summary of the key definitions and complexities. | Lectures 1-2: functions of several variables, limits and continuity. Do 5-6 limit problems. | - |
| 2 | Lectures 2 and 3 (52 pages): trace each structure or algorithm by hand on a small example. | - | Sheet 1: thermal expansion, heat calculations and heat transfer. Solve every problem. |
| 3 | Lecture 4 (24 pages): the same hand traces. | Lectures 3-4: partial derivatives, tangent planes, the chain rule and directional derivatives. | Sheet 2: heat transfer, work and the first law. |

| A | B |
|---|---|
| short | table |

| Week | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Notes | Goals |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Lecture 1 summary | Hand traces | Limits practice | Sheet 1 | Revision | Mock test | Rest | Keep a formula sheet as you go | Finish lectures one to three |

`;
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
for (const width of [1920, 1100]) {
  const fixture = await openFixture(browser, { viewport: { width, height: 1000 }, replies: [plan] });
  const { page, errors } = fixture;
  try {
    await page.locator(".composer textarea").fill("Make me a study plan for the week");
    await page.locator(".composer textarea").press("Enter");
    await page.locator(".message-text .table-wrap").nth(2).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Second opinion" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    const facts = await page.evaluate(() => {
      const wraps = [...document.querySelectorAll(".message-text .table-wrap")], column = wraps[0].parentElement.getBoundingClientRect();
      const area = document.querySelector(".workspace").getBoundingClientRect();
      const th = wraps[0].querySelector("th"), lineHeight = parseFloat(getComputedStyle(th).lineHeight) || 20;
      return {
        column: column.width,
        widths: wraps.map((w) => Math.round(w.getBoundingClientRect().width)),
        inside: wraps.every((w) => { const r = w.getBoundingClientRect(); return r.left >= area.left - 1 && r.right <= area.right + 1; }),
        scrolls: wraps.map((w) => w.scrollWidth > w.clientWidth + 1),
        dayLines: Math.round(th.getBoundingClientRect().height / lineHeight),
        pageScroll: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    console.log(width, JSON.stringify(facts));
    check(facts.dayLines <= 2, `${width}: the "Day" header stays one word`);
    check(facts.inside, `${width}: every table stays inside the workspace`);
    check(!facts.pageScroll, `${width}: the page never scrolls sideways`);
    check(Math.abs(facts.widths[1] - facts.column) < 2, `${width}: a small table keeps the text column's width`);
    if (width === 1920) check(facts.widths[0] > facts.column + 40, "1920: the four-column table takes more room on a wide window");
    if (width === 1100) check(facts.scrolls[2], "1100: the ten-column table scrolls inside its frame");
    await page.locator(".message-text .table-wrap").first().screenshot({ path: `${out}/table-${width}.png` });
    // A wide table scrolled under the chat box passes under its backdrop, beside the box too, never over it.
    await page.locator(".message-text .table-wrap").first().evaluate((w) => {
      const box = document.querySelector(".chat-composer").getBoundingClientRect(), scroller = w.closest(".chat-view")?.parentElement || document.scrollingElement;
      let s = w.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      (s || document.scrollingElement).scrollTop += w.getBoundingClientRect().top + 60 - (box.top + box.height / 2);
    });
    await page.waitForTimeout(200);
    const under = await page.evaluate(() => {
      const box = document.querySelector(".chat-composer").getBoundingClientRect(), w = document.querySelector(".message-text .table-wrap").getBoundingClientRect();
      const y = box.top + box.height / 2, xs = [w.left + 6, w.right - 6].filter((x) => x < box.left || x > box.right);
      return { tableUnder: w.bottom > y && w.top < y,
        same: getComputedStyle(document.querySelector(".chat-composer"), "::before").backgroundColor === getComputedStyle(document.querySelector(".workspace")).backgroundColor };
    });
    if (width === 1920) {
      // Beside the box, where the table runs under it, the screen shows only the page's background: the same pixels as an
      // empty patch of the workspace at that height.
      const box = await page.locator(".chat-composer .composer").boundingBox(), w = await page.locator(".message-text .table-wrap").first().boundingBox();
      const y = Math.round(box.y + box.height / 2), side = { x: Math.round(w.x - 6), y, width: 16, height: 16 }, empty = { x: Math.round(w.x - 60), y, width: 16, height: 16 };
      const same = (await page.screenshot({ clip: side })).equals(await page.screenshot({ clip: empty }));
      check(under.tableUnder && side.x + 16 < box.x && same, "1920: a wide table under the chat box is hidden beside the box too");
    }
    check(under.same, `${width}: the chat box's backdrop is the page's own colour`);
    await page.screenshot({ path: `${out}/under-composer-${width}.png` });
    await page.screenshot({ path: `${out}/answer-${width}.png` });
    // A long message: no scrollbar beside the composer's text.
    await page.locator(".composer textarea").fill("g".repeat(1400));
    const bar = await page.locator(".composer textarea").evaluate((t) => ({ scrolls: t.scrollHeight > t.clientHeight, bar: t.offsetWidth - t.clientWidth - parseFloat(getComputedStyle(t).borderLeftWidth) - parseFloat(getComputedStyle(t).borderRightWidth) }));
    check(bar.scrolls && bar.bar === 0, `${width}: a long message scrolls in the composer with no scrollbar`);
    await page.locator(".chat-composer").screenshot({ path: `${out}/composer-${width}.png` });
    if (width === 1920) {
      await page.locator(".composer textarea").fill("");
      const more = page.getByRole("button", { name: /^Chat options for/ }).first();
      await more.hover();
      await more.click();
      const menu = page.locator(".chat-options:popover-open");
      await menu.waitFor();
      check(await menu.locator("svg").count() === 0, "the chat menu has no icons");
      const red = await menu.getByRole("button", { name: "Delete chat" }).evaluate((b) => getComputedStyle(b).color);
      check(red === "rgb(255, 90, 78)", "Delete chat is red (" + red + ")");
      await menu.screenshot({ path: `${out}/chat-menu.png` });
    }
    check(!errors.length, `${width}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
  } finally {
    await fixture.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
