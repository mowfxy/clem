// Clem's update indicator (beside the name in the sidebar) and Settings → General → Updates, driven through every
// state the main process sends (desktop/app-update.ts). Screenshots go to artifacts/update-*.png.
import {mockLocalStorage} from './fixture-local-storage.mjs';
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(() => {
    const updates = new Set();
    window.updateRequests = [];
    window.updateState = { automatic: true, version: "0.3.0-preview.10", supported: true, phase: "current", checkedAt: Date.now() - 120000 };
    window.pushUpdate = (next) => { window.updateState = { ...window.updateState, ...next }; for (const fn of updates) fn(window.updateState); };
    window.clemDesktop = {
      onAuth: () => () => {},
      onChat: () => () => {},
      onUpdate: (fn) => { updates.add(fn); return () => updates.delete(fn); },
      update: async (request) => {
        if (request) window.updateRequests.push(request);
        if (request && "automatic" in request) window.pushUpdate({ automatic: request.automatic });
        if (request?.op === "download") window.pushUpdate({ phase: "downloading", percent: 0 });
        return window.updateState;
      },
      invoke: async (r) => {
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        if (r.action === "memoryList") return { enabled: true, records: [] };
        if (r.action === "folders") return [];
        return {};
      },
    };
  });
  await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">' }));
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: "fixture-owner", name: "Test" }, database: false, storage: false, auth: true, drive: true }
      : path.endsWith("models") ? [{ id: "openai", name: "Codex", provider: "OpenAI", connected: true, context: 32000, specialties: [], tools: [] }] : {} });
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
    await store.saveState({ ...store.emptyState, name: "Mohamed Mowafy" });
    location.hash = "/";
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  });
  await page.locator(".greeting-row").waitFor();
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  const nameWidth = () => page.locator(".account-button>span:nth-child(2)").evaluate((e) => e.getBoundingClientRect().width);
  const plainName = await nameWidth();
  const bottom = page.locator(".sidebar-bottom");
  const shot = (name) => bottom.screenshot({ path: `artifacts/update-${name}.png` });
  // Up to date: nothing beside the name.
  assert.equal(await page.locator(".update-chip").count(), 0);
  await page.evaluate(() => window.pushUpdate({ phase: "downloading", next: "0.3.0-preview.11", percent: 38 }));
  const ring = page.getByRole("button", { name: "Downloading Clem 0.3.0-preview.11, 38 percent" });
  await ring.waitFor();
  await page.waitForTimeout(600);
  await shot("downloading");
  // The name keeps its room: the chip never squeezes it below a readable width.
  const withChip = await nameWidth();
  assert.ok(withChip >= plainName - 14, `the name keeps its room: ${withChip}px with the chip, ${plainName}px without`);
  await page.evaluate(() => window.pushUpdate({ phase: "ready", percent: 100 }));
  const ready = page.getByRole("button", { name: "Restart to update Clem to 0.3.0-preview.11" });
  await ready.waitFor();
  await page.waitForTimeout(600);
  await shot("ready");
  await ready.click();
  await page.waitForFunction(() => window.updateRequests.some((r) => r.op === "install"));
  // Settings → General → Updates.
  await page.evaluate(() => (location.hash = "/app/settings"));
  await page.locator("dialog.st-dialog[open]").waitFor();
  const card = page.locator(".st-card-wrap").filter({ has: page.getByRole("heading", { name: "Updates" }) });
  await card.scrollIntoViewIfNeeded();
  await card.getByText("0.3.0-preview.11 is ready").waitFor();
  await card.screenshot({ path: "artifacts/update-settings-ready.png" });
  await card.locator(".mw-switch").first().click();
  await page.waitForFunction(() => window.updateRequests.some((r) => r.automatic === false));
  await page.evaluate(() => window.pushUpdate({ phase: "available", next: "0.3.0-preview.12", percent: undefined }));
  await card.getByRole("button", { name: "Download" }).waitFor();
  await card.screenshot({ path: "artifacts/update-settings-manual.png" });
  await page.keyboard.press("Escape");
  await page.locator("dialog.st-dialog[open]").waitFor({ state: "detached" }).catch(() => {});
  // Manual mode: Update beside the name downloads the version on offer.
  const offer = page.getByRole("button", { name: "Download Clem 0.3.0-preview.12" });
  await offer.waitFor();
  await page.waitForTimeout(600);
  await shot("available");
  await offer.click();
  await page.waitForFunction(() => window.updateRequests.filter((r) => r.op === "download").length === 1);
  await page.locator(".update-chip.downloading").waitFor();
  // Light theme.
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; window.pushUpdate({ phase: "downloading", percent: 71 }); });
  await page.waitForTimeout(600);
  await shot("downloading-light");
  await page.evaluate(() => window.pushUpdate({ phase: "ready", percent: 100 }));
  await page.waitForTimeout(600);
  await shot("ready-light");
  console.log("App update indicator and settings: ok");
} finally {
  await browser.close();
  await server.close();
}
