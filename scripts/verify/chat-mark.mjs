// The Mowr mark appears once per chat: beside "Thinking…" while waiting, then under the latest answer only.
// node scripts/verify/chat-mark.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { openFixture } from "./local-power-fixture.mjs";

const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: ["First answer, a short one.", "Second answer.\n\n- one\n- two"] });
const send = async (t) => { await page.getByLabel("Your message").fill(t); await page.getByLabel("Your message").press("Enter"); };
try {
  await send("Hello");
  await page.locator(".thinking").waitFor(); await page.waitForTimeout(250);
  await page.locator(".message-mark").evaluate((e) => e.getAnimations().forEach((a) => a.finish()));
  const thinking = await page.locator(".thinking").boundingBox(), mark = await page.locator(".message-mark").boundingBox();
  assert.ok(Math.abs(thinking.y + thinking.height / 2 - mark.y - mark.height / 2) < 3, "mark sits beside Thinking…");
  assert.ok(mark.x < thinking.x, "mark is left of Thinking…");
  await page.getByText("First answer, a short one.").waitFor();
  await send("Again");
  await page.getByText("Second answer.").waitFor(); await page.waitForTimeout(800);
  assert.equal(await page.locator(".message-mark").count(), 1, "one mark in the chat");
  const last = page.locator(".message.assistant").last();
  assert.equal(await last.locator(".message-mark").count(), 1, "the mark is on the latest answer");
  const text = await last.locator(".message-text").boundingBox(), end = await last.locator(".message-mark").boundingBox();
  assert.ok(end.y > text.y + text.height, "the mark sits under the answer");
  const first = await page.locator(".message.assistant .message-text").first().boundingBox(), msgs = await page.locator(".messages").boundingBox();
  assert.ok(Math.abs(first.x - msgs.x) < 2, "answers use the full column");
  assert.equal(errors.length, 0, String(errors));
  console.log("chat-mark: ok");
} finally { await close(); await browser.close(); }
