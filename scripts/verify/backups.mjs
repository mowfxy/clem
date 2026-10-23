// Settings → Data & privacy → Backups and Restore, in the demo workspace with a scripted bridge for the backup actions.
//   node scripts/verify/backups.mjs   → test-results/backups-*.png
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { openFixture } from "./local-power-fixture.mjs";

const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5196, initScripts: [() => {
  const state = { schedule: "off", keep: 7, passphrase: false, running: false };
  const summary = { createdAt: Date.now() - 3600_000, app: "0.3.0", kind: "manual", chats: 2, subjects: 1, projects: 0, files: 4, folders: 2, studySets: 1, cards: 5, reviewed: 3, automations: 1, edits: 0, bytes: 2_400_000 };
  const items = [{ source: "folder", path: "C:\\Users\\Sam\\OneDrive\\Clem backups\\Clem backup 2026-10-23 0930.clembackup", name: "Clem backup 2026-10-23 0930.clembackup", at: summary.createdAt, size: 2_100_000 }];
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    const invoke = bridge.invoke;
    real = { ...bridge, invoke: async (r) => {
      switch (r.action) {
        case "backupStatus": return { ...state };
        case "backupConfigure":
          if (r.chooseFolder) state.destination = { kind: "folder", path: "C:\\Users\\Sam\\OneDrive\\Clem backups" };
          if (r.destination) state.destination = r.destination;
          if (r.passphrase) state.passphrase = true;
          if (r.schedule) state.schedule = r.schedule;
          if (r.keep) state.keep = r.keep;
          return { ...state };
        case "backupNow": window.requests.push(r); await new Promise((go) => setTimeout(go, 300)); state.last = { at: Date.now(), tried: Date.now(), size: 2_100_000 }; return { ok: true };
        case "backupList": return { items };
        case "backupPreview": if (r.passphrase === "wrong") throw Error("That passphrase doesn't open this backup, or the file is damaged."); return { summary, current: { chats: 2, subjects: 1, projects: 0, files: 4, folders: 2, studySets: 1, cards: 5, reviewed: 0, automations: 0, empty: false } };
        case "backupRestore": window.requests.push(r); return { restored: true };
        default: return invoke(r);
      }
    } };
  } });
}] });
try {
  await page.locator(".profile-settings").click();
  await page.getByRole("button", { name: "Data & privacy" }).click();
  await page.getByRole("heading", { name: "Backups" }).waitFor();
  assert.ok(await page.getByText("Not chosen yet").isVisible());
  assert.ok(await page.getByRole("button", { name: "Back up now" }).isDisabled(), "nothing to back up to yet");
  await page.getByRole("button", { name: "Folder…" }).click();
  await page.getByText("C:\\Users\\Sam\\OneDrive\\Clem backups").waitFor();
  await page.getByRole("button", { name: "Set passphrase" }).click();
  await page.getByLabel("Backup passphrase").fill("correct horse battery");
  await page.getByLabel("Type the passphrase again").fill("correct horse battery");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Set. You'll need it to restore on another PC.").waitFor();
  await page.getByRole("radio", { name: "Daily" }).click();
  await page.getByText(/Every day, while Clem is open or in the tray/).waitFor();
  await page.getByRole("button", { name: "Back up now" }).click();
  await page.getByText(/Last backed up/).waitFor();
  await page.screenshot({ path: "test-results/backups-settings.png" });

  await page.getByRole("button", { name: "Restore…" }).click();
  const dialog = page.locator("dialog.settings-dialog");
  await dialog.getByRole("option").first().waitFor();
  await dialog.getByLabel("Backup passphrase").fill("wrong");
  await dialog.getByRole("button", { name: "See what's inside" }).click();
  await page.getByText(/doesn't open this backup/).first().waitFor();
  await dialog.getByLabel("Backup passphrase").fill("");
  await dialog.getByRole("button", { name: "See what's inside" }).click();
  await dialog.getByText(/2 chats, 1 subject, 4 files, 2 folders, 5 cards \(3 with review history\), 1 routine/).waitFor();
  await page.screenshot({ path: "test-results/backups-restore.png" });
  await dialog.getByRole("button", { name: "Restore this backup" }).click();
  await page.getByRole("heading", { name: "Replace your workspace?" }).waitFor();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await dialog.getByText("Restored. Clem is reloading…").waitFor();
  const sent = await page.evaluate(() => window.requests.filter((r) => r.action?.startsWith("backup")));
  assert.deepEqual(sent.map((r) => r.action), ["backupNow", "backupRestore"]);
  assert.equal(sent[1].confirmed, true);
  assert.equal(sent[1].item.source, "folder");
  assert.deepEqual(errors, []);
  console.log("backups: settings, back up now, preview and restore work");
} finally { await close(); await browser.close(); }
