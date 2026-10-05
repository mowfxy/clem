// Browser check for a subject's linked Google Drive folder, behind a scripted Drive: its files are listed like the
// files kept here (icons, rename, Source, menu); a dropped file shows at once with a turning ring, is kept in the
// subject and turns into a check once Drive has it; an edit to a Drive file waits for approval before Drive gets it.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { saved, openFixture, workspace } from "./local-power-fixture.mjs";
import { handoutPdf } from "./fixture-docs.mjs";

await mkdir("artifacts", { recursive: true });
const DRIVE = { folderId: "drive-folder-0001", folderName: "Biology (Drive)", saveBack: true };
workspace.spaces[0].drive = DRIVE;
const browser = await chromium.launch();
const handout = await handoutPdf(browser);
// The scripted Drive: a folder with a subfolder, a PDF and a Google Doc; uploads take a moment, like the real thing.
const driveScript = () => {
  const items = [
    { id: "drive-sub-000001", name: "Past papers", mimeType: "application/vnd.google-apps.folder", folder: true },
    { id: "drive-pdf-000001", name: "Lab handout.pdf", mimeType: "application/pdf", size: 52000, modified: new Date(Date.now() - 864e5).toISOString() },
    { id: "drive-doc-000001", name: "Lecture notes", mimeType: "application/vnd.google-apps.document", modified: new Date(Date.now() - 3 * 864e5).toISOString() },
    { id: "drive-pdf-000002", name: "2024 paper.pdf", mimeType: "application/pdf", size: 81000, path: "Past papers", modified: new Date().toISOString() },
  ];
  window.driveCalls = [];
  let real;
  Object.defineProperty(window, "mowrDesktop", { configurable: true, get: () => real, set: (bridge) => {
    const invoke = bridge.invoke;
    real = { ...bridge, invoke: async (r) => {
      if (!String(r.action).startsWith("drive")) return invoke(r);
      window.driveCalls.push({ ...r, data: r.data ? r.data.length : undefined });
      switch (r.action) {
        case "driveStatus": return { connected: true, checked: true };
        case "driveFolder": return { items: items.map((i) => ({ ...i })), hits: [], checked: Date.now() };
        case "driveUpload": { await new Promise((ok) => setTimeout(ok, 1500)); const id = "drive-new-" + window.driveCalls.length.toString().padStart(6, "0"); const parent = items.find((i) => i.id === r.folder); items.push({ id, name: r.name, mimeType: r.type, size: r.data.length, modified: new Date().toISOString(), ...(parent ? { path: parent.name } : {}) }); return { id, modifiedTime: new Date().toISOString() }; }
        case "driveUpdate": { await new Promise((ok) => setTimeout(ok, 800)); const f = items.find((i) => i.id === r.id); f.modified = new Date().toISOString(); return { id: r.id, modifiedTime: f.modified }; }
        case "driveRename": { const f = items.find((i) => i.id === r.id); f.name = r.name; f.modified = new Date().toISOString(); return { id: r.id, name: r.name, modifiedTime: f.modified }; }
        case "driveTrash": items.splice(items.findIndex((i) => i.id === r.id), 1); return { ok: true };
        default: return {};
      }
    } };
  } });
};
const { page, errors, close } = await openFixture(browser, { port: 5199, initScripts: [driveScript] });
await page.route("**/api/drive/live/**", (r) => r.fulfill({ body: Buffer.from(handout), contentType: "application/pdf" }));
const calls = (action) => page.evaluate((a) => window.driveCalls.filter((c) => c.action === a), action);
try {
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  const drive = page.locator(".gd-space");
  const row = (name) => drive.locator(".sp-file", { hasText: name });
  await row("Lab handout.pdf").waitFor();

  // Listed like local files: file icon, rename, Source and menu; no "Live" pill; Google Docs get a document icon.
  assert.equal(await drive.getByText("Live", { exact: true }).count(), 0, "no Live pill");
  assert.equal(await page.locator(".sp-drive-chip small").count(), 0, "no live label on the Drive chip");
  for (const name of ["Lab handout.pdf", "Lecture notes"]) {
    await row(name).locator(".file-glyph").waitFor();
    await row(name).getByRole("button", { name: `Rename ${name}` }).waitFor();
    await row(name).getByText("Source").waitFor();
    await row(name).getByRole("button", { name: `${name} options` }).waitFor();
    await row(name).locator(".gd-sync.is-synced").waitFor();
  }
  assert.ok(await row("Lecture notes").locator(".fg-doc").count(), "a Google Doc shows the document icon");
  await drive.locator(".sp-folder", { hasText: "Past papers" }).waitFor();
  await page.screenshot({ path: "artifacts/drive-folder.png" });

  // Source: a Drive file can be used as a source like any file.
  await row("Lecture notes").getByRole("checkbox").check();
  await saved(page);
  const sources = await page.evaluate(async () => (await (await import("/src/store.ts")).loadState()).spaces[0].sources);
  assert.ok(sources.includes("drive:drive-doc-000001"), "Drive file marked as a source");

  // Drop a file from this PC: it shows at once with a turning ring, then a check; it is kept here and is a source.
  await drive.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["Week 4 notes: genetics and inheritance."], "Week 4 notes.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await row("Week 4 notes.txt").locator(".gd-sync.is-uploading").waitFor({ timeout: 1000 });
  await page.screenshot({ path: "artifacts/drive-drop-uploading.png" });
  await row("Week 4 notes.txt").locator(".gd-sync.is-synced").waitFor({ timeout: 5000 });
  assert.equal((await calls("driveUpload")).length, 1);
  assert.equal((await calls("driveUpload"))[0].folder, DRIVE.folderId);
  assert.equal(await page.locator(".sp-file-list .sp-file", { hasText: "Week 4 notes.txt" }).count(), 1, "listed once, in the Drive folder, not again under On this PC");
  await saved(page);
  const kept = await page.evaluate(async () => { const s = await (await import("/src/store.ts")).loadState(); const f = s.files.find((x) => x.name === "Week 4 notes.txt"); return { f, source: s.spaces[0].sources.includes(f?.id) }; });
  assert.ok(kept.f?.driveId && kept.source, "kept here, linked to its Drive file, and used as a source");
  await page.screenshot({ path: "artifacts/drive-drop-synced.png" });

  // Dropping onto a Drive subfolder saves into that subfolder.
  await drive.locator(".sp-folder", { hasText: "Past papers" }).evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["2023 paper"], "2023 paper.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await drive.locator(".sp-folder", { hasText: "Past papers" }).locator(".gd-sync.is-uploading").waitFor({ timeout: 1000 });
  await page.waitForFunction(() => window.driveCalls.filter((c) => c.action === "driveUpload").length === 2);
  assert.equal((await calls("driveUpload"))[1].folder, "drive-sub-000001");

  // Rename in Drive.
  await row("Lab handout.pdf").getByRole("button", { name: "Rename Lab handout.pdf" }).click();
  await page.getByLabel("File name").fill("Osmosis handout");
  await page.getByLabel("File name").press("Enter");
  await row("Osmosis handout.pdf").waitFor();
  assert.deepEqual((await calls("driveRename")).map((c) => [c.id, c.name]), [["drive-pdf-000001", "Osmosis handout.pdf"]]);

  // Edit a Drive PDF with Mowr: the change waits for approval; Done sends it to the same Drive file.
  await row("Osmosis handout.pdf").getByRole("button", { name: "Osmosis handout.pdf options" }).click();
  await page.getByRole("menuitem", { name: "Edit with Mowr" }).click();
  await page.locator(".file-panel .ps-page canvas").first().waitFor();
  await page.getByLabel("Your message").fill("Move the due date to Monday and make question 2 more precise");
  await page.getByLabel("Your message").press("Enter");
  await page.getByText("Moved the due date to Monday").first().waitFor({ timeout: 30000 });
  await page.locator(".file-panel .fp-sync.is-pending").waitFor();
  assert.equal((await calls("driveUpdate")).length, 0, "nothing goes to Drive before approval");
  await page.screenshot({ path: "artifacts/drive-edit-pending.png" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator(".file-panel .fp-sync.is-synced").waitFor({ timeout: 5000 });
  assert.deepEqual((await calls("driveUpdate")).map((c) => c.id), ["drive-pdf-000001"], "the same Drive file gets the approved version");
  assert.equal((await calls("driveUpload")).length, 2, "no second copy is made in Drive");
  await page.screenshot({ path: "artifacts/drive-edit-synced.png" });

  assert.deepEqual(errors, []);
  console.log("Drive folder: listed like local files, drops sync with ring then check, sources, rename, approval-gated edits all pass.");
} finally {
  await close();
  await browser.close();
}
