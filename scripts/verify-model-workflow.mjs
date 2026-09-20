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
        if (r.action === "securityInfo")
          return {
            email: "test@example.com",
            verified: true,
            factors: [],
            google: true,
          };
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
      body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">',
    }),
  );
  await page.route("**/api/**", (r) => {
    requests.push({ url: r.request().url(), method: r.request().method() });
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path.endsWith("drive/files")
        ? { files: [] }
        : path.endsWith("auth/session")
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
                  id: "gpt-6-astra",
                  reasoningEfforts: [
                    { reasoningEffort: "low", description: "Fast" },
                    { reasoningEffort: "high", description: "Thorough" },
                  ],
                  defaultReasoningEffort: "low",
                  name: "Astra",
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
      chats: [
        {
          id: "chat-fixture",
          title: "Research plan",
          spaceId: null,
          updated: 1,
          messages: [
            {
              id: "message-fixture",
              role: "assistant",
              content: "Review the steps.",
              plan: {
                id: "plan-fixture",
                goal: "Research",
                lead: "gpt-6-astra",
                approved: false,
                revision: 1,
                tasks: Array.from({ length: 4 }, (_, i) => ({
                  id: `step-${i + 1}`,
                  title: `Step title ${i + 1}`,
                  instructions: "Read the source evidence.",
                  output: "A sourced summary",
                  model: "gpt-6-astra",
                  dependsOn: [],
                  status: "pending",
                })),
              },
            },
          ],
        },
      ],
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
  await page
    .getByRole("button", { name: "Research plan", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".plan-steps input,.plan-steps textarea,.plan-steps select")
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Edit step 1", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Review the experiment");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Check all measurements.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Review the experiment", exact: true })
    .waitFor();
  await page
    .locator(".plan-steps .model-selector")
    .first()
    .getByRole("button", { name: "Choose model", exact: true })
    .click();
  await page.getByRole("button", { name: "high", exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok(
    (await page.locator(".plan-steps .model-selector").first().innerText())
      .toLowerCase()
      .includes("high"),
  );
  await page.screenshot({ path: "artifacts/plan-editor.png", fullPage: true });
  await page
    .getByRole("button", { name: "Delete current chat", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button",{name:"Research plan",exact:true}).waitFor({state:"detached"});
  assert.equal(
    await page
      .getByRole("button", { name: "Research plan", exact: true })
      .count(),
    0,
  );
  await page.locator(".greeting-row").waitFor();
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.screenshot({ path: "artifacts/model-picker.png", fullPage: true });
  console.log(
    "PASS popup task edits, per-step reasoning selection, deletion and synced-model picker",
  );
} finally {
  await browser.close();
  await server.close();
}
