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
    window.mowrDesktop = {
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
        if (r.action === "telegramStatus") return { connected: false };
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
      body: '<!doctype html><div id="root"></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css">',
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
    location.hash = "/";
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
  await page.locator(".greeting-row").waitFor();
  assert.equal(
    await page.getByText("Download Mowr", { exact: true }).count(),
    0,
  );
  const bounds = await page.locator(".greeting-row").evaluate((el) =>
    Array.from(el.children).map((c) => {
      const r = c.getBoundingClientRect();
      return r.y + r.height / 2;
    }),
  );
  assert.ok(Math.abs(bounds[0] - bounds[1]) < 2, "Greeting aligns with logo");
  assert.equal(await page.locator(".sidebar .desktop-folder-panel").count(), 0);
  await page.evaluate(() => (location.hash = "/app/settings"));
  await page.getByRole("group", { name: "Choose your character" }).waitFor();
  await page.getByRole("button", { name: "Moth", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Moth", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({
    path: "artifacts/settings-profile.png",
    fullPage: true,
  });
  for (const name of ["Linked folders", "Telegram", "Memory"]) {
    await page
      .locator(".settings-tabs")
      .getByRole("button", { name, exact: true })
      .click();
    await page
      .getByLabel("Space", { exact: true })
      .selectOption("project:space-test");
    await page.locator(".settings-content .desktop-folder-panel").waitFor();
  }
  await page.screenshot({
    path: "artifacts/settings-memory.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 600, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No narrow screen overflow",
  );
  await page.evaluate(() => (location.hash = "/"));
  await page.locator(".greeting-row").waitFor();
  console.log(
    "PASS desktop default and hash routing, greeting alignment, settings scope panels, original profile selection and narrow layout",
  );
} finally {
  await browser.close();
  await server.close();
}
