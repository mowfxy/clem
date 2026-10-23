// Backups read and restore document edits in the window's IndexedDB (desktop/backup-service.ts). This runs those
// scripts in the real Electron window, on a throwaway profile, next to what idb-keyval itself wrote.
//   npm run desktop:build && node scripts/verify/backup-edits.mjs
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readEditsScript, writeEditsScript } from "../../desktop/backup-service.ts";

const userData = await mkdtemp(join(tmpdir(), "clem-backup-edits-"));
const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData], timeout: 30000 });
const inWindow = (script) => app.evaluate(({ BrowserWindow }, script) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("clem://app/")).webContents.executeJavaScript(script), script);
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "Welcome to Clem." }).waitFor();
  // What idb-keyval keeps for the workspace (its default "keyval-store" / "keyval"): an edited document, a workflow
  // checkpoint, a cached source, an OCR page.
  await page.evaluate(async () => {
    const put = async (key, value) => {
      const db = await new Promise((ok, no) => { const r = indexedDB.open("keyval-store"); r.onupgradeneeded = () => r.result.createObjectStore("keyval"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      await new Promise((ok, no) => { const tx = db.transaction("keyval", "readwrite"); tx.objectStore("keyval").put(value, key); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
      db.close();
    };
    await put("clem-document-f1", { revision: 3, content: { text: "Edited text", notes: [{ page: 1, text: "Note" }] } });
    await put("clem-workflow:owner-a:plan1", { signature: "abc", tasks: [{ id: "t", status: "done" }], updatedAt: 5 });
    await put("clem-workflow:owner-b:plan9", { signature: "other account", tasks: [], updatedAt: 1 });
    await put("clem-source:owner-a:f1", { stamp: "x", text: "cached" });
    await put("clem-ocr:k:1", "page text");
  });
  const read = JSON.parse(await inWindow(readEditsScript("owner-a")));
  assert.deepEqual(read.map(([k]) => k).sort(), ["clem-document-f1", "clem-workflow:owner-a:plan1"], "only this account's edits and checkpoints are backed up");
  assert.deepEqual(read.find(([k]) => k === "clem-document-f1")[1], { revision: 3, content: { text: "Edited text", notes: [{ page: 1, text: "Note" }] } });

  // A restore replaces them with the backup's, drops the old cached source, and leaves other accounts and OCR alone.
  await inWindow(writeEditsScript("owner-a", [["clem-document-f7", { revision: 1, content: { text: "From the backup </script>   ${x}" } }], ["clem-workflow:owner-a:plan2", { signature: "s", tasks: [], updatedAt: 2 }], ["not-ours", 1]]));
  const all = await page.evaluate(async () => {
    const db = await new Promise((ok) => { const r = indexedDB.open("keyval-store"); r.onsuccess = () => ok(r.result); });
    const store = db.transaction("keyval").objectStore("keyval");
    const [keys, values] = await Promise.all([new Promise((ok) => { const r = store.getAllKeys(); r.onsuccess = () => ok(r.result); }), new Promise((ok) => { const r = store.getAll(); r.onsuccess = () => ok(r.result); })]);
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  });
  assert.deepEqual(Object.keys(all).sort(), ["clem-document-f7", "clem-ocr:k:1", "clem-workflow:owner-a:plan2", "clem-workflow:owner-b:plan9"]);
  assert.equal(all["clem-document-f7"].content.text, "From the backup </script>   ${x}", "restored text is data, never code");
  assert.throws(() => readEditsScript("../x"), /Invalid account/);
  console.log("backup edits: read and restored in the real window's IndexedDB");
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
