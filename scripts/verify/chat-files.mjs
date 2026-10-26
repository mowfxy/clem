// Files sent in a chat go to the normal Files tab (in a subject or project only when the message asks) and are deleted
// with the chat; files Clem made are deleted too unless the chat is in a subject or project.
// node scripts/verify/chat-files.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { openFixture, saved } from "./local-power-fixture.mjs";

// Made files carry their space only for subject and project chats, as desktop/main.ts sends them.
const desktopSpace = () => {
  const send = window.dispatchEvent.bind(window);
  window.dispatchEvent = (event) => {
    if (event.type === "clem:artifact") { const scope = event.detail.scope || ""; event.detail.file.spaceId = /^(subject|project):/.test(scope) ? scope.split(":")[1] : undefined; }
    return send(event);
  };
};
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { port: 5196, initScripts: [desktopSpace] });
const state = () => page.evaluate(async () => (await fetch("/api/local/state", { headers: { "X-Clem-Owner": "fixture-owner" } })).json());
const onDisk = (id) => page.evaluate(async (id) => (await fetch("/api/local/files/" + id, { headers: { "X-Clem-Owner": "fixture-owner" } })).status === 200, id);
async function sendWithFile(name, prompt, made = true) {
  await page.locator('input[type="file"][multiple]').setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from("Notes on cells and membranes.") });
  await page.locator(".composer").getByText(name).waitFor();
  await page.getByLabel("Your message").fill(prompt);
  await page.getByLabel("Your message").press("Enter");
  if (made) await page.getByText("I saved it as a PDF.").last().waitFor();
  else await page.getByText(`${name} saved to Biology 101.`).waitFor();
  await saved(page); await page.waitForTimeout(800);
}
async function deleteChat(title) {
  await page.evaluate(() => { location.hash = "/app"; });
  await page.getByRole("button", { name: "Chat options for " + title }).first().click({ force: true });
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await saved(page); await page.waitForTimeout(800);
}
try {
  // A normal chat: the sent file and the made PDF both go.
  await sendWithFile("lecture notes.txt", "Make a worksheet PDF from these notes");
  let s = await state();
  const sent = s.files.find((f) => f.name === "lecture notes.txt"), made = s.files.find((f) => f.made && f.name === "Week 3 worksheet.pdf");
  assert.ok(sent?.chatId, "the sent file is tagged with its chat");
  assert.ok(made, "the made PDF is in Files");
  assert.ok(await onDisk(sent.id) && await onDisk(made.id), "both are on disk");
  await deleteChat("Make a worksheet PDF from these notes");
  s = await state();
  assert.ok(!s.files.some((f) => f.id === sent.id || f.id === made.id), "both left Files");
  assert.ok(!(await onDisk(sent.id)) && !(await onDisk(made.id)), "both left the disk");
  assert.ok(s.files.some((f) => f.id === "syllabus") && await onDisk("syllabus"), "other files stay");

  // A subject chat: the sent file waits in the normal Files tab and goes with the chat; the made PDF stays in the subject.
  await page.evaluate(() => { location.hash = "/app/subjects"; });
  await page.getByRole("button", { name: "New chat in Biology 101" }).click();
  await sendWithFile("lab notes.txt", "Make a worksheet PDF for this lab");
  s = await state();
  const sent2 = s.files.find((f) => f.name === "lab notes.txt"), made2 = s.files.find((f) => f.made && f.name === "Week 3 worksheet.pdf");
  assert.equal(sent2?.spaceId, null, "the sent file is in the normal Files tab"); assert.equal(made2?.spaceId, "bio");
  assert.ok(!s.spaces[0].sources.includes(sent2.id), "the sent file is not one of the subject's sources");
  await deleteChat("Make a worksheet PDF for this lab");
  s = await state();
  assert.ok(!s.files.some((f) => f.id === sent2.id) && !(await onDisk(sent2.id)), "the sent file is deleted");
  assert.ok(!s.spaces[0].sources.includes(sent2.id), "and left the subject's sources");
  assert.ok(s.files.some((f) => f.id === made2.id) && await onDisk(made2.id), "the made PDF stays in the subject");
  assert.ok(s.files.some((f) => f.id === "worksheet") && s.files.some((f) => f.id === "handout"), "the subject's other files stay");

  // Asked to keep it in the subject: the sent file joins the subject's files and stays when the chat is deleted.
  await page.evaluate(() => { location.hash = "/app/subjects"; });
  await page.getByRole("button", { name: "New chat in Biology 101" }).click();
  await sendWithFile("reading list.txt", "Save this to the subject", false);
  s = await state();
  await saved(page); s = await state();
  const keep = s.files.find((f) => f.name === "reading list.txt");
  assert.equal(keep?.spaceId, "bio", "kept in the subject"); assert.ok(!keep.chatId); assert.ok(s.spaces[0].sources.includes(keep.id));
  await deleteChat("Save this to the subject");
  s = await state();
  assert.ok(s.files.some((f) => f.id === keep.id) && await onDisk(keep.id), "it stays after the chat is deleted");
  assert.equal(errors.length, 0, String(errors));
  console.log("chat-files: ok");
} finally { await close(); await browser.close(); }
