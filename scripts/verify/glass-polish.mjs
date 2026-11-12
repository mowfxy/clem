// The glass UI's details: the settings window is frosted from its first frame, scrollbars are the app's own, the wavy
// rule is ink in both themes, menus inside a settings dialog are menus, the profile greeting is serif at Regular, nothing
// fades around glass, popovers in a glass dialog sit at their trigger, and the Drive search is a single field.
import { idleEngine } from "./fixture-engine.mjs";
import { mockLocalStorage } from "./fixture-local-storage.mjs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
import fs from "node:fs";
const shots = process.argv[2];
const body = fs.readFileSync("scripts/verify/settings.mjs", "utf8").match(/'(<!doctype html>[^']*)'/)[1];
const server = await createServer({ server: { host: "127.0.0.1", port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
try {
  for (const scheme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, colorScheme: scheme });
    await page.addInitScript(idleEngine);
    await page.addInitScript(() => {
      // Opacity on a parent cuts the glass inside it off from what is behind, so the glass snaps in when the fade ends.
      window.fades = new Set();
      const watch = () => {
        for (const a of document.getAnimations()) {
          const t = a.effect?.target;
          if (!t || a.effect.pseudoElement || !a.effect.getKeyframes().some((k) => "opacity" in k || "filter" in k)) continue;
          if ([...t.querySelectorAll("*")].some((el) => getComputedStyle(el).backdropFilter !== "none")) window.fades.add(t.tagName + "." + t.className + " " + a.animationName);
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      const memory = (id, text) => ({ id, scope: "user:me", key: "note:" + id, text, kind: "preference", confirmed: true, updatedAt: "2026-10-20T10:00:00.000Z", sharedWith: [], source: {} });
      const records = [memory("11111111-1111-4111-8111-111111111111", "You prefer concise explanations."), memory("22222222-2222-4222-8222-222222222222", "You prefer dated study plans.")];
      window.clemDesktop = { onAuth: () => () => {}, onAttachment: () => () => {}, onChat: () => () => {}, invoke: async (r) => {
        if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
        if (r.action === "folders") return [];
        if (r.action === "memoryAll" || r.action === "memoryList") return { enabled: true, records };
        return {};
      } };
    });
    await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body }));
    await page.route("**/api/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      return r.fulfill({ json: path.endsWith("drive/files") ? { files: [] } : path.endsWith("auth/session") ? { user: { id: "fixture-owner", name: "Test" }, database: false, storage: false, auth: true, drive: true } : path.endsWith("models") ? [{ id: "gemini-3.8", name: "Gemini 3.8 Flash", provider: "Google", connected: true, context: 200000, specialties: [], tools: [], defaultReasoningEffort: "low", reasoningEfforts: [{ reasoningEffort: "low", description: "Light" }, { reasoningEffort: "high", description: "Deep" }] }] : {} });
    });
    await mockLocalStorage(page);
    await page.goto("http://127.0.0.1:5197/fixture");
    await page.evaluate(async () => {
      const { default: RefreshRuntime } = await import("/@react-refresh");
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const store = await import("/src/store.ts");
      store.setStorageNamespace("fixture-owner");
      const text = "A long answer. ".repeat(50), now = Date.now();
      const message = (id, from, content, more = {}) => ({ id, from, content, at: now, ...more });
      const rooms = [{ spaceId: "space-project", threads: [{ id: "t1", agent: "Researcher", title: "Check the facts", status: "done", summary: "The launch date holds.", created: now, updated: now, messages: [message("b", "coordinator", "Check the launch facts"), message("c", "Researcher", "The date holds.")] }, { id: "t2", agent: "Writer", title: "Draft the note", status: "working", created: now, updated: now, messages: [message("d", "coordinator", "Draft the note")] }],
        messages: [message("m1", "you", "Check the launch"), message("m2", "coordinator", "On it.", { threads: ["t1", "t2"] }), message("m3", "Researcher", "The launch date holds.", { report: "t1" })] }];
      await store.saveState({ ...store.emptyState, rooms, chats: [{ id: "c1", title: "A long chat", spaceId: "space-subject", updated: now, messages: [{ id: "m1", role: "user", content: text }, { id: "m2", role: "assistant", content: text }] }], spaces: [{ id: "space-project", kind: "project", name: "Thesis", description: "", memory: "", sources: [] }, { id: "space-subject", kind: "subject", name: "Calculus", description: "", memory: "", sources: [] }] });
      location.hash = "/";
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { default: App } = await import("/src/App.tsx");
      ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
    });
    await page.locator(".greeting-row").waitFor();
    await page.locator(".sw").first().waitFor();
    await page.waitForTimeout(900);
    // The chat is in Calculus (standalone chats are Earlier chats since #53), folded in the sidebar until opened.
    await page.getByRole("button", { name: "Show chats in Calculus" }).click();
    await page.locator(".history-title", { hasText: "A long chat" }).first().click();
    await page.locator(".message").first().waitFor();
    await page.waitForTimeout(700);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-chat.png` });

    // A thinking popover in a glass dialog opens at its trigger, not offset by the dialog's own corner.
    await page.evaluate(() => (location.hash = "/app/projects"));
    await page.getByText("Thesis", { exact: true }).first().click();
    // The project page ends at the message box, and the wobbly line stays clear of the cards above it.
    await page.locator('.pj-report').waitFor();
    // A saved run comes back stopped, the one state besides failed that still has a word. Finished threads have none.
    assert.deepEqual(await page.locator('.pj-handoff-state').allTextContents(), ['Stopped']);
    assert.equal(await page.locator('.pj-handoff-dot').count(), 0);
    const end = await page.evaluate(() => { const w = document.querySelector('.workspace'); w.scrollTop = w.scrollHeight; return { below: w.getBoundingClientRect().bottom - document.querySelector('.pj-composer').getBoundingClientRect().bottom, scrollable: w.scrollHeight - w.clientHeight }; });
    await page.waitForTimeout(800);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-project.png` });
    assert.deepEqual(await page.evaluate(() => [...window.fades]), [], "Nothing fades around glass");
    assert.ok(end.below < 24, 'Nothing to scroll to under the message box: ' + JSON.stringify(end));
    await page.locator(".pj-team-button").click();
    await page.locator("dialog.pj-dialog[open]").waitFor();
    await page.waitForTimeout(600);
    const effort = page.locator("dialog.pj-dialog .pj-setting").first().locator("button", { hasText: "Light" });
    await effort.click();
    const pop = page.locator(".effort-pop");
    await pop.waitFor();
    await page.waitForTimeout(100);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-thinking.png` });
    const at = await effort.boundingBox(), box = await pop.boundingBox();
    assert.ok(Math.abs(box.x - at.x) < 2 && (Math.abs(box.y + box.height + 8 - at.y) < 2 || Math.abs(box.y - at.y - at.height - 8) < 2), "Popover sits at its trigger: " + JSON.stringify({ at, box }));
    await page.keyboard.press("Escape");
    await page.locator(".pj-dialog-close").click();

    // The Drive search: the frame is the field; the input inside has no box.
    const field = await page.evaluate(() => {
      const d = document.body.appendChild(document.createElement("dialog"));
      d.className = "app-modal";
      d.innerHTML = '<label class="gd-search"><input placeholder="Search Drive"></label>';
      d.showModal();
      const s = getComputedStyle(d.querySelector("input")), out = { bg: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow };
      d.remove();
      return out;
    });
    assert.deepEqual(field, { bg: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" });

    await page.evaluate(() => (location.hash = "/app/projects"));
    const rule = page.locator(".calm-squiggle").first();
    await rule.waitFor();
    assert.equal(await rule.evaluate((el) => getComputedStyle(el).color), scheme === "dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
    if (shots) { await page.waitForTimeout(1800); await page.screenshot({ path: `${shots}/${scheme}-rule.png` }); }

    await page.evaluate(() => (location.hash = "/app/settings"));
    await page.locator("dialog.st-dialog[open]").waitFor();
    // A fading ancestor cuts a backdrop filter off from what is behind it, so the dialog itself must never animate.
    assert.equal(await page.locator("dialog.st-dialog").evaluate((el) => el.getAnimations().length), 0);
    const scroller = await page.locator(".st-main").evaluate((el) => { const s = getComputedStyle(el); return { color: s.scrollbarColor, width: s.scrollbarWidth, scrolls: el.scrollHeight > el.clientHeight, gutter: el.offsetWidth - el.clientWidth }; });
    assert.deepEqual([scroller.color, scroller.width, scroller.scrolls, scroller.gutter], ["auto", "auto", true, 10], "Scrollbar is drawn by ::-webkit-scrollbar: " + JSON.stringify(scroller));
    if (shots) { await page.waitForTimeout(900); await page.screenshot({ path: `${shots}/${scheme}-settings.png` }); }

    await page.locator(".st-nav").getByRole("button", { name: "Profile", exact: true }).click();
    assert.equal(await page.locator(".st-id-text strong").evaluate((el) => getComputedStyle(el).fontWeight), "400");
    if (shots) { await page.waitForTimeout(800); await page.screenshot({ path: `${shots}/${scheme}-profile.png` }); }

    await page.locator(".st-nav").getByRole("button", { name: "Memory", exact: true }).click();
    await page.getByRole("button", { name: "Open memory" }).click();
    const row = page.locator(".memory-group li").first();
    await row.hover();
    await row.locator(".sp-menu-trigger").click();
    const item = row.locator(".sp-menu-list button").first();
    await item.waitFor();
    const look = await item.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, shadow: s.boxShadow }; });
    assert.deepEqual(look, { bg: "rgba(0, 0, 0, 0)", shadow: "none" }, "Menu rows have no surface of their own until hovered");
    const hint = await row.locator(".sp-menu-list button .menu-key").first().evaluate((key) => key.parentElement.getBoundingClientRect().right - key.getBoundingClientRect().right);
    assert.ok(hint < 12, "Key hints sit at the end of the row: " + hint);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-menu.png` });
    await page.close();
  }
  console.log("Glass polish holds in both themes.");
} finally {
  await browser.close();
  await server.close();
}
