// Moving around the workspace: a chat opens at its latest message and follows a streaming answer, scrolling up offers
// "Jump to latest", Alt+↑/↓ and Ctrl+1–5 move between chats and pages, Alt+←/→ go back and forward, Ctrl+F finds
// words on the page, Ctrl+/ lists every shortcut, chats rename in place, and Files filters and sorts.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openFixture } from "./local-power-fixture.mjs";

const long = Array.from({ length: 14 }, (_, i) => [
  { id: "u" + i, role: "user", content: "Question " + i + " about cells?" },
  { id: "a" + i, role: "assistant", content: ("Answer " + i + " mentions ribosomes. ").repeat(40) },
]).flat();
const reply = "## A longer answer\n\n" + "Mitochondria make ATP for the cell. ".repeat(150);
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { port: 5191, replies: [reply], extraChats: [{ id: "c-long", title: "A long chat", spaceId: null, updated: Date.now(), messages: long }] });
const at = () => page.evaluate(() => { const w = document.querySelector(".workspace"); return { gap: w.scrollHeight - w.clientHeight - w.scrollTop, jump: !!document.querySelector(".jump-latest") }; });
const title = () => page.locator(".top-title").textContent();
// A sidebar chat by its title (a "new reply" mark can join the button's name).
const row = (name) => page.locator(".sidebar-history .history-item").filter({ has: page.locator(".history-title", { hasText: new RegExp("^" + name + "$") }) });
try {
  // The sidebar marks the open chat once; "New chat" is not highlighted as well.
  await row("A long chat").click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".nav-item.active").count(), 0, "no page is marked while a chat is open");
  assert.ok((await at()).gap < 4, "a chat opens at its latest message");
  assert.equal(await page.getByLabel("Your message").getAttribute("placeholder"), "Reply to Clem…");
  assert.match(await page.title(), /^A long chat · Clem$/);

  // Sending brings the answer into view and follows it while it streams.
  await page.getByLabel("Your message").fill("Tell me more");
  await page.getByLabel("Your message").press("Enter");
  await page.waitForTimeout(1600);
  assert.ok((await at()).gap < 100, "the streaming answer is followed: " + JSON.stringify(await at()));
  // Scrolling up to read stops the following and offers a way back.
  await page.mouse.move(800, 300);
  await page.mouse.wheel(0, -1600);
  await page.waitForTimeout(500);
  const away = await at();
  assert.ok(away.jump && away.gap > 300, "scrolling up stops following and shows Jump to latest");
  await page.waitForTimeout(800);
  assert.ok((await at()).gap > 300, "the view stays where the person is reading");
  await page.locator(".jump-latest").click();
  await page.waitForFunction(() => { const w = document.querySelector(".workspace"); return w.scrollHeight - w.clientHeight - w.scrollTop < 4 && !document.querySelector(".jump-latest"); }, null, { timeout: 4000 })
    .catch(async () => assert.fail("Jump to latest lands at the end: " + JSON.stringify(await at())));

  // Find on this page counts matches and steps through them.
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find in this page").fill("ribosomes");
  await page.waitForTimeout(400);
  const count = await page.locator(".find-count").textContent();
  assert.match(count, /^1 of \d+$/, count);
  await page.getByLabel("Find in this page").press("Enter");
  assert.match(await page.locator(".find-count").textContent(), /^2 of /);
  await page.getByLabel("Find in this page").press("Escape");
  assert.equal(await page.locator(".find-bar").count(), 0);

  // Alt+↓/↑ walk the sidebar's chats in order.
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(300);
  assert.equal(await title(), "Osmosis lab write-up");
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(300);
  assert.equal(await title(), "A long chat");

  // Ctrl+1–5 open the sidebar's pages; Alt+← and Alt+→ retrace the way.
  await page.keyboard.press("Control+5");
  await page.locator(".files-page").waitFor();
  await page.keyboard.press("Control+3");
  await page.waitForFunction(() => location.hash === "#/app/projects");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => location.hash === "#/app/files");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => location.hash === "#/app");
  assert.equal(await title(), "A long chat", "Back returns to the chat that was open");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForTimeout(300);
  assert.equal(await title(), "Osmosis lab write-up");
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForTimeout(300);
  assert.equal(await title(), "A long chat", "Forward goes the other way");

  // Files: kinds to filter by and an order to sort in.
  await page.keyboard.press("Control+5");
  await page.locator(".files-kinds").waitFor();
  await page.locator(".files-kinds").getByRole("button", { name: /^PDFs/ }).click();
  assert.equal(await page.locator(".file-list .file-row").count(), 2);
  await page.getByRole("button", { name: /^Sort files/ }).click();
  await page.getByRole("menuitemradio", { name: "Name" }).click();
  const names = await page.locator(".file-list .file-open").allTextContents();
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.match(await page.locator(".file-list small").first().textContent(), /today|yesterday|days ago|[A-Z][a-z]{2} \d/);

  // Shortcuts sheet.
  await page.keyboard.press("Control+/");
  await page.locator("dialog.shortcuts-sheet[open]").waitFor();
  assert.ok(await page.getByText("Find in this page", { exact: true }).count());
  await page.keyboard.press("Escape");

  // Rename a chat in place; Clem never renames it after that.
  await page.keyboard.press("Control+1");
  await row("Osmosis lab write-up").dblclick();
  await page.locator(".history-rename input").waitFor();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Potato osmosis");
  await page.keyboard.press("Enter");
  await row("Potato osmosis").waitFor({ timeout: 5000 });

  // The palette lists recent conversations first and marks what matched.
  await page.keyboard.press("Control+k");
  assert.equal(await page.locator(".command-results h3").first().textContent(), "Recent conversations");
  await page.keyboard.type("potato");
  assert.equal(await page.locator(".command-results mark").first().textContent(), "Potato");
  await page.keyboard.press("Escape");
  // Ctrl+B puts the sidebar away and the workspace takes the room; the corner button brings it back.
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => Math.round(document.querySelector(".workspace").getBoundingClientRect().left)), 0);
  await page.getByLabel("Open navigation").click();
  await page.waitForTimeout(450);
  assert.ok(await page.evaluate(() => document.querySelector(".workspace").getBoundingClientRect().left > 200), "the sidebar is back");
  // Ctrl + and Ctrl 0 change how large answers read.
  await row("A long chat").click();
  const read = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".message.assistant .message-text")).fontSize));
  const normal = await read();
  await page.keyboard.press("Control+=");
  assert.ok((await read()) > normal, "Ctrl + makes answers larger");
  await page.keyboard.press("Control+0");
  assert.equal(await read(), normal);

  // Files dragged onto a conversation attach to the next message, with an overlay while they are held over it.
  await row("A long chat").click();
  const dragged = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(["Notes on mitosis"], "mitosis notes.txt", { type: "text/plain" })); return dt; });
  await page.dispatchEvent(".messages", "dragenter", { dataTransfer: dragged });
  await page.locator(".drop-overlay").waitFor();
  await page.dispatchEvent(".messages", "drop", { dataTransfer: dragged });
  await page.locator(".drop-overlay").waitFor({ state: "detached" });
  await page.locator(".composer").getByText("mitosis notes.txt").first().waitFor({ timeout: 8000 });
  await page.locator(".composer").getByRole("button", { name: /Remove/ }).first().click().catch(() => {});

  // Each chat keeps its own unsent message; a sent one never comes back.
  const box = page.getByLabel("Your message");
  await row("A long chat").click();
  await box.fill("half a thought");
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(300);
  assert.equal(await box.inputValue(), "", "the next chat does not inherit the draft");
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(300);
  assert.equal(await box.inputValue(), "half a thought", "coming back brings the draft back");
  await page.keyboard.press("Control+n");
  await box.fill("A brand new question");
  await box.press("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(300);
  assert.equal(await box.inputValue(), "", "a sent message is not offered again");
  assert.deepEqual(errors, []);
  console.log("Workspace navigation checks passed.");
} finally {
  await close();
  await browser.close();
}
