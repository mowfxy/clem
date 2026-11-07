// Walks every screen of the workspace on the browser fixture and audits what it finds, for finishing the glass design:
// a screenshot of each, and a list of solid grey surfaces, fonts that are not Mowafy, and text too large for its control.
// Scripted data only; nothing here touches an installed Clem or a signed-in profile.
//   node scripts/glass-tour.mjs [out] [dark|light] [widthxheight]
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { openFixture, workspace } from "./verify/local-power-fixture.mjs";

const out = process.argv[2] || "test-results/glass-tour", theme = process.argv[3] || "dark";
const [width, height] = (process.argv[4] || "1440x900").split("x").map(Number);
const quietRun = process.argv.includes("--quiet");
await mkdir(out, { recursive: true });

const now = Date.now(), DAY = 864e5;
const day = (d) => { const t = new Date(now + d * DAY); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
workspace.spaces[0].examDate = day(12);
workspace.spaces.push({ id: "thesis", name: "Thesis", kind: "project", description: "Heat flow in rods.", memory: "", sources: [] });
workspace.plans = [{ id: "p", spaceId: "bio", title: "Midterm", start: day(-5), created: now, updated: now, rev: 1, tasks: [
  { id: "t1", title: "Finish organelle flashcards", due: day(-1) }, { id: "t2", title: "Past paper: membranes section", due: day(0) },
  { id: "t3", title: "Summarise week 4 lecture", due: day(2) }, { id: "t4", title: "Exam", due: day(12), kind: "milestone" }] }];
workspace.studySets[0].attempts = [{ at: now - DAY, correct: 7, total: 9 }];
workspace.studySets.push({ id: "quiz-1", spaceId: "bio", kind: "quiz", title: "Membranes quiz", created: now - DAY, attempts: [], items: [{ question: "What crosses freely?", answer: "Small non-polar molecules", options: ["Ions", "Small non-polar molecules"] }] });
workspace.automations = [];

const audit = () => {
  const found = new Map();
  const note = (kind, el, extra) => {
    const name = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
    const key = `${kind} ${name} ${extra}`;
    if (!found.has(key)) found.set(key, (el.innerText || "").trim().slice(0, 30).replace(/\s+/g, " "));
  };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const light = document.documentElement.dataset.theme === "light";
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== "hidden"; };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.closest("svg,canvas,.katex,.kinetra-diagram,.fp-page,.pdf-page,.office-page,.scene")) continue;
    const s = getComputedStyle(el), bg = parse(s.backgroundColor), r = el.getBoundingClientRect();
    if (bg && bg.a > 0.45) {
      const spread = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b), v = (bg.r + bg.g + bg.b) / 3;
      if (spread <= 10 && (light ? v < 225 && v > 90 : v > 14 && v < 150) && r.width > 16 && r.height > 12) note("GREY", el, `${s.backgroundColor}`);
    }
    if (el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const face = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      if ((el.innerText || "").trim() && !/^Mowafy/.test(face) && !el.closest("code,pre,.code-block,.fp-code,.edit-diff,.katex,.fp-text-layer,.textLayer,.fp-pdf,.pdf-studio,.pdf-text")) note("FONT", el, face);
      const size = parseFloat(s.fontSize), control = el.closest("button,[role=tab],[role=menuitem],a.secondary,.chip:not(.history-more)");
      if (control && (el.innerText || "").trim()) {
        const h = control.getBoundingClientRect().height;
        if (h > 0 && h < 60 && size / h > 0.46) note("TIGHT", control, `${size}px in ${Math.round(h)}px`);
        if (size > 15.5 && h < 60) note("LARGE", control, `${size}px`);
      }
    }
  }
  return [...found].map(([k, v]) => `${k}  «${v}»`);
};

const browser = await chromium.launch();
const initScripts = [];
if (quietRun) workspace.quiet = true;
const fixture = await openFixture(browser, { viewport: { width, height }, initScripts, replies: ["Here is the answer.\n\n```python\nprint('hello')\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |"] });
const { page, errors } = fixture;
const lines = [];
const setTheme = () => page.evaluate((name) => { document.documentElement.dataset.theme = name; window.dispatchEvent(new CustomEvent("clem-theme", { detail: name })); }, theme);
const shot = async (name) => {
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${out}/${name}.png` });
  const found = await page.evaluate(audit);
  lines.push(`## ${name}`, ...found);
};
const step = async (name, run) => {
  try { await run(); await shot(name); } catch (e) { lines.push(`## ${name}`, `STEP FAILED: ${String(e.message).split("\n")[0]}`); await page.keyboard.press("Escape").catch(() => {}); }
};
// A narrow window keeps the sidebar in a drawer, opened first.
const drawer = async () => { if (width < 761 && !await page.locator(".sidebar.open").count()) { await page.locator(".mobile-menu").click({ timeout: 3000 }); await page.waitForTimeout(350); } };
const nav = async (label) => { await drawer(); await page.locator(".sidebar .nav-item", { hasText: label }).click({ timeout: 4000 }); await page.mouse.click(width - 40, height - 40).catch(() => {}); };
const close = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); };
try {
  await setTheme();
  await page.waitForTimeout(900);
  await step("home", async () => {});
  await step("menu-attach", async () => { await page.locator(".composer-tools button").first().click(); });
  await close(); await page.mouse.click(width - 100, 40);
  await step("menu-model", async () => { await page.locator(".picker-trigger").first().click(); });
  await close(); await page.mouse.click(width - 100, 40);
  await step("slash", async () => { await page.locator(".composer textarea").fill("/"); });
  await page.locator(".composer textarea").fill("");
  await step("menu-history-filter", async () => { await drawer(); await page.locator(".history-label button").first().click(); });
  await close(); await page.mouse.click(width - 100, 40);
  await step("chat", async () => { await drawer(); await page.locator(".history-title", { hasText: "Osmosis" }).click(); });
  await step("chat-answer", async () => { await page.locator(".composer textarea").fill("Show me a table"); await page.locator(".composer textarea").press("Enter"); await page.waitForTimeout(1800); });
  await step("menu-chat", async () => { await drawer(); await page.locator(".history-row").first().hover(); await page.getByRole("button", { name: /Chat options for/ }).first().click(); });
  await close();
  await step("dialog-delete-chat", async () => { await drawer(); await page.getByRole("button", { name: /Chat options for/ }).first().click(); await page.locator(".chat-options:popover-open").getByRole("menuitem", { name: "Delete" }).click(); });
  await close();
  await step("search-everything", async () => { await page.keyboard.press("Control+Shift+F"); await page.keyboard.type("osmosis"); await page.waitForTimeout(500); });
  await close();
  await step("command-palette", async () => { await page.keyboard.press("Control+K"); });
  await close();
  await step("shortcuts", async () => { await page.keyboard.press("Control+/"); });
  await close();
  await step("visuals", () => nav("Visuals"));
  await step("files", () => nav("Files"));
  await step("file-panel", async () => { await page.getByText("Cell biology worksheet.pdf").first().click({ timeout: 4000 }); await page.waitForTimeout(1200); });
  await close();
  await step("projects", () => nav("Projects"));
  await step("project-create", async () => { await page.getByRole("button", { name: /New project/ }).first().click({ timeout: 4000 }); });
  await close();
  await step("project-page", async () => { await page.locator("main").getByText("Thesis", { exact: true }).first().click({ timeout: 4000 }); });
  await step("subjects", () => nav("Subjects"));
  await step("subject-create", async () => { await page.getByRole("button", { name: /New subject/ }).first().click({ timeout: 4000 }); });
  await close();
  await step("subject-overview", async () => { await page.locator("main").getByText("Biology 101", { exact: true }).first().click({ timeout: 4000 }); });
  for (const tab of ["Chats", "Plan", "Flashcards", "Quizzes", "Files", "Visuals", "Memory"]) {
    await step("subject-" + tab.toLowerCase(), async () => { await page.getByRole("tab", { name: new RegExp("^" + tab) }).click({ timeout: 4000 }); });
  }
  await step("menu-subject", async () => { await page.getByRole("tab", { name: /^Overview/ }).click(); await page.getByRole("button", { name: /options/i }).first().click({ timeout: 3000 }); });
  await close(); await page.mouse.click(width - 60, 60);
  for (const tab of ["Profile", "Security", "Models", "Memory", "Skills", "Automations", "Connectors", "Linked folders", "Usage", "Data & privacy", "Help & support"]) {
    await step("settings-" + tab.toLowerCase().replace(/[^a-z]+/g, "-"), async () => {
      if (!await page.locator(".st").count()) { await drawer(); await page.locator(".profile-settings").click({ timeout: 3000 }); }
      await page.locator(".st-nav button, .st-me", { hasText: tab }).first().click({ timeout: 3000 });
      await page.waitForTimeout(200);
    });
  }
  await close();
  // Pieces that only appear in rare states, mounted on their own: the account handoff and the update chip.
  await nav("New chat").catch(() => {});
  await step("account-handoff", async () => {
    await page.evaluate(async () => {
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { AccountHandoff } = await import("/src/notices/AccountHandoff.tsx");
      const models = [{ id: "claude:sonnet", name: "Claude Sonnet", provider: "Anthropic", connected: true, reasoningEfforts: [{ reasoningEffort: "high", description: "High" }] }];
      const host = document.createElement("div"); host.id = "handoff-host"; document.querySelector(".app-shell").append(host);
      ReactDOM.createRoot(host).render(React.createElement(AccountHandoff, { task: "Write the literature review", models, onChoose: () => {}, onStay: () => {} }));
    });
  });
  await page.evaluate(() => document.getElementById("handoff-host")?.remove());
  for (const phase of ["downloading", "ready", "available"]) {
    await step("update-chip-" + phase, async () => {
      await page.evaluate(async (phase) => {
        const { default: React } = await import("/node_modules/.vite/deps/react.js");
        const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { UpdateIndicator } = await import("/src/desktop/AppUpdate.tsx");
        document.getElementById("chip-host")?.remove();
        const host = document.createElement("span"); host.id = "chip-host"; host.style.display = "contents";
        document.querySelector(".sidebar-bottom").classList.add("has-update");
        document.querySelector(".account-button").after(host);
        ReactDOM.createRoot(host).render(React.createElement(UpdateIndicator, { state: { supported: true, phase, next: "0.4.0", percent: 62, automatic: false }, onInstall: () => {}, onOpen: () => {} }));
      }, phase);
    });
  }
  console.log(errors.length ? "page errors: " + errors.join("; ") : "no page errors");
} finally {
  await writeFile(`${out}/audit.txt`, lines.join("\n") + "\n");
  await fixture.close();
  await browser.close();
}
