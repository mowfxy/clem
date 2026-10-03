// Browser check for the learning workspace: folders on this PC and the in-app file viewer, folder
// change notices, search everything, the subject page (overview, tabs, in-app folders, uploads,
// moving files, worksheets saved to a folder), real PDF edits with undo, and one-step sharing.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openFixture, FOLDER } from "./local-power-fixture.mjs";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser);
const pdfText = (id) => page.evaluate(async (id) => {
  const store = await import("/src/store.ts"), { openPdf, pageItems } = await import("/src/pdf/pdf-edit.ts");
  const pdf = await openPdf(new Uint8Array(await (await store.getBlob(id)).arrayBuffer()));
  return (await pageItems(pdf)).flat().map((i) => i.str).join(" ");
}, id);
try {
  // Linked folders: browse, read, ask for a change, apply.
  await page.evaluate(() => { location.hash = "/app/files"; });
  await page.getByRole("heading", { name: "Folders on this PC" }).waitFor();
  await page.getByRole("button", { name: "Browse" }).click();
  await page.locator(".folder-browser .fb-files button", { hasText: "Week 3 - Cell biology.md" }).click();
  await page.locator(".fv-body").getByText("Mitochondria: TODO").waitFor();
  await page.getByLabel("Describe the change").fill("Fill in the mitochondria note and add a one-line summary");
  await page.getByRole("button", { name: "Propose change" }).click();
  await page.locator(".edit-proposal .edit-diff .add").first().waitFor();
  const ask = await page.evaluate(() => window.requests.find((r) => r.action === "chat"));
  assert.equal(ask.scope, FOLDER.scope);
  await page.getByRole("button", { name: "Apply change" }).click();
  await page.locator(".edit-proposal .edit-state", { hasText: "Applied" }).waitFor();

  // Outside changes become a notice.
  await page.evaluate((f) => window.fireFolder({ folderId: f.id, scope: f.scope, folder: "Biology 101", added: ["week4-genetics.md"], changed: ["glossary.md"], removed: [] }), FOLDER);
  await page.getByText("2 files changed in Biology 101").waitFor();
  await page.getByRole("button", { name: "Update flashcards" }).click();
  // The /flashcards command shows as a chip in front of the words.
  await page.locator(".composer .command-chip", { hasText: "Flashcards" }).waitFor();
  assert.match(await page.locator(".composer textarea").inputValue(), /^Update this subject's flashcards/);
  await page.locator(".composer textarea").fill("");

  // Search everything.
  await page.keyboard.press("Control+Shift+F");
  await page.getByRole("combobox", { name: "Search everything" }).fill("mitochondria");
  await page.locator(".se-results .se-kind.kind-folder").first().waitFor();
  await page.locator(".se-results .se-kind.kind-card").first().waitFor();
  await page.keyboard.press("Escape");

  // The subject is a page, not a pop-up.
  await page.evaluate(() => { location.hash = "/app/subjects"; });
  await page.locator(".lib-card-open", { hasText: "Biology 101" }).click();
  await page.locator(".space-page .sp-name", { hasText: "Biology 101" }).waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0, "no pop-up");
  assert.match(page.url(), /#\/app\/space\/bio$/);
  await page.locator(".sp-stat.due", { hasText: "5 new" }).waitFor();
  await page.screenshot({ path: "artifacts/subject-overview.png" });
  for (const tab of ["Chats", "Flashcards", "Quizzes", "Files", "Overview"]) await page.getByRole("tab", { name: new RegExp("^" + tab) }).click();
  await page.getByRole("tab", { name: /^Flashcards/ }).click();
  await page.getByText("Cell organelles").waitFor();

  // Files: folders, uploads into a folder, moving a file.
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-folder", { hasText: "Worksheets" }).getByText("1 item").waitFor();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Revision");
  await page.getByLabel("New folder name").press("Enter");
  await page.locator(".sp-folder", { hasText: "Revision" }).click();
  await page.locator(".sp-path").getByText("Revision").waitFor();
  await page.locator(".sp-tool-actions input[type=file]").setInputFiles({ name: "Key terms.txt", mimeType: "text/plain", buffer: Buffer.from("Osmosis, diffusion, active transport") });
  await page.locator(".sp-file", { hasText: "Key terms.txt" }).waitFor();
  await page.locator(".sp-file", { hasText: "Key terms.txt" }).getByRole("button", { name: /options/ }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  await page.locator(".sp-move button", { hasText: "Worksheets" }).click();
  await page.locator(".sp-drop-empty", { hasText: "This folder is empty" }).waitFor();
  await page.locator(".sp-path button", { hasText: "Files" }).click();
  await page.locator(".sp-folder", { hasText: "Worksheets" }).getByText("2 items").waitFor();
  await page.screenshot({ path: "artifacts/subject-files.png" });

  // "Make a worksheet" saves the PDF Mowr makes into Worksheets.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.locator(".sp-make button", { hasText: "Worksheet" }).click();
  await page.getByText("I saved it as a PDF.").waitFor();
  const saved = await page.evaluate(async () => { for (let i = 0; i < 60; i++) { const s = await (await fetch("/api/local/state", { headers: { "X-Mowr-Owner": "fixture-owner" } })).json(); const f = s?.files.find((x) => x.name === "Week 3 worksheet.pdf"); if (f) return f; await new Promise((r) => setTimeout(r, 150)); } });
  assert.equal(saved?.folderId, "f-worksheets", "the worksheet lands in Worksheets");
  assert.equal(saved.made, true);

  // Edit a PDF Mowr made: re-typeset, review, keep; undo is offered.
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-folder", { hasText: "Worksheets" }).click();
  // Files open beside a chat in this space; a change request in the composer edits the file.
  const editWithMowr = async (name) => {
    await page.locator(".sp-file", { hasText: name }).getByRole("button", { name: `${name} options` }).click();
    await page.getByRole("menuitem", { name: "Edit with Mowr" }).click();
    await page.locator(".file-panel .ps-page canvas").first().waitFor();
  };
  const askFile = async (text) => { await page.getByLabel("Your message").fill(text); await page.getByLabel("Your message").press("Enter"); };
  await editWithMowr("Cell biology worksheet.pdf");
  await askFile("Make it harder and add an answer key");
  await page.getByText("Made every question harder and added an answer key.").first().waitFor({ timeout: 30000 });
  assert.ok(await page.locator(".ps-mark").count() >= 3, "changed lines are highlighted");
  await page.screenshot({ path: "artifacts/pdf-made-proposal.png" });
  await page.getByRole("button", { name: "Before" }).click();
  await page.getByRole("button", { name: "After" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click(); // edits are saved into the file at once
  await page.getByRole("button", { name: "Undo last edit" }).waitFor();
  assert.match(await pdfText("worksheet"), /Answer key/);
  await page.getByRole("button", { name: "Close file" }).click();

  // Edit someone else's PDF in place.
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  await editWithMowr("Osmosis lab handout.pdf");
  await askFile("Move the due date to Monday and make question 2 more precise");
  await page.getByText("Moved the due date to Monday").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: "artifacts/pdf-handout-proposal.png" });
  await page.getByRole("button", { name: "Done", exact: true }).click(); // edits are saved into the file at once
  await page.getByRole("button", { name: "Undo last edit" }).waitFor();
  const handout = await pdfText("handout");
  assert.match(handout, /Due Monday 29 September/);
  assert.match(handout, /isotonic point to two decimal places/);
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await page.getByRole("button", { name: "Undo edit" }).click();
  await page.getByText("Previous version restored.").waitFor();
  assert.match(await pdfText("handout"), /Due Friday 26 September/);
  await page.getByRole("button", { name: "Close file" }).click();
  await page.evaluate(() => { location.hash = "/app/space/bio"; });

  // Share in one step, then open the file as a friend would.
  await page.locator(".sp-share").click();
  await page.getByRole("checkbox", { name: /Flashcards/ }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /Flashcards/ }).getAttribute("aria-checked"), "true");
  await page.getByRole("checkbox", { name: /Worksheets/ }).click();
  await page.screenshot({ path: "artifacts/share-sheet.png" });
  await page.locator(".sh-foot .primary").click();
  await page.getByText("Drag it into any chat.").waitFor();
  await page.locator(".sh-file").dispatchEvent("dragstart");
  assert.deepEqual(await page.evaluate(() => window.drags), ["C:\\Users\\Sam\\Downloads\\Mowr\\Biology 101.mowrpack"]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: "artifacts/share-done.png" });
  await page.getByRole("button", { name: "Done" }).click();
  await page.evaluate(() => window.firePack(window.lastShare, "Biology 101.mowrpack"));
  await page.getByText("Sam shared a subject").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/pack-open.png" });
  await page.getByRole("button", { name: "Add to Mowr" }).click();
  await page.locator(".space-page .sp-name", { hasText: "Biology 101" }).waitFor();
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-folder", { hasText: "Worksheets" }).getByText("3 items").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS folders on this PC, change notices, search, subject page and tabs, in-app folders, worksheet to folder, real PDF edits with undo, and one-step sharing");
} finally {
  await close();
  await browser.close();
}
