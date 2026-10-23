// The last setup step ("Connect your AI") and the sample subject it offers, with a scripted bridge.
//   node scripts/verify/setup-connect.mjs   → test-results/setup-connect-*.png
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { openFixture } from "./local-power-fixture.mjs";

const server = await createServer({ server: { host: "127.0.0.1", port: 5197, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
/** A setup at its last step on a PC where `pc` describes what is installed and signed in. */
async function setupPage(pc) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((pc) => {
    const state = { configured: true, user: { id: "fixture", email: "sam@example.test", name: "Sam" }, setup: { step: 3, username: "sam", displayName: "Sam", memory: true }, entitlement: { active: true } };
    window.requests = [];
    window.clemDesktop = {
      onAuth: () => () => {}, onChat: () => () => {},
      invoke: async (r) => {
        window.requests.push(r.action);
        if (r.action === "status") return structuredClone(state);
        if (r.action === "setup") { state.setup = { ...r }; state.setup.step = 3; return state; } // stays on the step for the check
        if (r.action === "providerAccounts") return { accounts: [] };
        if (r.action === "aiDetect") return pc.detect;
        if (r.action === "claudeStatus") return { installed: pc.claudeInstalled, connected: !!window.claudeDone, ...(window.claudeDone ? { email: "sam@example.test", plan: "Pro" } : {}) };
        if (r.action === "claudeLogin") { setTimeout(() => { window.claudeDone = true; }, 300); return { started: true }; }
        if (r.action === "grokStatus") return { installed: false, connected: false };
        if (r.action === "antigravityStatus") return { installed: false, connected: false };
        if (r.action === "checkout") throw Error("never");
        return {};
      },
    };
  }, pc);
  await page.goto("http://127.0.0.1:5197/");
  await page.getByRole("progressbar", { name: "Step 4 of 4" }).waitFor();
  await page.locator(".first-ai-row").first().waitFor();
  return { page, errors };
}
try {
  // Claude Code signed in on this PC: it comes first with one Connect button; nothing signs in until it is clicked.
  {
    const { page, errors } = await setupPage({ claudeInstalled: true, detect: { codex: { signedIn: false }, claude: { signedIn: true, email: "sam@example.test" }, claudeInstalled: true } });
    const rows = page.locator(".first-ai-row h3");
    assert.deepEqual(await rows.allTextContents(), ["Claude", "ChatGPT", "Grok", "Gemini"]);
    assert.ok(await page.getByText(/Claude Code is signed in on this PC as sam@example.test/).isVisible());
    const claude = page.locator(".first-ai-row.provider-claude");
    assert.equal(await claude.getByRole("button").textContent(), "Connect");
    assert.equal(await page.locator(".first-ai-row.provider-grok").getByRole("button").textContent(), "Install and connect");
    assert.equal(await page.locator(".first-ai-row.provider-chatgpt").getByRole("button").textContent(), "Sign in");
    assert.ok(!(await page.evaluate(() => window.requests)).some((a) => /Login|Install|Add/.test(a)), "detection starts no sign-in or install");
    assert.ok(await page.locator(".setup-finish").isDisabled());
    await page.screenshot({ path: "test-results/setup-connect-found.png" });
    await claude.getByRole("button", { name: "Connect" }).click();
    await claude.getByText("Connected", { exact: true }).waitFor({ timeout: 15000 });
    assert.ok(await page.locator(".setup-finish").isEnabled());
    assert.ok(await page.getByLabel(/Start with a sample subject/).isChecked());
    await page.screenshot({ path: "test-results/setup-connect-connected.png" });
    await page.locator(".setup-finish").click();
    await page.waitForFunction(() => localStorage.getItem("clem-after-setup"));
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("clem-after-setup"))), { sample: true, ai: "claude" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Nothing on this PC: Google's Gemini comes first, and the step can be left for Settings → Models.
  {
    const { page, errors } = await setupPage({ claudeInstalled: false, detect: { codex: { signedIn: false }, claude: { signedIn: false } } });
    assert.equal(await page.locator(".first-ai-row h3").first().textContent(), "Gemini");
    assert.equal(await page.getByText(/free/i).count(), 0, "nothing promises free use");
    await page.screenshot({ path: "test-results/setup-connect-none.png" });
    await page.getByLabel(/Start with a sample subject/).uncheck();
    await page.getByRole("button", { name: "I’ll do this later" }).click();
    await page.waitForFunction(() => localStorage.getItem("clem-after-setup"));
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("clem-after-setup"))), { sample: false, settings: "Models" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  // The workspace after setup: the sample subject is added and opened, holds no chats, and its starter goes to the AI.
  {
    const { page, errors, close } = await openFixture(browser, { port: 5195, replies: ["Question 1: which organelle makes most of the cell's ATP?"] });
    try {
      // The workspace opening right after setup: the step left its choice behind.
      await page.evaluate(async () => {
        localStorage.setItem("clem-after-setup", JSON.stringify({ sample: true, ai: "claude" }));
        const { default: React } = await import("/node_modules/.vite/deps/react.js");
        const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { default: App } = await import("/src/App.tsx");
        window.__root.unmount();
        window.__root = ReactDOM.createRoot(document.getElementById("root"));
        window.__root.render(React.createElement(App, {}));
      });
      await page.locator(".sp-sample").waitFor();
      assert.ok(await page.getByText("Sample: Cell biology").first().isVisible());
      const state = await page.evaluate(async () => (await import("/src/store.ts")).loadState());
      const sample = state.spaces.find((s) => s.sample);
      assert.equal(state.files.filter((f) => f.spaceId === sample.id).length, 3);
      assert.equal(state.studySets.find((s) => s.spaceId === sample.id).items.length, 8);
      assert.equal(state.chats.filter((c) => c.spaceId === sample.id).length, 0, "no scripted chats");
      await page.screenshot({ path: "test-results/setup-connect-sample.png" });
      await page.locator(".sp-sample").getByRole("button", { name: /^Try:/ }).click();
      await page.waitForFunction(() => window.requests.some((r) => r.action === "chat"));
      const chat = await page.evaluate(() => window.requests.find((r) => r.action === "chat"));
      assert.ok(chat.scope.startsWith("subject:"), "asked inside the sample subject");
      assert.ok(chat.messages.some((m) => m.role === "user" && m.content.includes("Quiz me on these cell biology notes")), JSON.stringify(chat.messages.map((m) => [m.role, m.content.slice(0, 120)])));
      assert.equal(await page.evaluate(() => localStorage.getItem("clem-after-setup")), null, "acted on once");
      assert.deepEqual(errors, []);
    } finally { await close(); }
  }
  console.log("setup connect: detection order, one-click Connect, skip to Models, and the sample subject work");
} finally { await browser.close(); await server.close(); }
