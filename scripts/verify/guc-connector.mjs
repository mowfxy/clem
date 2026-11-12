// Settings → Connectors → GUC with a mocked desktop bridge: the row under Google Drive, sign-in, first-sync progress,
// the connected state and a wrong password. Screenshots go to artifacts/ (or CLEM_SHOTS).
import { idleEngine } from "./fixture-engine.mjs";
import { mockLocalStorage } from "./fixture-local-storage.mjs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
const shots = process.env.CLEM_SHOTS || "artifacts";
await mkdir(shots, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(idleEngine);
  await page.addInitScript(() => {
    const guc = new Set();
    window.requests = [];
    window.gucState = { connected: false, syncing: false, courses: 0, linked: 0 };
    window.clemDesktop = {
      onAuth: () => () => {}, onChat: () => () => {},
      onGuc: (fn) => { guc.add(fn); return () => guc.delete(fn); },
      invoke: async (r) => {
        window.requests.push(r.action === "gucConnect" ? { ...r, password: r.password ? "(set)" : "" } : r);
        if (r.action === "gucStatus") return window.gucState;
        if (r.action === "gucConnect") {
          if (r.password !== "right") throw Error("Error invoking remote method 'clem:request': Error: GUC didn't accept that username or password. Check them and try again.");
          for (let i = 1; i <= 7; i++) { for (const fn of guc) fn({ phase: "course", done: i, total: 7, label: `Checking your courses… ${i} of 7` }); await new Promise((d) => setTimeout(d, i === 3 ? 1500 : 60)); }
          return (window.gucState = { connected: true, username: r.username, syncing: false, lastSync: Date.now() - 120000, courses: 7, linked: 0, stats: { requests: 10, skipped: 0, changed: 10, events: 0, ms: 4200 } });
        }
        if (r.action === "folders") return [];
        if (r.action === "memoryList") return { enabled: true, records: [] };
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        return {};
      },
    };
  });
  await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">' }));
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: "fixture-owner", name: "Test" }, database: false, storage: false, auth: true, drive: true } : path.endsWith("models") ? [] : path.endsWith("drive/files") ? { files: [] } : {} });
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
    await store.saveState({ ...store.emptyState });
    location.hash = "/app/connectors";
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  });
  await page.locator("dialog.st-dialog[open]").waitFor();
  const rows = page.locator(".st-body .st-row h4");
  await rows.filter({ hasText: "GUC" }).waitFor();
  assert.deepEqual(await rows.allTextContents(), ["Google Drive", "Google Calendar", "GUC", "VPS"], "Calendar sits under Drive, then GUC and the VPS");
  await page.screenshot({ path: join(shots, "guc-row.png") });
  await page.locator(".st-row").filter({ hasText: "GUC" }).getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Connect GUC" }).waitFor();
  await page.getByText("Your password stays encrypted on this device and is never shown to the AI.").waitFor();
  await page.getByLabel("Username").fill("sam.rivera");
  await page.getByLabel("Password").fill("wrong");
  await page.locator(".guc-manage").getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "didn't accept that username or password" }).waitFor();
  assert.equal(await page.getByRole("alert").filter({ hasText: "Error invoking" }).count(), 0);
  await page.screenshot({ path: join(shots, "guc-error.png") });
  await page.getByLabel("Password").fill("right");
  await page.locator(".guc-manage").getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Checking your courses… 3 of 7").waitFor();
  await page.screenshot({ path: join(shots, "guc-progress.png") });
  await page.getByRole("heading", { name: "GUC is connected" }).waitFor();
  await page.getByText("Signed in as").waitFor();
  await page.getByRole("button", { name: "Sync now" }).waitFor();
  await page.screenshot({ path: join(shots, "guc-connected.png") });
  assert.ok(!JSON.stringify(await page.evaluate(() => window.requests)).includes("right"), "the password is not kept by the window");
  await page.keyboard.press("Escape");
  await page.locator(".st-row").filter({ hasText: "GUC" }).getByText(/Connected · synced 2 min ago/).waitFor();
  await page.locator(".st-row").filter({ hasText: "GUC" }).getByRole("button", { name: "Manage" }).waitFor();
  console.log("GUC connector UI verified; screenshots in " + shots);
} finally {
  await browser.close();
  await server.close();
}
