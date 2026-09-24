import { mockLocalStorage } from "./fixture-local-storage.mjs";
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
                text: r.messages[0].content.includes(
                  "Edit user-controlled memory",
                )
                  ? JSON.stringify({
                      summary: "Use short explanations.",
                      records: [],
                    })
                  : r.messages[0].content.includes("Quiz items")
                    ? JSON.stringify({
                        title: "Limits practice",
                        items: [
                          {
                            question: "What is 2 + 2?",
                            answer: "Adding two pairs gives four.",
                            choices: ["3", "4"],
                            correct: 1,
                          },
                        ],
                      })
                    : "Scheduled result.",
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
          kind: "subject",
          name: "Calculus",
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
  await page.evaluate(() => (location.hash = "/app/subjects"));
  await page.getByRole("button", { name: "Calculus", exact: true }).click();
  await page.getByRole("button", { name: "New quiz", exact: true }).click();
  await page
    .locator(".composer textarea")
    .fill("/quiz create a quiz on arithmetic");
  await page.locator(".composer textarea").press("Enter");
  await page.getByText("Limits practice is ready:", { exact: false }).waitFor();
  await page.evaluate(() => (location.hash = "/app/subjects"));
  await page.getByRole("button", { name: "Calculus", exact: true }).click();
  await page
    .getByRole("button", { name: "Limits practice", exact: true })
    .click();
  await page.getByLabel("4", { exact: true }).check();
  await page
    .getByRole("button", { name: "Check answers", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try again", exact: true })
    .waitFor();
  await page.screenshot({ path: "artifacts/subject-study.png" });
  await page
    .getByRole("button", { name: "Back to sets", exact: true })
    .click();
  await page.getByText("last 1/1", { exact: false }).waitFor();
  // The quiz answer joined the review schedule, so nothing is due or new today.
  await page.getByRole("button", { name: "Nothing due", exact: false }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export subject ZIP", exact: true })
    .click();
  const zip = await downloadPromise;
  await zip.saveAs("artifacts/subject-transfer.mowr.zip");
  await page.keyboard.press("Escape");
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles("artifacts/subject-transfer.mowr.zip");
  await page
    .getByText("Subject imported, including files and study history.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Calculus", exact: true }).count(),
    2,
  );
  await page.evaluate(() => (location.hash = "/app/settings"));
  await page
    .locator(".settings-tabs")
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/settings-memory.png" });
  await page.getByRole("button", { name: "Open memory", exact: true }).click();
  await page.getByLabel("Change your memory").fill("Use short explanations.");
  await page
    .getByRole("button", { name: "Update memory", exact: true })
    .click();
  await page.getByText("Memory updated.", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".memory-summary").innerText()).includes(
      "short explanations",
    ),
  );
  await page.keyboard.press("Escape");
  await page
    .locator(".settings-tabs")
    .getByRole("button", { name: "Automations", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/settings-automations.png" });
  await page
    .getByRole("button", { name: "Manage automations", exact: true })
    .click();
  assert.equal(
    await page.getByText("Configure URL", { exact: false }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "New automation", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Daily review");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Review my goals");
  await page.getByLabel("Model", { exact: true }).selectOption("openai");
  await page
    .getByLabel("First run (your local time)")
    .fill(
      new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    );
  await page
    .getByRole("button", { name: "Schedule task", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Daily review", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText("Paused", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const store = await import("/src/store.ts");
    const current = await store.loadState();
    current.automations = current.automations.map((a) => ({
      ...a,
      enabled: true,
      nextRun: Date.now() - 1000,
    }));
    await store.saveState(current);
    window.dispatchEvent(new Event("mowr-auth"));
  });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Daily review", exact: true })
    .waitFor({ timeout: 20000 });
  const taskState = await page.evaluate(async () => {
    const store = await import("/src/store.ts");
    return store.loadState();
  });
  assert.equal(
    taskState.chats.filter((c) => c.title === "Daily review").length,
    1,
  );
  assert.ok(taskState.automations[0].nextRun > Date.now());
  console.log(
    "PASS subject generation, quiz attempts, ZIP transfer, memory chat, local automation setup",
  );
} finally {
  await browser.close();
  await server.close();
}
