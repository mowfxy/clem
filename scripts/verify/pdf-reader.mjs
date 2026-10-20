// Browser check for the reader beside a chat: page x of y and zoom, the place a file was left at coming back when it
// opens again, the file staying with its own chat, and a pointer in a sent message opening its file at the spot.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/pdf-reader";
await mkdir(out, { recursive: true });

// A twelve-page handout with a line to point at on each page.
const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 12; n++) {
  const p = doc.addPage([595, 842]);
  if (n === 1) p.setRotation(degrees(180)); // scanned sheets often arrive upside down; the page must still draw in full
  p.drawText(`Section ${n}`, { x: 60, y: 760, size: 26, font });
  p.drawText(`Key idea ${n}: water moves toward the higher solute concentration.`, { x: 60, y: 420, size: 13, font });
}
const handout = await doc.save();

const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { replies: ["It means water follows the solutes."] });
const body = page.locator(".file-panel .fp-body");
const pageField = page.getByLabel("Page", { exact: true });
const openHandout = async () => {
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-file", { hasText: "Osmosis lab handout.pdf" }).getByRole("button", { name: "Osmosis lab handout.pdf options" }).click();
  await page.getByRole("menuitem", { name: "Edit with Clem" }).click();
  await page.locator(".file-panel .ps-page canvas").first().waitFor();
  await page.locator(".fp-of", { hasText: "of 12" }).waitFor();
};
const scrollToPage = async (n) => { await body.evaluate((el, n) => { const p = el.querySelector(`.ps-page[data-page="${n}"]`); el.scrollTop = p.offsetTop + 40; }, n); await page.waitForTimeout(500); };
const pageInView = () => body.evaluate((el) => { const top = el.getBoundingClientRect().top + el.clientHeight * 0.4; return Number([...el.querySelectorAll(".ps-page")].filter((p) => p.getBoundingClientRect().top <= top).pop()?.dataset.page); });
try {
  await page.evaluate(async (bytes) => { const store = await import("/src/store.ts"); await store.storeBlob("handout", new Blob([new Uint8Array(bytes)], { type: "application/pdf" })); }, Array.from(handout));
  await openHandout();
  await page.screenshot({ path: `${out}/split.png` });
  // The first page is drawn across its whole canvas (a render racing a resize once left most of it black).
  await page.waitForTimeout(800);
  const drawn = await page.locator('.ps-page[data-page="1"] canvas').evaluate((c) => { const d = c.getContext("2d").getImageData(Math.floor(c.width * 0.8), Math.floor(c.height * 0.8), 4, 4).data; return d[3] > 0 && d[0] > 200; });
  assert.ok(drawn, "the whole first page is drawn");
  // Resizing while pages draw (the reader settling, a scrollbar appearing, the edge dragged) never leaves a page drawn
  // at its old size, flipped or on black: every live canvas is white in its margins once drawing settles.
  for (const w of [1300, 1180, 1420, 1240, 1440]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(60); }
  await page.waitForTimeout(4000);
  const bad = await page.evaluate(() => [...document.querySelectorAll(".file-panel .ps-page canvas")].filter((c) => c.width > 0 && !(c.width === 300 && c.height === 150)).flatMap((c) => {
    const g = c.getContext("2d"), spots = [[0.03, 0.03], [0.97, 0.03], [0.03, 0.97], [0.97, 0.97], [0.5, 0.2]];
    return spots.filter(([x, y]) => { const d = g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data; return !(d[3] > 250 && d[0] > 240 && d[1] > 240 && d[2] > 240); }).map(([x, y]) => `${c.getAttribute("aria-label")} at ${x},${y} ${Array.from(g.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data)} ${c.width}x${c.height} css ${c.clientWidth}`);
  }));
  assert.deepEqual(bad, [], "pages are drawn whole after resizing");

  // The chat column and the reader share the width; nothing spills under the reader.
  const box = await page.evaluate(() => { const c = document.querySelector(".chat-split > .chat-view").getBoundingClientRect(), f = document.querySelector(".file-panel").getBoundingClientRect(), comp = document.querySelector(".composer").getBoundingClientRect(); return { chatRight: c.right, panelLeft: f.left, composerRight: comp.right }; });
  assert.ok(box.chatRight <= box.panelLeft + 1 && box.composerRight <= box.panelLeft, "the chat column ends where the reader starts");

  // Page x of y follows the scroll; typing a page goes there; zoom changes the page width and keeps the page.
  await scrollToPage(5);
  assert.equal(await pageField.inputValue(), "5");
  await pageField.fill("9"); await pageField.press("Enter"); await page.waitForTimeout(700);
  assert.equal(await pageInView(), 9, "typing a page number goes to that page");
  const before = await page.locator('.ps-page[data-page="9"]').evaluate((el) => el.offsetWidth);
  await page.getByRole("button", { name: "Zoom in" }).click(); await page.waitForTimeout(700);
  assert.ok(await page.locator('.ps-page[data-page="9"]').evaluate((el) => el.offsetWidth) > before, "zoom in widens the pages");
  assert.equal(await pageInView(), 9, "zooming keeps the page in view");
  await page.getByRole("button", { name: /fit to width/ }).click(); await page.waitForTimeout(600);

  // Closing and opening the file again comes back to the same place.
  await scrollToPage(7);
  await page.getByRole("button", { name: "Close file" }).click();
  await openHandout();
  await page.waitForTimeout(400);
  assert.equal(await pageInView(), 7, "the file opens again where it was left");
  assert.equal(await pageField.inputValue(), "7");

  // Point at a line on page 4, send it, then press the pointer in the sent message: the reader goes there and it glows.
  await scrollToPage(4);
  const line = page.locator('.ps-page[data-page="4"] .ps-text span', { hasText: "Key idea 4" }).first();
  await line.waitFor();
  await line.click({ clickCount: 3 });
  await line.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add selection to chat" }).click();
  await page.getByLabel("Your message").fill("What does this mean?");
  await page.getByLabel("Your message").press("Enter");
  await page.getByText("It means water follows the solutes.").waitFor();
  await scrollToPage(11);
  await page.locator(".message-pointers button.pointer-chip").first().click();
  await page.locator(".ps-page[data-page='4'] .fp-glow").waitFor({ timeout: 3000 });
  await page.waitForTimeout(900);
  assert.equal(await pageInView(), 4, "the pointer opens its page");
  const glow = await page.locator(".fp-glow").boundingBox(), view = await body.boundingBox();
  assert.ok(glow && glow.y > view.y && glow.y + glow.height < view.y + view.height, "the pointed spot is in view");
  await page.screenshot({ path: `${out}/pointer-glow.png` });
  await page.locator(".fp-glow").waitFor({ state: "detached", timeout: 4000 });

  // Another chat does not carry the file; coming back brings it back.
  const thisChat = await page.evaluate(() => location.hash);
  await page.locator(".history-item, .history-row, .sidebar button, .sidebar a", { hasText: "Osmosis lab write-up" }).first().click();
  await page.getByText("Help me explain why the potato gained mass in pure water.").waitFor();
  assert.equal(await page.locator(".chat-split .file-panel").count(), 0, "another chat opens without the file");
  await page.locator(".history-item, .history-row, .sidebar button, .sidebar a", { hasText: "What does this mean?" }).first().click().catch(async () => {
    await page.locator(".sidebar").getByText(/Osmosis lab handout|What does this mean/).first().click();
  });
  await page.locator(".chat-split .file-panel .ps-page canvas").first().waitFor();
  assert.ok(thisChat);

  // The pointer still works after a new chat clears the reader.
  await page.locator(".message-pointers button.pointer-chip").first().waitFor();
  await page.getByRole("button", { name: "Close file" }).click();
  await page.locator(".message-pointers button.pointer-chip").first().click();
  await page.locator(".ps-page[data-page='4'] .fp-glow").waitFor({ timeout: 5000 });

  // A narrow window still fits both.
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/split-narrow.png` });
  assert.deepEqual(errors, []);
  console.log("PASS reader toolbar, zoom, remembered place, per-chat file and pointers that open their spot");
} finally {
  await close();
  await browser.close();
}
