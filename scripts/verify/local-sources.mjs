import {mockLocalStorage} from './fixture-local-storage.mjs';
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    }),
    requests = [];
  await page.addInitScript(() => {
    const listeners = new Set();
    window.requests = [];
    window.clemDesktop = {
      onAuth: () => () => {},
      onAttachment: () => () => {},
      onChat: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      invoke: async (r) => {
        window.requests.push(r);
        if (r.action === "essentialSync")
          return { skills: r.skills, notes: r.notes };
        if (r.action === "memoryList") return { enabled: true, records: [] };
        if (r.action === "folders") return [];
        // The AI's names for uploaded files, from their contents (slowly, as a real model answers).
        if (r.action === "fileName") return new Promise((done) => setTimeout(() => done({ name: "Named " + r.original.replace(/\.pdf$/, "") }), 300));
        if (r.action === "chat") {
          setTimeout(() => {
            for (const fn of listeners) {
              fn({
                id: r.id,
                type: "delta",
                text: "Based on your local source.",
              });
              fn({ id: r.id, type: "done" });
            }
          }, 20);
          return { started: true };
        }
        return {};
      },
    };
  });
  await page.route("**/fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="root"></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css">',
    }),
  );
  await page.route("**/api/**", (r) => {
    requests.push({ url: r.request().url(), method: r.request().method() });
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path.endsWith("auth/session")
        ? {
            user: { id: "fixture-owner", name: "Test" },
            database: false,
            storage: false,
            auth: true,
            drive: true,
          }
        : path.endsWith("models")
          ? [
              {
                id: "openai",
                name: "Codex",
                provider: "OpenAI",
                connected: true,
                context: 32000,
                specialties: [],
                tools: [],
              },
            ]
          : {},
    });
  });
  await mockLocalStorage(page);
  await page.goto("http://127.0.0.1:5198/fixture");
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import("/@react-refresh");
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const store = await import("/src/store.ts");
    store.setStorageNamespace("fixture-owner");
    await store.saveState({
      ...store.emptyState,
      spaces: [
        {
          id: "space-test",
          kind: "project",
          name: "Local research",
          description: "",
          memory: "",
          sources: [],
        },
      ],
    });
    location.hash = "/app/projects";
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const { default: ReactDOM } = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const { default: App } = await import("/src/App.tsx");
    ReactDOM.createRoot(document.getElementById("root")).render(
      React.createElement(App),
    );
  });
  await page
    .getByRole("button", { name: /^Local research\b/ })
    .click();
  await page
    .locator("input[type=file][multiple]")
    .first()
    .setInputFiles({
      name: "project-memory.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The experiment result is precisely 42 newtons."),
    });
  await page
    .getByRole("button", { name: /project-memory.txt/ })
    .waitFor({ timeout: 8000 })
    .catch(async (e) => {
      console.log((await page.locator("body").innerText()).slice(-2500));
      throw e;
    });
  // Files added to a project become its sources; the Files tab shows the toggle.
  await page.getByRole("tab", { name: /^Files/ }).click();
  assert.ok(await page.getByLabel("Source").first().isChecked());
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByLabel("Ask about Local research").fill("What was the experiment result?");
  await page.getByLabel("Ask about Local research").press("Enter");
  await page
    .getByText("Based on your local source.", { exact: true })
    .waitFor();
  const result = await page.evaluate(async () => {
    const { getBlob, loadState } = await import("/src/store.ts");
    const state = await loadState();
    const file = state.files[0];
    return {
      file,
      bytes: await (await getBlob(file.id)).text(),
      sources: state.spaces[0].sources,
      chat: window.requests.find((r) => r.action === "chat"),
      sync: window.requests.filter((r) => r.action === "essentialSync"),
    };
  });
  assert.equal(result.file.remote, false);
  assert.ok(result.sources.includes(result.file.id));
  assert.match(JSON.stringify(result.chat), /42 newtons/);
  assert.equal(result.chat.scope, "project:space-test");
  assert.ok(
    result.sync.every(
      (r) =>
        !JSON.stringify(r).includes("42 newtons") &&
        !("files" in r) &&
        !("chats" in r),
    ),
  );
  assert.ok(requests.every((r) => r.method === "GET"));
  console.log(
    "Project file upload, local persistence, scoped source retrieval and cloud payload exclusion passed.",
  );
  await page.screenshot({ path: "artifacts/local-project-source.png" });
  // Files named from their contents: one notice for the whole upload, never one per file.
  const toasts = [];
  await page.exposeFunction("noteToast", (t) => toasts.push(t));
  await page.evaluate(() => new MutationObserver(() => { for (const el of document.querySelectorAll(".toast")) if (el.dataset.seen !== el.textContent) { el.dataset.seen = el.textContent; window.noteToast(el.textContent); } }).observe(document.body, { childList: true, subtree: true, characterData: true }));
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdfBytes = async (name) => { const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); const pg = doc.addPage([400, 300]); pg.drawText("Nodal Analysis " + name, { x: 40, y: 250, size: 18, font }); pg.drawText("Kirchhoff's current law: currents into a node sum to zero.", { x: 40, y: 220, size: 10, font }); return Buffer.from(await doc.save()); };
  const upload = async (files) => page.locator("input[type=file][multiple]").first().setInputFiles(await Promise.all(files.map(async (name) => ({ name, mimeType: "application/pdf", buffer: await pdfBytes(name) }))));
  await upload(["scan1.pdf", "scan2.pdf"]);
  await page.getByText("Renamed 2 files based on their content.", { exact: true }).waitFor({ timeout: 15000 }).catch(async (e) => { console.log("toasts", toasts, await page.evaluate(() => JSON.stringify({ names: window.requests.filter((r) => r.action === "fileName").map((r) => r.original), toast: document.querySelector(".toast")?.textContent }))); throw e; });
  await page.waitForTimeout(800);
  assert.deepEqual(toasts.filter((t) => /Renamed|Named|Saved as/.test(t)), ["Renamed 2 files based on their content."]);
  await page.getByRole("button", { name: "Dismiss" }).first().click().catch(() => {});
  // Every name the new file shows on the way: only the one it came with, then its final one.
  await page.evaluate(() => { window.shownNames = new Set(); const look = () => { for (const el of document.querySelectorAll("button, strong, span")) { const t = el.textContent || ""; if (/scan3/i.test(t) && t.length < 60) window.shownNames.add(t.trim()); } }; new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true }); });
  await upload(["scan3.pdf"]);
  await page.getByText("Renamed to “Named scan3” based on its content.", { exact: true }).waitFor({ timeout: 15000 });
  const naming = await page.evaluate(() => { const r = window.requests.filter((x) => x.action === "fileName").at(-1); return { lines: r.lines.length, title: r.title, page: !!r.page?.pdf, siblings: r.siblings, shown: [...window.shownNames] }; });
  assert.equal(naming.lines, 0, "a PDF is named from its pages, not from extracted text");
  assert.equal(naming.title, undefined);
  assert.ok(naming.page, "its first pages go to the AI");
  assert.ok(naming.siblings.includes("Named scan1") && naming.siblings.includes("Named scan2"), "it sees the names beside it");
  assert.deepEqual(naming.shown.filter((t) => !/^scan3\.pdf$|^Named scan3$|Renamed to/.test(t)), [], "never a rough name first: " + naming.shown.join(" | "));
  console.log("Uploaded files named from their contents: one notice per upload.");
} finally {
  await browser.close();
  await server.close();
}
