// Memory in a subject: its own memories, what a project shares with it, deleting, editing and moving a memory.
import { idleEngine } from "./fixture-engine.mjs";
import { mockLocalStorage } from "./fixture-local-storage.mjs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(idleEngine);
  await page.addInitScript(() => {
    const at = "2026-10-20T10:00:00.000Z";
    const record = (id, scope, text, confirmed, extra = {}) => ({ id, scope, key: "note:" + id, text, kind: confirmed ? "fact" : "inference", confirmed, updatedAt: at, sharedWith: [], source: { locator: confirmed ? "Added by you in memory settings" : "Learned from your message in a chat" }, ...extra });
    window.memory = [
      record("11111111-1111-4111-8111-111111111111", "user:me", "short answers; one worked example", true, { kind: "preference", key: "pref:topic:Answer style" }),
      record("22222222-2222-4222-8222-222222222222", "subject:space-test", "calculus exam 12 November", false, { key: "topic:Exam date", expiresAt: "2026-11-13T00:00:00.000Z" }),
      record("33333333-3333-4333-8333-333333333333", "subject:space-test", "finds it hard; forgets the LIATE order", false, { key: "topic:Integration by parts" }),
      record("55555555-5555-4555-8555-555555555555", "subject:space-test", "DSA lab test Oct 15; DSA midterm L1–6 Oct 22; Physics 3 L1–4 Oct 25", true, { key: "topic:Exams" }),
      record("66666666-6666-4666-8666-666666666666", "user:me", "2nd-year physics", true, { key: "topic:Studies" }),
      record("44444444-4444-4444-8444-444444444444", "project:space-project", "models heat flow in rods", true, { key: "topic:Thesis", sharedWith: ["subject:space-test"] }),
    ];
    window.clemDesktop = {
      onAuth: () => () => {},
      onAttachment: () => () => {},
      onChat: () => () => {},
      invoke: async (r) => {
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        if (r.action === "memoryAll") return { enabled: true, records: window.memory.map((m) => ({ ...m })) };
        const find = (id) => window.memory.find((m) => m.id === id);
        if (r.action === "memoryConfirm") { Object.assign(find(r.id), { confirmed: true, kind: "fact" }); return { ok: true }; }
        if (r.action === "memoryUpdate") {
          const m = find(r.id);
          Object.assign(m, { confirmed: true, ...(r.text ? { text: r.text } : {}), ...(r.topic ? { key: "topic:" + r.topic } : {}), ...(r.scope ? { scope: r.scope } : {}), ...(r.sharedWith ? { sharedWith: r.sharedWith } : {}) });
          if (m.scope === "user:me") m.sharedWith = [];
          return { ok: true };
        }
        if (r.action === "memoryForget") { window.memory = window.memory.filter((m) => m.id !== r.id); return { ok: true }; }
        if (r.action === "folders") return [];
        if (r.action === "securityInfo") return { email: "test@example.com", verified: true, factors: [], google: true };
        return {};
      },
    };
  });
  await page.route("**/fixture", (r) => r.fulfill({
    contentType: "text/html",
    body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">',
  }));
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({ json: path.endsWith("drive/files") ? { files: [] } : path.endsWith("auth/session") ? { user: { id: "fixture-owner", name: "Test" }, database: false, storage: false, auth: true, drive: true } : path.endsWith("models") ? [{ id: "openai", name: "Codex", provider: "OpenAI", connected: true, context: 32000, specialties: [], tools: [] }] : {} });
  });
  await mockLocalStorage(page);
  await page.goto("http://127.0.0.1:5199/fixture");
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
        { id: "space-test", kind: "subject", name: "Calculus", description: "", memory: "", sources: [] },
        { id: "space-project", kind: "project", name: "Thesis", description: "", memory: "", sources: [] },
      ],
    });
    location.hash = "/";
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  });
  await page.locator(".greeting-row").waitFor();
  await page.evaluate(() => (location.hash = "/app/subjects"));
  await page.getByRole("button", { name: /^Calculus\b/ }).click();
  await page.getByRole("tab", { name: /^Memory/ }).click();
  const panel = page.locator(".sp-memory .memory-panel");
  await panel.getByText("4 topics here, plus 2 about you that apply everywhere").waitFor();
  await panel.getByText("Shared from other spaces").waitFor();
  await panel.getByText("from Thesis", { exact: false }).waitFor();
  await panel.getByText("until", { exact: false }).first().waitFor();
  await panel.locator(".memory-lead", { hasText: "Integration by parts" }).waitFor();
  await panel.locator(".memory-notes", { hasText: "forgets the LIATE order" }).waitFor();
  assert.equal(await panel.locator(".memory-points").count(), 0, "no bullet points");
  // Topics read in name order, not by time.
  const names = await panel.locator(".memory-group").first().locator(".memory-lead").allTextContents();
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  await page.locator(".sp-memory").screenshot({ path: "artifacts/memory-subject.png" });
  // The delete button removes that one memory.
  await panel.getByRole("button", { name: /^Delete: Exams/ }).click();
  await page.waitForFunction(() => !window.memory.some((m) => m.id.startsWith("5555")));
  // Edit one in place.
  await panel.getByRole("button", { name: /^Options for: Integration by parts/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await panel.getByLabel("Topic").fill("By parts");
  await panel.getByLabel("Edit memory").fill("finds it hard, especially with logs");
  await panel.getByRole("button", { name: "Save" }).click();
  await panel.getByText("especially with logs", { exact: false }).waitFor();
  await panel.locator(".memory-lead", { hasText: "By parts" }).waitFor();
  // Share the exam with the thesis project.
  await panel.getByRole("button", { name: /^Options for: Exam date/ }).click();
  await page.getByRole("menuitem", { name: "Where it applies…" }).click();
  await panel.getByRole("checkbox", { name: "Thesis" }).check();
  await page.screenshot({ path: "artifacts/memory-place.png" });
  await panel.getByRole("button", { name: "Save" }).click();
  await page.waitForFunction(() => window.memory.find((m) => m.id.startsWith("2222")).sharedWith.includes("project:space-project"));
  await panel.getByText("also in Thesis", { exact: false }).waitFor();
  // Stop using the project's memory here.
  await panel.getByRole("button", { name: /^Options for: Thesis/ }).click();
  await page.getByRole("menuitem", { name: "Stop using here" }).click();
  await page.waitForFunction(() => !window.memory.find((m) => m.id.startsWith("4444")).sharedWith.length);
  assert.equal(await panel.getByText("Shared from other spaces").count(), 0);
  // A sync that failed is said on the page.
  await page.evaluate(() => { const invoke = window.clemDesktop.invoke; window.clemDesktop.invoke = async (r) => (r.action === "memoryAll" ? { ...(await invoke(r)), syncError: "Saved locally. The account service did not answer." } : invoke(r)); });
  await panel.getByRole("button", { name: /^Delete: Exam date/ }).click();
  await panel.locator(".memory-sync", { hasText: "Saved locally." }).waitFor();
  console.log("memory panel verified");
} finally {
  await browser.close();
  await server.close();
}
