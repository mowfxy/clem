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
      body: '<!doctype html><div id="root"></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css">',
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
    .getByRole("button", { name: "Local research", exact: true })
    .click();
  await page
    .locator("input[type=file]")
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
  assert.ok(await page.getByLabel("Use as memory source").isChecked());
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await page.getByLabel("Your message").fill("What was the experiment result?");
  await page.getByLabel("Your message").press("Enter");
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
} finally {
  await browser.close();
  await server.close();
}
