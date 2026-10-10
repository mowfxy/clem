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
        case "driveMove": { await new Promise((ok) => setTimeout(ok, 300)); const full = (i) => (i.path ? i.path + " / " : "") + i.name; const m = items.find((i) => i.id === r.id), to = items.find((i) => i.id === r.to); const own = full(m), dest = to ? full(to) : ""; for (const i of items) if (m.folder && i.path && (i.path === own || i.path.startsWith(own + " / "))) i.path = (dest ? dest + " / " : "") + m.name + i.path.slice(own.length); if (dest) m.path = dest; else delete m.path; return { ok: true }; }
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

  // Drag to move inside Drive: a file onto a folder card, a folder into another folder, and back up by the path.
  await page.setViewportSize({ width: 1440, height: 1500 });
  const card = (name) => drive.locator(".sp-folder", { hasText: name });
  await row("Lecture notes").dragTo(card("Past papers"));
  await page.waitForFunction(() => window.driveCalls.some((c) => c.action === "driveMove"));
  assert.deepEqual((await calls("driveMove")).map((c) => [c.id, c.to, c.root]), [["drive-doc-000001", "drive-sub-000001", DRIVE.folderId]]);
  await page.waitForFunction(() => !document.querySelector(".gd-space > .sp-file-list")?.textContent?.includes("Lecture notes"), null, { timeout: 3000 });
  await card("AI Notes").dragTo(card("Personal Notes"));
  await page.waitForFunction(() => window.driveCalls.filter((c) => c.action === "driveMove").length === 2);
  assert.deepEqual((await calls("driveMove"))[1].to, "drive-sub-000004");
  await card("AI Notes").waitFor({ state: "detached", timeout: 3000 });
  await card("Personal Notes").click();
  await card("AI Notes").waitFor({ timeout: 3000 });
  await page.screenshot({ path: "artifacts/drive-moved-into-folder.png" });
  await card("AI Notes").dragTo(drive.locator(".gd-trail .gd-crumb").first());
  await page.waitForFunction(() => window.driveCalls.filter((c) => c.action === "driveMove").length === 3);
  assert.equal((await calls("driveMove"))[2].to, DRIVE.folderId, "dropped on the path, back to the top");
  await drive.locator(".gd-trail .gd-crumb").first().click();
  await card("AI Notes").waitFor({ timeout: 3000 });
  await card("Past papers").click();
  await row("Lecture notes").waitFor({ timeout: 3000 });
  await drive.locator(".gd-trail .gd-crumb").first().click();
  // A file from On this PC dropped on a Drive folder card goes into that folder (and stays on this PC).
  const uploadsBefore = (await calls("driveUpload")).length;
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Biology 101 syllabus.txt" }).dragTo(card("Personal Notes"));
  await page.waitForFunction((n) => window.driveCalls.filter((c) => c.action === "driveUpload").length === n + 1, uploadsBefore, { timeout: 5000 });
  assert.equal((await calls("driveUpload"))[uploadsBefore].folder, "drive-sub-000004");
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Biology 101 syllabus.txt" }).waitFor();

  // "Add files" under On this PC keeps a file here only: named like any added file, listed under On this PC, never sent to Drive.
  const local = page.locator(".sp-local-head");
  assert.equal(await page.getByRole("menuitem", { name: "Upload to this PC" }).count(), 0);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), local.getByRole("button", { name: "Add files" }).click()]);
  await chooser.setFiles({ name: "Lec05.txt", mimeType: "text/plain", buffer: Buffer.from("Lecture 5: natural selection.") });
  await page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Lecture 5.txt" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(1500);
  assert.equal((await calls("driveUpload")).length, 4, "a file added on this PC is not uploaded to Drive");
  assert.equal(await drive.locator(".sp-file", { hasText: "Lecture 5.txt" }).count(), 0, "not listed in the Drive folder");
  // Its edits approved later stay local too, even with "Save Mowr's files" on.
  await saved(page);
  const localFile = await page.evaluate(async () => (await (await import("/src/store.ts")).loadState()).files.find((x) => x.name === "Lecture 5.txt"));
  assert.ok(localFile && !localFile.driveId && !localFile.driveFolder && !localFile.made, "kept on this PC only");
  // A folder button beside Add files makes a folder on this PC (no menu to open first).
  await local.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Worksheets");
  await page.getByLabel("New folder name").press("Enter");
  await page.locator(".sp-files > .sp-folders .sp-folder", { hasText: "Worksheets" }).waitFor();
  await page.screenshot({ path: "artifacts/drive-on-this-pc.png" });
  // Reordering by a card's ☰ handle: press and drag places it among its neighbours; a plain click still opens the menu.
  await local.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Archive");
  await page.getByLabel("New folder name").press("Enter");
  const pcFolders = page.locator(".sp-files > .sp-folders .sp-folder");
  const names = async () => (await pcFolders.locator("strong").allInnerTexts());
  await pcFolders.filter({ hasText: "Archive" }).waitFor();
  const before = await names();
  assert.ok(before.indexOf("Archive") < before.indexOf("Worksheets"), "by name until arranged");
  const movesBefore = (await calls("driveMove")).length, uploadsNow = (await calls("driveUpload")).length;
  const handle = pcFolders.filter({ hasText: "Worksheets" }).getByRole("button", { name: "Worksheets options" });
  await pcFolders.filter({ hasText: "Worksheets" }).scrollIntoViewIfNeeded();
  const to = await pcFolders.filter({ hasText: "Archive" }).boundingBox();
  const from = await handle.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x + 40 - from.x) * i / 8, from.y + (to.y + to.height / 2 - from.y) * i / 8);
  await page.mouse.up();
  await page.waitForFunction(() => { const n = [...document.querySelectorAll(".sp-files > .sp-folders .sp-folder strong")].map((x) => x.textContent); return n.indexOf("Worksheets") < n.indexOf("Archive"); }, null, { timeout: 3000 });
  assert.equal(await page.getByRole("menuitem").count(), 0, "a drag does not open the menu");
  assert.equal((await calls("driveMove")).length, movesBefore, "reordering never moves anything in Drive");
  assert.equal((await calls("driveUpload")).length, uploadsNow);
  await saved(page);
  const ranks = await page.evaluate(async () => (await (await import("/src/store.ts")).loadState()).spaces.flatMap((x) => x.folders || []).filter((f) => ["Worksheets", "Archive"].includes(f.name)).map((f) => [f.name, f.rank, f.parentId]));
  assert.deepEqual(ranks.sort().map((r) => r[2]), [null, null], "both stay where they were");
  assert.ok(ranks.find((r) => r[0] === "Worksheets")[1] < ranks.find((r) => r[0] === "Archive")[1], "the order is kept");
  // A click on the same ☰ opens its menu: words only, no icons on the left.
  await handle.click();
  await page.getByRole("menuitem", { name: "Rename" }).waitFor();
  assert.equal(await page.locator(".sp-menu-list svg").count(), 0, "menu items carry no icons");
  await page.screenshot({ path: "artifacts/folder-menu.png" });
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // Select: picked files drag together onto a folder, and move together.
  await page.getByRole("button", { name: "Lecture 5.txt options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "Delete" }).evaluate((el) => getComputedStyle(el).color), "rgb(255, 90, 78)");
  await page.locator(".sp-menu-list").last().screenshot({ path: "artifacts/file-menu.png" });
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  const pcFile = (name) => page.locator(".sp-files > .sp-file-list .sp-file", { hasText: name });
  for (const name of ["Biology 101 syllabus.txt", "Lecture 5.txt"]) {
    await page.getByRole("button", { name: `${name} options` }).click();
    await page.getByRole("menuitem", { name: "Select" }).click();
  }
  await page.getByText("2 selected", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/on-this-pc-selected.png" });
  await pcFile("Lecture 5.txt").dragTo(pcFolders.filter({ hasText: "Archive" }));
  await page.waitForFunction(() => !document.querySelector(".sp-files > .sp-file-list")?.textContent?.includes("Lecture 5.txt") && !document.querySelector(".sp-files > .sp-file-list")?.textContent?.includes("Biology 101 syllabus.txt"), null, { timeout: 3000 });
  assert.equal(await page.getByText("2 selected", { exact: true }).count(), 0, "the pick clears after the move");
  await saved(page);
  const moved = await page.evaluate(async () => { const st = await (await import("/src/store.ts")).loadState(); const archive = st.spaces.flatMap((x) => x.folders || []).find((f) => f.name === "Archive"); return st.files.filter((f) => f.folderId === archive.id).map((f) => f.name).sort(); });
  assert.deepEqual(moved, ["Biology 101 syllabus.txt", "Lecture 5.txt"]);
  assert.equal((await calls("driveUpload")).length, uploadsNow, "moving on this PC sends nothing to Drive");

  // A PDF Mowr makes lands under On this PC, even with the old "Save Mowr's files" setting on: nothing goes to Drive by itself.
  const uploadsMade = (await calls("driveUpload")).length;
  await page.evaluate(async () => {
    const store = await import("/src/store.ts");
    const id = "made-notes-0001";
    await store.storeBlob(id, new Blob(["%PDF-1.4 made by Mowr"], { type: "application/pdf" }));
    window.dispatchEvent(new CustomEvent("mowr:artifact", { detail: { file: { id, name: "Stacks revision notes.pdf", size: 21, type: "application/pdf", created: Date.now(), spaceId: "bio", made: true }, scope: "subject:bio" } }));
  });
  const madeRow = page.locator(".sp-files > .sp-file-list .sp-file", { hasText: "Stacks revision notes.pdf" });
  await madeRow.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1500);
  assert.equal((await calls("driveUpload")).length, uploadsMade, "a made file is not uploaded to Drive by itself");
  // "Save copy in Drive" in its menu: a copy goes to the Drive folder (with the ring, then the check) and the file stays here.
  await madeRow.getByRole("button", { name: "Stacks revision notes.pdf options" }).click();
  await page.getByRole("menuitem", { name: "Save copy in Drive" }).click();
  await row("Stacks revision notes.pdf").locator(".gd-sync.is-synced").waitFor({ timeout: 8000 });
  assert.equal((await calls("driveUpload")).length, uploadsMade + 1);
  assert.equal((await calls("driveUpload"))[uploadsMade].folder, DRIVE.folderId);
  assert.equal(await madeRow.count(), 1, "still on this PC");
  await page.screenshot({ path: "artifacts/drive-save-copy.png" });

  assert.deepEqual(errors, []);
  console.log("Drive folder: listed like local files, drops sync with ring then check, sources, rename, approval-gated edits, drag from On this PC, drag to move inside Drive, local-only Add files all pass.");
} catch (e) { await page.screenshot({ path: "artifacts/drive-folder-failure.png" }).catch(() => {}); throw e; } finally {
  await close();
  await browser.close();
}
