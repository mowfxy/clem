// Importing flashcards: Quizlet text pasted on a subject's Flashcards tab, and an Anki deck dropped on the window (read
// by the real desktop/anki.ts behind the scripted bridge).
//   node scripts/verify/card-import.mjs   → test-results/card-import-*.png
// With the desktop build (npm run desktop:build), `--electron` also reads the fixture deck in Electron's own worker.
import { chromium, _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openFixture, saved } from "./local-power-fixture.mjs";
import { readApkg } from "../../desktop/anki.ts";

const deckBytes = [...readFileSync("tests/fixtures/anki-latest.apkg")];
const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5193, initScripts: [() => {
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    real = { ...bridge, invoke: async (r) => {
      if (r.action === "ankiRead") { const read = await window.__readApkg([...r.data], r.name); if (read.error) throw Error(read.error); return { ...read, media: read.media.map((m) => ({ name: m.name, data: new Uint8Array(m.data) })) }; }
      return bridge.invoke(r);
    } };
  } });
}] });
await page.exposeFunction("__readApkg", (bytes, name) => {
  try { const r = readApkg(new Uint8Array(bytes), name); return { ...r, media: r.media.map((m) => ({ name: m.name, data: [...m.data] })) }; }
  catch (error) { return { error: error.message }; }
});
const workspace = async () => page.evaluate(async () => (await import("/src/store.ts")).loadState());
try {
  // Quizlet: pasted on Biology 101's Flashcards tab.
  await page.locator("nav, aside").getByText("Subjects", { exact: true }).first().click();
  await page.getByText("Biology 101").first().click();
  await page.getByRole("tab", { name: /Flashcards/ }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.locator("dialog.card-import");
  await dialog.getByLabel("Quizlet export").fill("Nucleus,Holds the DNA\nLysosome,\"Breaks down waste, worn parts\"\nCytoplasm,Jelly the organelles sit in");
  await dialog.getByText(/3 cards/).waitFor();
  assert.ok(await dialog.getByText("Find it for me (Comma)").count());
  await dialog.getByLabel("Set name").fill("Quizlet: organelles");
  assert.equal(await dialog.getByLabel("Add to").inputValue(), "bio");
  await page.screenshot({ path: "test-results/card-import-quizlet.png" });
  await dialog.getByRole("button", { name: "Import" }).click();
  await page.getByText(/Added 3 cards to Biology 101/).waitFor();
  await saved(page);
  let state = await workspace();
  const quizlet = state.studySets.find((s) => s.title === "Quizlet: organelles");
  assert.deepEqual(quizlet.items[1], { question: "Lysosome", answer: "Breaks down waste, worn parts" });
  assert.equal(quizlet.spaceId, "bio");

  // Anki: a deck dropped on the window while Biology 101 is open.
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], "Cells.apkg", { type: "application/octet-stream" });
    const data = new DataTransfer(); data.items.add(file);
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  }, deckBytes);
  await dialog.getByText(/6 cards/).waitFor({ timeout: 15000 });
  await dialog.getByText(/1 with review history/).waitFor();
  await dialog.getByText(/1 picture/).waitFor();
  await dialog.getByText(/doesn't carry over to Clem's scheduler/).waitFor();
  await page.screenshot({ path: "test-results/card-import-anki.png" });
  await dialog.getByRole("button", { name: "Import" }).click();
  await page.getByText(/Added 6 cards and 1 picture to Biology 101/).waitFor();
  await saved(page);
  state = await workspace();
  const anki = state.studySets.find((s) => s.title === "Cells");
  assert.equal(anki.items.length, 6);
  assert.equal(anki.cards[0].stability, 14.2, "FSRS history kept");
  assert.equal(anki.cards[2], null, "SM-2 history starts as new");
  const picture = state.files.find((f) => f.name === "cell.png");
  assert.equal(picture.spaceId, "bio");
  assert.equal(state.spaces.find((s) => s.id === "bio").folders.find((f) => f.id === picture.folderId).name, "Pictures from Anki");

  // A file that is not a deck says so.
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(["nope"], "broken.apkg"));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await dialog.getByText(/isn't an Anki deck/).waitFor();
  assert.deepEqual(errors, []);
  console.log("card import: Quizlet paste and an Anki drop import, with review history, pictures and clear errors");
} finally { await close(); await browser.close(); }

if (process.argv.includes("--electron")) {
  const userData = await mkdtemp(join(tmpdir(), "clem-anki-"));
  const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData], timeout: 30000 });
  try {
    await (await app.firstWindow()).getByRole("heading", { name: "Welcome to Clem." }).waitFor();
    const read = await app.evaluate(({ app }, bytes) => new Promise((done) => {
      const { Worker } = process.getBuiltinModule("worker_threads"), { join } = process.getBuiltinModule("path");
      const worker = new Worker(join(app.getAppPath(), "anki-worker.cjs"), { workerData: { bytes: new Uint8Array(bytes), name: "Cells.apkg" } });
      worker.once("message", (m) => { void worker.terminate(); done(m.error ? { error: m.error } : { name: m.result.name, cards: m.result.cards.length, media: m.result.media.length }); });
      worker.once("error", (e) => done({ error: String(e) }));
    }), deckBytes);
    console.log("electron anki worker:", JSON.stringify(read));
    assert.deepEqual(read, { name: "Cells", cards: 6, media: 1 });
  } finally { await app.close(); await rm(userData, { recursive: true, force: true }).catch(() => {}); }
}
