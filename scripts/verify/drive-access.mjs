// Browser check for Clem's Drive access under drive.file, behind a scripted Drive: Settings → Connectors → Google Drive →
// Manage lists what Clem can open (a chosen folder says how many items inside it Clem can open, or that only the folder
// was chosen); Choose in Google Drive waits for Google's picker and shows what came back; Remove takes an item out with
// Undo; opening a folder shows the chosen files inside it. The chat's Drive picker starts from the same list.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

await mkdir("artifacts", { recursive: true });
const F = "application/vnd.google-apps.folder";
const driveScript = ({ F }) => {
  const access = [
    { id: "course-0000001", name: "Biology 101", mimeType: F, folder: true, inside: 3 },
    { id: "lonely-0000001", name: "Past papers", mimeType: F, folder: true, inside: 0 },
    { id: "pdf-000000001", name: "Syllabus.pdf", mimeType: "application/pdf", size: 52000, modified: new Date(Date.now() - 864e5).toISOString() },
  ];
  const inside = { "course-0000001": [
    { id: "week-00000001", name: "Week 1", mimeType: F, folder: true },
    { id: "doc-000000001", name: "Lecture notes", mimeType: "application/vnd.google-apps.document", modified: new Date().toISOString() },
    { id: "pdf-000000002", name: "Lab handout.pdf", mimeType: "application/pdf", size: 81000, modified: new Date().toISOString() },
  ] };
  const hidden = new Set();
  let polls = 0;
  window.driveCalls = [];
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    const invoke = bridge.invoke;
    real = { ...bridge, invoke: async (r) => {
      if (!String(r.action).startsWith("drive")) return invoke(r);
      window.driveCalls.push(r);
      await new Promise((ok) => setTimeout(ok, 120));
      switch (r.action) {
        case "driveStatus": return { connected: true, checked: true };
        case "driveList": { const all = !r.folder || r.folder === "access" ? access : inside[r.folder] || []; return { connected: true, files: all.filter((f) => !hidden.has(f.id)) }; }
        case "driveConnect": polls = 0; return { ok: true };
        case "drivePicked": {
          if (++polls < 2) return { done: false, files: [] };
          const got = { id: "pick-00000001", name: "Chapter 4 reading.pdf", mimeType: "application/pdf", size: 120000, modified: new Date().toISOString() };
          if (!access.some((a) => a.id === got.id)) access.push(got);
          return { done: true, files: [got] };
        }
        case "driveAccess": for (const id of r.hide || []) hidden.add(id); for (const id of r.show || []) hidden.delete(id); return { ok: true };
        default: return {};
      }
    } };
  } });
};
const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5201, initScripts: [[driveScript, { F }]].map(([fn, arg]) => ({ content: `(${fn})(${JSON.stringify(arg)})` })) });
try {
  await page.evaluate(() => { location.hash = "/app/connectors"; });
  await page.getByRole("button", { name: "Manage" }).first().waitFor();
  await page.locator(".st-row", { has: page.locator("h4", { hasText: "Google Drive" }) }).getByRole("button", { name: "Manage" }).first().click();
  const panel = page.locator(".gd-access");
  await panel.getByText("Biology 101").waitFor();
  assert.ok(await panel.getByText("3 items inside Clem can open").count(), "a chosen folder counts what Clem can open in it");
  assert.ok(await panel.getByText("Only the folder · choose its files too").count(), "a folder chosen alone says so");
  assert.ok(await panel.locator(".gd-row", { hasText: "Past papers" }).getByRole("button", { name: "Choose its files" }).count(), "a folder chosen alone offers to choose its files");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/drive-access.png" });

  // Choose in Google Drive: waits for the browser, then the chosen file is in the list.
  await panel.getByRole("button", { name: "Choose in Google Drive" }).first().click();
  await panel.locator(".gd-choosing").waitFor();
  await page.screenshot({ path: "artifacts/drive-access-choosing.png" });
  await panel.getByText("Chapter 4 reading.pdf").waitFor({ timeout: 15000 });
  assert.equal(await panel.locator(".gd-choosing").count(), 0, "the note goes once the choice is back");

  // Remove, then Undo.
  const syllabus = panel.locator(".gd-row", { hasText: "Syllabus.pdf" });
  await syllabus.hover();
  await syllabus.getByRole("button", { name: "Remove Syllabus.pdf from Clem's access" }).click();
  await panel.getByText(/Removed/).waitFor();
  await page.waitForFunction(() => !document.querySelector(".gd-access")?.textContent?.includes("Syllabus.pdf · "), null, { timeout: 5000 }).catch(() => {});
  assert.equal(await panel.locator(".gd-row", { hasText: "Syllabus.pdf" }).count(), 0, "a removed item leaves the list");
  await page.screenshot({ path: "artifacts/drive-access-removed.png" });
  await panel.getByRole("button", { name: "Undo" }).click();
  await panel.locator(".gd-row", { hasText: "Syllabus.pdf" }).waitFor();

  // Inside a chosen folder: its chosen files, and the note about choosing more.
  await panel.locator(".gd-row", { hasText: "Biology 101" }).locator(".gd-open").click();
  await panel.getByText("Lab handout.pdf").waitFor();
  await panel.locator(".gd-inside-note").waitFor();
  await page.screenshot({ path: "artifacts/drive-access-folder.png" });
  await panel.getByRole("button", { name: "Done" }).click();

  // The chat's Drive picker starts from what Clem can open.
  await page.evaluate(() => { location.hash = "/app"; });
  const calls = await page.evaluate(() => window.driveCalls.map((c) => c.action + (c.folder ? ":" + c.folder : "")));
  assert.ok(calls.includes("driveList:access"), "the access list is read");
  assert.ok(calls.some((c) => c === "driveAccess"), "remove and undo reach the desktop");
  assert.deepEqual(errors, [], "no page errors");
  console.log("drive access ok");
} finally { await close(); await browser.close(); }
