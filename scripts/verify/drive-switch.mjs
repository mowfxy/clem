// Browser check for a subject with several linked Google Drive folders: the folder name in the Drive header opens the
// list of linked folders (and files added one by one from elsewhere in Drive), picking one shows it with its own
// subfolders, and "Link another folder" sits at the bottom. There is no separate "From elsewhere" section.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openFixture, workspace } from "./local-power-fixture.mjs";

await mkdir("artifacts", { recursive: true });
workspace.spaces[0].drive = { folderId: "drive-folder-0001", folderName: "Electric Circuits I", saveBack: true };
workspace.spaces[0].drives = [{ folderId: "drive-folder-0002", folderName: "Shared lab notes", saveBack: true }];
workspace.spaces[0].driveFiles = [{ id: "drive-loose-000001", name: "Formula sheet.pdf", mimeType: "application/pdf", size: 41000, modified: new Date().toISOString() }];
const driveScript = () => {
  const folders = {
    "drive-folder-0001": [
      { id: "drive-sub-000001", name: "Past papers", mimeType: "application/vnd.google-apps.folder", folder: true },
      { id: "drive-pdf-000001", name: "Kirchhoff laws.pdf", mimeType: "application/pdf", size: 52000, modified: new Date().toISOString() },
      { id: "drive-pdf-000002", name: "2024 paper.pdf", mimeType: "application/pdf", size: 81000, path: "Past papers", modified: new Date().toISOString() },
    ],
    "drive-folder-0002": [
      { id: "drive-sub-000009", name: "Week 3", mimeType: "application/vnd.google-apps.folder", folder: true },
      { id: "drive-pdf-000009", name: "Oscilloscope guide.pdf", mimeType: "application/pdf", size: 22000, modified: new Date().toISOString() },
      { id: "drive-pdf-000010", name: "RC circuits.pdf", mimeType: "application/pdf", size: 22000, path: "Week 3", modified: new Date().toISOString() },
    ],
  };
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    const invoke = bridge.invoke;
    real = { ...bridge, invoke: async (r) => {
      if (!String(r.action).startsWith("drive")) return invoke(r);
      if (r.action === "driveStatus") return { connected: true, checked: true };
      if (r.action === "driveFolder") return { items: (folders[r.folder] || []).map((i) => ({ ...i })), hits: [], checked: Date.now() };
      return {};
    } };
  } });
};
const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5197, initScripts: [driveScript], viewport: { width: 1333, height: 790 }, deviceScaleFactor: 1.5 });
try {
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  const drive = page.locator(".gd-space");
  await drive.locator(".sp-file", { hasText: "Kirchhoff laws.pdf" }).waitFor();
  assert.equal(await page.getByText("From elsewhere in Drive").count(), 0, "no separate From elsewhere section");
  assert.equal(await page.locator(".gd-extras").count(), 0, "older Drive files are not a section while a folder is linked");
  await page.screenshot({ path: "artifacts/drive-switch-1.png" });

  const button = drive.locator(".gd-switch-button");
  await button.click();
  const list = page.getByRole("menu", { name: "Linked Drive folders" });
  const entries = await list.locator("button").allInnerTexts();
  assert.deepEqual(entries.map((t) => t.replace(/\s+/g, " ").trim()), ["Electric Circuits I Shown", "Shared lab notes", "Other Drive files 1", "Link another folder"]);
  await page.screenshot({ path: "artifacts/drive-switch-2.png" });

  await list.getByRole("menuitemradio", { name: /Shared lab notes/ }).click();
  await drive.locator(".sp-file", { hasText: "Oscilloscope guide.pdf" }).waitFor();
  assert.match(await button.innerText(), /Shared lab notes/);
  // Its own subfolders open like any folder.
  await drive.locator(".sp-folder", { hasText: "Week 3" }).click();
  await drive.locator(".sp-file", { hasText: "RC circuits.pdf" }).waitFor();
  await page.screenshot({ path: "artifacts/drive-switch-3.png" });

  await button.click();
  await list.getByRole("menuitemradio", { name: /Other Drive files/ }).click();
  await drive.locator(".sp-file", { hasText: "Formula sheet.pdf" }).waitFor();
  assert.match(await button.innerText(), /Other Drive files/);
  await button.click();
  await list.getByRole("menuitemradio", { name: /Electric Circuits I/ }).click();
  await drive.locator(".sp-file", { hasText: "Kirchhoff laws.pdf" }).waitFor();
  await page.locator(".workspace-top").screenshot({ path: "artifacts/drive-switch-topbar.png" }).catch(() => {});
  assert.deepEqual(errors, []);
  console.log("drive-switch: ok");
} finally { await close(); await browser.close(); }
