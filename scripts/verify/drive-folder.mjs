// Browser check for a subject's linked Google Drive folder, behind a scripted Drive: its files are listed like the
// files kept here (icons, rename, Source, menu); a dropped file shows at once with a turning ring and goes to Drive
// only (nothing kept on this PC) until "Save on this PC" copies it, or a whole folder; an edit to a Drive file waits for
// approval before Drive gets it; an open menu sits above the cards after it.
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
    { id: "drive-sub-000002", name: "🎞️ Lecture Slides and Recordings", mimeType: "application/vnd.google-apps.folder", folder: true },
    { id: "drive-sub-000003", name: "🤖 AI Notes", mimeType: "application/vnd.google-apps.folder", folder: true },
    { id: "drive-sub-000004", name: "📝 Personal Notes", mimeType: "application/vnd.google-apps.folder", folder: true },
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
  await page.getByRole("button", { name: "Google Drive folder options" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Ask about it" }).count(), 0, "no Ask about it in the folder menu");
  await page.locator(".sp-menu-list").screenshot({ path: "artifacts/drive-folder-menu.png" });
  await page.keyboard.press("Escape"); await page.mouse.click(5, 5);

  // A folder card's menu button sits at its right edge, leaving the name its room, and its open menu is above the next card.
  const slides = drive.locator(".sp-folder", { hasText: "Lecture Slides" });
  const box = await slides.boundingBox(), menuBox = await slides.locator(".sp-menu").boundingBox();
  assert.ok(box.x + box.width - (menuBox.x + menuBox.width) < 24, "menu button at the card's right edge");
  await slides.getByRole("button", { name: /options$/ }).click();
  const list = slides.locator(".sp-menu-list");
  await list.waitFor();
  const lb = await list.boundingBox();
  const top = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".sp-menu-list"), [lb.x + lb.width / 2, lb.y + lb.height - 6]);
  assert.ok(top, "the open menu is not covered by the next card");
  assert.ok(await list.getByRole("menuitem", { name: "Save on this PC" }).count(), "a Drive folder can be saved on this PC");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/drive-folder-card-menu.png", clip: { x: 380, y: lb.y - 120, width: 940, height: 260 } });
  await page.mouse.click(5, 5);

  // Source: a Drive file can be used as a source like any file.
  await row("Lecture notes").getByRole("checkbox").check();
  await saved(page);
  const sources = await page.evaluate(async () => (await (await import("/src/store.ts")).loadState()).spaces[0].sources);
  assert.ok(sources.includes("drive:drive-doc-000001"), "Drive file marked as a source");

  // Drop a file from this PC: it shows at once with a turning ring, is named like any added file (Lec03 → Lecture 3), then a check; it goes to Drive only and is a source there.
  await drive.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(["Lecture 3: genetics and inheritance."], "Lec03.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await row("Lec03.txt").locator(".gd-sync.is-uploading").waitFor({ timeout: 3000 });
  await page.screenshot({ path: "artifacts/drive-drop-uploading.png" });
  await row("Lecture 3.txt").locator(".gd-sync.is-synced").waitFor({ timeout: 5000 });
  assert.equal((await calls("driveUpload")).length, 1);
  assert.equal((await calls("driveUpload"))[0].folder, DRIVE.folderId);
  assert.equal((await calls("driveUpload"))[0].name, "Lecture 3.txt", "named like any added file before it goes to Drive");
  assert.equal(await page.locator(".sp-file-list .sp-file", { hasText: "Lecture 3.txt" }).count(), 1, "listed once, in the Drive folder, not again under On this PC");
  await saved(page);
  const uploadedId = await page.evaluate(() => window.driveCalls.length && "drive-new-" + String(window.driveCalls.findIndex((c) => c.action === "driveUpload") + 1).padStart(6, "0"));
  const kept = await page.evaluate(async (id) => { const s = await (await import("/src/store.ts")).loadState(); return { local: s.files.some((x) => x.name === "Lecture 3.txt"), source: s.spaces[0].sources.includes("drive:" + id) }; }, uploadedId);
  assert.ok(!kept.local, "nothing is kept on this PC");
  assert.ok(kept.source, "used as a source, as the Drive file");

  // Save on this PC: the Drive file is copied under On this PC and stays in Drive.
  await row("Lecture 3.txt").getByRole("button", { name: "Lecture 3.txt options" }).click();
  await page.getByRole("menuitem", { name: "Save on this PC" }).click();
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Lecture 3.txt" }).waitFor({ timeout: 5000 });
  assert.equal(await row("Lecture 3.txt").count(), 1, "still in Drive");
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

  // Save a whole Drive folder on this PC: a folder of the same name under On this PC with its files.
  await drive.locator(".sp-folder", { hasText: "Past papers" }).getByRole("button", { name: /options$/ }).click();
  await page.getByRole("menuitem", { name: "Save on this PC" }).click();
  const localFolder = page.locator(".sp-files > .sp-folders .sp-folder", { hasText: "Past papers" });
  await localFolder.waitFor({ timeout: 5000 });
  await localFolder.click();
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "2024 paper.pdf" }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: "artifacts/drive-folder-saved-on-pc.png" });
  await page.locator(".sp-path button", { hasText: "Files" }).click();

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
  await page.locator(".file-panel").getByRole("button", { name: /close/i }).first().click().catch(() => {});
  await page.screenshot({ path: "artifacts/drive-edit-synced.png" });

  // A real mouse drag of a file from "On this PC" onto the Drive folder saves it there (the browser drops it only when
  // the drop effect matches the drag's, which a scripted drop event never checks).
  await page.evaluate(() => { location.hash = "/app"; }); await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.setViewportSize({ width: 1440, height: 1500 });
  const syllabus = page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Osmosis lab handout.pdf" });
  await syllabus.dragTo(drive.locator(".gd-space-head"));
  await page.waitForFunction(() => window.driveCalls.filter((c) => c.action === "driveUpload").length === 3, null, { timeout: 5000 });
  assert.equal((await calls("driveUpload"))[2].name, "Osmosis lab handout.pdf");
  await row("Osmosis lab handout.pdf").locator(".gd-sync.is-synced").waitFor({ timeout: 8000 });
  await page.screenshot({ path: "artifacts/drive-drag-from-pc.png" });

  // "Add files" under On this PC keeps a file here only: named like any added file, listed under On this PC, never sent to Drive.
  const local = page.locator(".sp-local-head");
  assert.equal(await page.getByRole("menuitem", { name: "Upload to this PC" }).count(), 0);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), local.getByRole("button", { name: "Add files" }).click()]);
  await chooser.setFiles({ name: "Lec05.txt", mimeType: "text/plain", buffer: Buffer.from("Lecture 5: natural selection.") });
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Lecture 5.txt" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(1500);
  assert.equal((await calls("driveUpload")).length, 3, "a file added on this PC is not uploaded to Drive");
  assert.equal(await drive.locator(".sp-file", { hasText: "Lecture 5.txt" }).count(), 0, "not listed in the Drive folder");
  // Its edits approved later stay local too, even with "Save Mowr's files" on.
  await saved(page);
  const localFile = await page.evaluate(async () => (await (await import("/src/store.ts")).loadState()).files.find((x) => x.name === "Lecture 5.txt"));
  assert.ok(localFile && !localFile.driveId && !localFile.driveFolder && !localFile.made, "kept on this PC only");
  await local.getByRole("button", { name: "On this PC options" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Worksheets");
  await page.getByLabel("New folder name").press("Enter");
  await page.locator(".sp-files > .sp-folders .sp-folder", { hasText: "Worksheets" }).waitFor();
  await page.screenshot({ path: "artifacts/drive-on-this-pc.png" });

  assert.deepEqual(errors, []);
  console.log("Drive folder: listed like local files, drops sync with ring then check, sources, rename, approval-gated edits, drag from On this PC, local-only Add files all pass.");
} catch (e) { await page.screenshot({ path: "artifacts/drive-folder-failure.png" }).catch(() => {}); throw e; } finally {
  await close();
  await browser.close();
}
