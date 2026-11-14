// Settings → Connectors → GUC with a mocked desktop bridge: the row under Google Drive, sign-in, first-sync progress,
// the connected state, a wrong password and Disconnect, in the light and dark themes: GUC's mark (and its tile) follow
// the app's theme, also when it is switched with the dialog open. Screenshots go to artifacts/ (or CLEM_SHOTS).
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
// The mark drawn in each theme (production.css swaps the image), and the tile it sits on.
const mark = (page) => page.locator(".guc-manage .gd-hero-tile img.brand-guc").evaluate((img) => {
  const s = getComputedStyle(img), t = getComputedStyle(img.parentElement);
  return { dark: /guc-mark-dark/.test(s.content), tile: t.backgroundImage };
});
try {
for (const theme of ["light", "dark"]) {
  const other = theme === "light" ? "dark" : "light";
  const shot = (name) => page.screenshot({ path: join(shots, `${name}-${theme}.png`) });
  // The system says the other theme: the app's own choice is the one followed.
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: other });
  await page.addInitScript(idleEngine);
  await page.addInitScript((theme) => {
    try { localStorage.setItem("clem-theme", theme); } catch {}
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
        if (r.action === "gucDisconnect") return (window.gucState = { connected: false, syncing: false, courses: 0, linked: 0 });
        if (r.action === "folders") return [];
        if (r.action === "memoryList") return { enabled: true, records: [] };
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        return {};
      },
    };
  }, theme);
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
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme, `${theme}: the app's theme, not the system's`);
  const rows = page.locator(".st-body .st-row h4");
  await rows.filter({ hasText: "GUC" }).waitFor();
  assert.deepEqual(await rows.allTextContents(), ["Google Drive", "GUC", "VPS"], "GUC sits under Drive, then the VPS");
  assert.equal(await page.locator(".st-row .connector-tile img.brand-guc").evaluate((img) => /guc-mark-dark/.test(getComputedStyle(img).content)), theme === "dark", `${theme}: the row's mark follows the theme`);
  await shot("guc-row");
  await page.locator(".st-row").filter({ hasText: "GUC" }).getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Connect GUC" }).waitFor();
  await page.getByText("Your password stays encrypted on this device and is never shown to the AI.").waitFor();
  assert.deepEqual(await mark(page), { dark: theme === "dark", tile: "none" }, `${theme}: the Connect GUC mark follows the theme, on a tile that does too`);
  await shot("guc-connect");
  // Switched while the dialog is open: the mark follows at once.
  await page.evaluate(async (t) => (await import("/src/theme/theme.ts")).applyTheme(t), other);
  assert.equal((await mark(page)).dark, other === "dark", `${theme} → ${other}: the mark follows a switch with the dialog open`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `guc-connect-${theme}-to-${other}.png`) });
  await page.evaluate(async (t) => (await import("/src/theme/theme.ts")).applyTheme(t), theme);
  await page.getByLabel("Username").fill("sam.rivera");
  await page.getByLabel("Password").fill("wrong");
  await page.locator(".guc-manage").getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "didn't accept that username or password" }).waitFor();
  assert.equal(await page.getByRole("alert").filter({ hasText: "Error invoking" }).count(), 0);
  await shot("guc-error");
  await page.getByLabel("Password").fill("right");
  await page.locator(".guc-manage").getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Checking your courses… 3 of 7").waitFor();
  await shot("guc-progress");
  await page.getByRole("heading", { name: "GUC is connected" }).waitFor();
  await page.getByText("Signed in as").waitFor();
  await page.getByRole("button", { name: "Sync now" }).waitFor();
  assert.deepEqual(await mark(page), { dark: theme === "dark", tile: "none" }, `${theme}: the connected view's mark follows the theme`);
  // No list (or dropdown) of subjects in the dialog: their settings live in each subject's chat and page.
  assert.equal(await page.locator(".guc-manage").getByText("Subjects", { exact: true }).count(), 0, "no subjects list in the GUC dialog");
  assert.equal(await page.locator(".guc-manage [aria-expanded], .guc-manage select").count(), 0, "nothing to drop down");
  assert.ok(!(await page.evaluate(() => window.requests.map((r) => r.action))).includes("gucLinks"), "the dialog doesn't read the links");
  await shot("guc-connected");
  assert.ok(!JSON.stringify(await page.evaluate(() => window.requests)).includes("right"), "the password is not kept by the window");
  // Disconnect: one plain confirmation that says what it does, and nothing to pick.
  await page.locator(".guc-manage").getByRole("button", { name: "Disconnect" }).click();
  const confirm = page.locator("dialog.app-confirm[open]");
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /Disconnect GUC\?[\s\S]*forgets your GUC password and the courses, grades, announcements, deadlines and course links it saved\. Your subjects and their files stay/);
  assert.equal(await confirm.locator("select, input, ul, [aria-expanded]").count(), 0, "the confirmation has nothing to choose from");
  assert.deepEqual(await confirm.getByRole("button").allTextContents(), ["Cancel", "Disconnect"]);
  await page.waitForTimeout(300);
  await shot("guc-disconnect");
  await confirm.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("heading", { name: "Connect GUC" }).waitFor();
  assert.ok((await page.evaluate(() => window.requests.map((r) => r.action))).includes("gucDisconnect"));
  await shot("guc-disconnected");
  await page.keyboard.press("Escape");
  await page.locator(".st-row").filter({ hasText: "GUC" }).getByRole("button", { name: "Connect" }).waitFor();
  // The hub's own "Connect GUC" button carries the mark too.
  await page.keyboard.press("Escape");
  await page.evaluate(() => { location.hash = "/app/guc"; });
  const hubButton = page.getByRole("button", { name: "Connect GUC" });
  await hubButton.waitFor();
  await page.waitForTimeout(400);
  // A strong button's ink is the other theme's, so its mark is the other theme's too.
  assert.equal(await hubButton.locator("img.brand-guc").evaluate((img) => /guc-mark-dark/.test(getComputedStyle(img).content)), theme === "light", `${theme}: the hub button's mark matches the button`);
  await shot("guc-hub-connect");
  await page.screenshot({ path: join(shots, `guc-hub-button-${theme}.png`), clip: await hubButton.boundingBox().then((b) => ({ x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 })) });
  await page.close();
}
  console.log("GUC connector UI verified in light and dark; screenshots in " + shots);
} finally {
  await browser.close();
  await server.close();
}
