// Checks the main thread against the real App, in dark and light: home's box opens the main thread with what was typed;
// the thread is virtualized and pages older messages in; @ offers subjects and projects; a mention (dark) or a confident
// match (light) hands the message to the subject's chat and leaves a card; the sidebar lists subjects and projects only;
// Earlier chats are read-only with "Move to…"; Settings → Proactivity picks Clem's organizer.
// Usage: node scripts/verify/main-thread.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/main-thread";
await mkdir(out, { recursive: true });
const now = Date.now(), day = 864e5;
const said = (id, role, content, at) => ({ id, role, content, at });
const mainMessages = Array.from({ length: 90 }, (_, i) => said("mt-" + i, i % 2 ? "assistant" : "user", i % 2
  ? `Here's the plan for block ${i}: review your notes for twenty minutes, then do two practice questions. **Keep it short.**`
  : `What should I focus on in block ${i}?`, now - (90 - i) * 3600e3));
const extraSpaces = [
  { id: "circ", name: "Circuits", kind: "subject", description: "ELCT 201", memory: "", sources: [] },
  { id: "site", name: "Portfolio website", kind: "project", description: "", memory: "", sources: [] },
];
const extraChats = [
  { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: now - 3600e3, messages: mainMessages },
  { id: "c-old-1", title: "Travel checklist for the summer", spaceId: null, updated: now - 40 * day, messages: [said("o1", "user", "Make me a packing list.", now - 40 * day), said("o2", "assistant", "Passport, charger, adaptor, and a light jacket.", now - 40 * day)] },
  { id: "c-old-2", title: "Cover letter draft", spaceId: null, updated: now - 60 * day, messages: [said("o3", "user", "Draft a cover letter.", now - 60 * day)] },
  { id: "c-circ", title: "Thevenin equivalents", spaceId: "circ", updated: now - day, messages: [said("c1", "user", "Explain Thevenin.", now - day), said("c2", "assistant", "Replace the network with one source and one resistor.", now - day)] },
  { id: "c-site", title: "Navbar layout", spaceId: "site", updated: now - 2 * day, messages: [said("s1", "user", "Fix the navbar.", now - 2 * day)] },
];

const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  for (const theme of ["dark", "light"]) {
    const fixture = await openFixture(browser, { unfold: false,
      port: 5231, viewport: { width: 1360, height: 860 }, extraChats, extraSpaces,
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)});localStorage.removeItem("clem-sidebar-open")}catch{}`],
      replies: [theme === "dark" ? "Osmosis moves water toward the side with more solute, so the potato cells took water in." : "The Krebs cycle turns acetyl-CoA into CO2 and energy carriers.", "Here is a calm evening: one hour of review, then rest."],
    });
    const { page, errors } = fixture;
    const shot = async (name, opts = {}) => { await page.waitForTimeout(700); return page.screenshot({ path: `${out}/main-${name}-${theme}.png`, ...opts }); };
    try {
      await page.waitForTimeout(600);
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      // Home: the new-chat screen with its widgets.
      check(await page.locator(".nav-item.active", { hasText: "Home" }).count() === 1, `${theme}: app opens on Home`);
      await shot("home");

      // Sidebar: subjects and projects only, no standalone history.
      const spaces = await page.locator(".side-space .history-title").allTextContents();
      check(spaces.join("|") === "Biology 101|Circuits|Portfolio website", `${theme}: sidebar lists subjects then projects (${spaces.join(", ")})`);
      check(await page.getByText("Travel checklist for the summer").count() === 0, `${theme}: standalone chats are not in the sidebar`);
      await page.getByRole("button", { name: "Show chats in Biology 101" }).click();
      await page.getByRole("button", { name: "Show chats in Circuits" }).click();
      check(await page.locator(".side-chat .history-title", { hasText: "Osmosis lab write-up" }).isVisible(), `${theme}: a subject opens to its chats`);
      check(await page.evaluate(() => JSON.parse(localStorage.getItem("clem-sidebar-open") || "[]").includes("bio")), `${theme}: open subjects are remembered`);
      await page.locator(".sidebar").screenshot({ path: `${out}/main-sidebar-${theme}.png` });

      // Home's box → the main thread, with the text carried and the caret kept.
      await page.locator(".suggestions button", { hasText: "Research a question" }).click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 3000 });
      const box = page.locator(".composer textarea");
      check(await box.inputValue() === "Help me research ", `${theme}: typed text carries into the main thread`);
      check(await box.evaluate((el) => el === document.activeElement), `${theme}: the box keeps the caret`);
      const rows = await page.locator(".main-thread-list .mt-row").count();
      const older = Number(await page.locator(".main-thread-list").getAttribute("data-older"));
      check(rows > 0 && rows < 30 && older === 60, `${theme}: newest page first, virtualized (${rows} rows drawn, ${older} older not loaded)`);
      check(await page.locator(".main-thread-list .message").last().textContent().then((t) => /block 89/.test(t || "")), `${theme}: the newest message is shown`);
      check(await page.locator(".chat-view.main-thread .model-selector").count() === 0, `${theme}: no model picker in the main thread (it is chosen in Settings → Proactivity)`);
      check(await page.locator(".workspace-top .chat-files").count() === 0, `${theme}: no Files button in the main thread's top bar`);
      await shot("thread");
      // Older pages load on scroll up.
      for (let i = 0; i < 12; i++) { await page.locator(".workspace").evaluate((el) => { el.scrollTop = 0; }); await page.waitForTimeout(120); }
      const olderNow = Number(await page.locator(".main-thread-list").getAttribute("data-older"));
      check(olderNow < older, `${theme}: scrolling up loads older pages (${older} → ${olderNow} not loaded)`);
      await page.locator(".workspace").evaluate((el) => { el.scrollTop = el.scrollHeight; });

      // @ mentions: a keyboard-first popover of subjects and projects.
      await box.fill("");
      await box.pressSequentially("@circ");
      const menu = page.locator(".mention-menu");
      await menu.waitFor({ timeout: 2000 });
      check((await menu.locator("[role=option]").first().textContent())?.includes("Circuits"), `${theme}: @ offers subjects and projects, best match first`);
      await shot("mention");
      await box.press("Escape");
      await box.fill("");

      if (theme === "dark") {
        await box.pressSequentially("@bio");
        await box.press("Enter");
        check(await page.locator(".composer .mention-chip", { hasText: "Biology 101" }).isVisible(), `${theme}: choosing inserts a chip`);
        check(await box.inputValue() === "", `${theme}: the @name leaves the text`);
        await box.pressSequentially("why did the potato gain mass?");
      } else {
        await box.pressSequentially("Walk me through the Krebs cycle again for Biology 101");
      }
      await box.press("Enter");
      // Hand-off: the subject's latest chat answers; the main thread keeps a card.
      await page.locator(".top-space", { hasText: "Biology 101" }).waitFor({ timeout: 4000 });
      check(await page.locator(".top-title").textContent() === "Osmosis lab write-up", `${theme}: handed to the subject's most recent chat`);
      await page.locator(".message.assistant.latest .message-text").filter({ hasText: theme === "dark" ? "Osmosis moves water" : "Krebs cycle turns" }).waitFor({ timeout: 8000 });
      check(await page.locator(".message.user.latest, .message.user").last().locator(".carried-note").count() === 1, `${theme}: the question arrives with a carried note`);
      await shot("handoff-chat");
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      const card = page.locator(".clem-handoff").last();
      await card.waitFor({ timeout: 3000 });
      check((await card.textContent())?.includes("Continued in Biology 101"), `${theme}: the main thread shows "Continued in Biology 101"`);
      const sent = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
      check(sent?.scope === "subject:bio", `${theme}: the turn is scoped to the subject (${sent?.scope})`);
      await shot("handoff");
      await card.click();
      check(await page.locator(".top-title").textContent() === "Osmosis lab write-up", `${theme}: the card opens the chat`);

      // A message for no one subject stays and is answered with the budgeted context.
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      await box.fill("plan my evening please");
      await box.press("Enter");
      await page.waitForTimeout(900);
      check(await page.locator(".chat-view.main-thread").count() === 1, `${theme}: an unclear message stays in the main thread`);
      const req = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
      const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
      check(req.messages.some((m) => m.role === "system" && m.content.startsWith("Now:")) && chars < 12000 * 4 + 4000, `${theme}: main-thread request is layered and within budget (${Math.round(chars / 4)} tokens, ${req.messages.length} messages)`);

      // Earlier chats in Settings → Data & privacy, read-only, with Move to…
      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      await page.locator(".st-nav button", { hasText: "Data & privacy" }).click();
      const earlier = page.locator(".st-card-wrap", { hasText: "Earlier chats" });
      await earlier.waitFor();
      check(await earlier.getByText("Travel checklist for the summer").isVisible(), `${theme}: Earlier chats lists standalone chats`);
      await earlier.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600); await page.locator(".st-dialog").screenshot({ path: `${out}/main-earlier-${theme}.png` });
      await page.locator(".st-nav button", { hasText: "Proactivity" }).click();
      await page.getByText("Clem’s organizer").waitFor();
      check(await page.getByRole("button", { name: /Choose Clem’s organizer model/ }).count() >= 1, `${theme}: Proactivity has the organizer model picker`);
      await page.waitForTimeout(600); await page.locator(".st-dialog").screenshot({ path: `${out}/main-proactivity-${theme}.png` });
      await page.locator(".st-nav button", { hasText: "Data & privacy" }).click();
      await page.locator(".st-card-wrap", { hasText: "Earlier chats" }).locator(".st-row", { hasText: "Travel checklist" }).getByRole("button", { name: "Open" }).click();
      await page.locator(".earlier-bar").waitFor({ timeout: 3000 });
      check(await page.locator(".chat-composer .composer").count() === 0, `${theme}: an earlier chat is read-only (no composer)`);
      await shot("earlier-chat");
      if (theme === "light") {
        await page.locator(".earlier-bar .pick-trigger").click();
        await page.locator(".pick-menu:popover-open").getByRole("menuitemradio", { name: "Circuits" }).click();
        await page.locator(".chat-composer .composer").waitFor({ timeout: 2000 });
        check(await page.locator(".side-chat .history-title", { hasText: "Travel checklist" }).isVisible(), `${theme}: moving files the chat under its subject`);
      }
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } finally {
      await fixture.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
