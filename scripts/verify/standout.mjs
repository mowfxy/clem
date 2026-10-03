// Browser check for answer blocks: model-drawn visuals, checked numbers, citations,
// second opinions, source checks, proposed file changes, screen capture and offline reading.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { mockLocalStorage } from "./fixture-local-storage.mjs";

const visual = { kind: "diagram", title: "Water cycle", nodes: [{ id: "sea", label: "Ocean" }, { id: "cloud", label: "Clouds" }, { id: "rain", label: "Rain" }], edges: [{ from: "sea", to: "cloud", flow: true }, { from: "cloud", to: "rain" }, { from: "rain", to: "sea" }], steps: [{ title: "Evaporation", text: "Sun heats the ocean.", focus: ["sea", "cloud"] }, { title: "Rain", focus: ["cloud", "rain"] }] };
const answer = `Water moves in a loop [[Hydrology.txt, p. 2]]. It takes about 9 days on average.

\`\`\`visual
${JSON.stringify(visual)}
\`\`\`

\`\`\`check
{"checks":[{"label":"Residence","expr":"12900/1400","vars":{},"claimed":9.21,"unit":"days"},{"label":"Wrong","expr":"2*3","claimed":7}]}
\`\`\`

\`\`\`edit
{"path":"notes/cycle.md","find":"Rain: TODO","replace":"Rain: falls as precipitation","summary":"Fill in the rain step"}
\`\`\``;
const replies = [answer, "Disagree. The residence time is closer to 9 days only for the atmosphere.\n\n- Say which reservoir you mean.", '{"claims":[{"claim":"Water moves in a loop","status":"supported","source":"Hydrology.txt","page":2,"quote":"a continuous cycle"},{"claim":"About 9 days","status":"unsupported","source":"","page":null,"quote":""}]}'];

await mkdir("artifacts", { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5197, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((replies) => {
    const listeners = new Set(), captures = new Set();
    window.requests = [];
    window.fireCapture = async () => { const png = await (await fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).arrayBuffer(); for (const fn of captures) fn({ bytes: new Uint8Array(png), name: "Screen capture 10.00.png", mime: "image/png" }); };
    let file = "# Cycle\nRain: TODO\n";
    window.mowrDesktop = {
      onAuth: () => () => {}, onAttachment: () => () => {},
      onCapture: (fn) => { captures.add(fn); return () => captures.delete(fn); },
      onChat: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      invoke: async (r) => {
        window.requests.push(r);
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        if (r.action === "folders" || r.action === "folderChanges") return [];
        if (r.action === "providerAccounts") return { accounts: [], active: null, autoSwitch: false };
        if (r.action === "folderFileRead") return { path: r.path, text: file };
        if (r.action === "folderEditApply") { file = file.replace(r.find, r.replace); return { id: "22222222-2222-4222-8222-222222222222", added: 1, removed: 1 }; }
        if (r.action === "folderChangeUndo") { file = "# Cycle\nRain: TODO\n"; return { ok: true }; }
        if (r.action === "chat") {
          const text = replies.shift() || "Okay.";
          let i = 0;
          const tick = () => { for (const fn of listeners) fn({ id: r.id, type: "delta", text: text.slice(i, i + 40) }); i += 40; if (i < text.length) setTimeout(tick, 8); else for (const fn of listeners) fn({ id: r.id, type: "done" }); };
          setTimeout(tick, 50);
          return { started: true };
        }
        return {};
      },
    };
  }, replies);
  await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">' }));
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes("/api/local/")) return r.fallback();
    return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: "fixture-owner" }, auth: true } : path.endsWith("models") ? [
      { id: "gpt-5.5", name: "GPT-5.5", provider: "OpenAI", connected: true, context: 32000, specialties: [], tools: [], isDefault: true },
      { id: "claude:sonnet", name: "Claude Sonnet", provider: "Anthropic", connected: true, context: 32000, specialties: [], tools: [] },
    ] : {} });
  });
  await mockLocalStorage(page);
  await page.goto("http://127.0.0.1:5197/fixture");
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import("/@react-refresh");
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true;
    const store = await import("/src/store.ts");
    store.setStorageNamespace("fixture-owner");
    await store.storeBlob("hydro", new File(["The water cycle is a continuous cycle of evaporation and rain."], "Hydrology.txt", { type: "text/plain" }));
    await store.saveState({ ...store.emptyState, files: [{ id: "hydro", name: "Hydrology.txt", size: 62, type: "text/plain", created: 1, spaceId: null }] });
    location.hash = "/app";
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    window.__root = ReactDOM.createRoot(document.getElementById("root"));
    window.__render = (props) => window.__root.render(React.createElement(App, props));
    window.__render({});
  });
  await page.locator(".greeting-row").waitFor();

  // A capture arrives as an image attachment in the composer.
  await page.evaluate(() => window.fireCapture());
  await page.locator(".attachment-chips .image-chip").waitFor();
  await page.getByRole("button", { name: /Remove Screen capture/ }).click();

  await page.getByRole("button", { name: "Add attachment" }).click();
  await page.getByRole("button", { name: "Choose a saved file" }).click();
  await page.getByRole("option", { name: /Hydrology\.txt/ }).click();
  await page.locator(".composer textarea").fill("Explain the water cycle");
  await page.locator(".composer textarea").press("Enter");
  await page.locator(".spec-visual").waitFor();
  const chatRequest = await page.evaluate(() => window.requests.find((r) => r.action === "chat"));
  assert.match(chatRequest.messages[0].content, /```visual/, "answer format instructions reach the model");
  assert.ok(chatRequest.messages.some((m) => m.content.includes("continuous cycle")), "attached sources reach the model");
  assert.equal(await page.locator(".spec-visual .visual-title strong").innerText(), "Water cycle");
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByText("Sun heats the ocean.").waitFor();

  // Checked numbers: a difference opens automatically with the recomputed value.
  await page.getByText("1 of 2 numbers differ when recomputed").waitFor();
  await page.getByText("recomputed 6").waitFor();

  // Citation chips resolve to stored files.
  assert.equal(await page.locator(".cite:not(.unavailable)").count(), 1);

  // Proposed file change: preview the diff, apply, then undo.
  await page.locator(".edit-proposal .edit-diff .add").waitFor();
  await page.getByRole("button", { name: "Apply change" }).click();
  await page.locator(".edit-proposal .edit-state", { hasText: "Applied" }).waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.locator(".edit-proposal .edit-state", { hasText: "Undone" }).waitFor();

  // Second opinion from another provider.
  await page.getByRole("button", { name: "Second opinion" }).click();
  await page.getByRole("menuitem", { name: /Claude Sonnet/ }).click();
  await page.locator(".review-panel.disagree").waitFor();
  const reviewRequest = await page.evaluate(() => window.requests.filter((r) => r.action === "chat")[1]);
  assert.equal(reviewRequest.model, "claude:sonnet");

  // Source check returns claim-by-claim support.
  await page.getByRole("button", { name: "Check against sources" }).click();
  await page.getByText("1 of 2 claims supported").waitFor();
  await page.screenshot({ path: "artifacts/standout-answer.png", fullPage: true });

  // /visual is drawn by the connected model, which receives only the visual instructions.
  const before = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").length);
  await page.locator(".composer textarea").fill("/visual projectile at 30° and 20 m/s");
  await page.locator(".composer textarea").press("Enter");
  await page.waitForFunction((n) => window.requests.filter((r) => r.action === "chat").length > n, before);
  const visualAsk = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
  assert.match(visualAsk.messages[0].content, /interactive visual/);
  assert.ok(visualAsk.messages.some((m) => m.role === "user" && m.content.startsWith("Visualize: projectile at 30° and 20 m/s")));
  // The chat's earlier file still comes along, so a visual can be drawn from it.
  assert.ok(visualAsk.messages.some((m) => m.content.includes("[Source: Hydrology.txt; complete file]")));

  // Offline reading keeps the workspace open and holds sending.
  await page.evaluate(() => window.__render({ offline: true }));
  await page.locator(".offline-banner").waitFor();
  const sent = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").length);
  await page.locator(".composer textarea").fill("Anything new?");
  await page.locator(".composer textarea").press("Enter");
  await page.getByText("You’re offline", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.requests.filter((r) => r.action === "chat").length), sent);
  assert.deepEqual(errors, []);
  console.log("PASS model-drawn visuals, steps, checked numbers, citations, file change apply/undo, second opinion, source check, capture attachment, /visual requests and offline reading");
} finally {
  await browser.close();
  await server.close();
}
