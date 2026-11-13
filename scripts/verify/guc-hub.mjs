// The GUC hub against the real App and the real engine reads (desktop/engine on PGlite, synced from the fixture GUC in
// tests/fixtures/guc), in dark and light: the sidebar entry, each tab, a PDF preview, search, deep links, the auth
// banner and a subject's CMS tab. Every engine call waits LATENCY ms, so a tab drawn faster than that came from cache;
// the time to first rows is measured cold, warm (memory) and after a reload (IndexedDB).
// Usage: node scripts/verify/guc-hub.mjs [out-dir]   (screenshots are hub-*.png)
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mockLocalStorage } from "./fixture-local-storage.mjs";
import { handoutPdf } from "./fixture-docs.mjs";
import { Engine } from "../../desktop/engine/index.ts";
import { fakeGuc, host, noWait, site } from "../../tests/guc-fake.ts";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/guc-hub";
await mkdir(out, { recursive: true });
const LATENCY = 350, OWNER = "fixture-owner";
const browser = await chromium.launch();
const pdf = await handoutPdf(browser);
const files = Object.fromEntries(["lecture-1", "lecture-3", "tutorial-3"].map((n) => ["https://cms.guc.edu.eg/Uploads/1201/64/" + n + ".pdf", new Uint8Array(pdf)]));
const guc = fakeGuc(site(), { files });
const engine = await Engine.open(OWNER, host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
await engine.connect("student.name", "secret");
await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 'embedded', '1201:64')", [OWNER]);
const deadline = (await engine.deadlines())[0];

const read = {
  gucOverview: () => engine.overview(), gucCourses: () => engine.courses(), gucSchedule: (r) => engine.schedule(r.weekStart),
  gucAnnouncements: (r) => engine.announcements({ courseKey: r.courseId, cursor: r.cursor }), gucMarkRead: (r) => engine.markRead(r.ids),
  gucMaterials: (r) => engine.materials(r.courseId), gucSearch: (r) => engine.search(r.query), gucGrades: (r) => engine.grades(r.courseId),
  gucDeadlines: () => engine.deadlines(), gucTerm: () => engine.term(), gucMail: () => engine.mail(), gucFile: async (r) => { const { path, ...f } = await engine.file(r.materialId); return f; },
  gucStatus: () => engine.status(), gucSync: () => engine.status(),
  gucSubject: (r) => engine.subject(r.subjectId), gucLinks: () => engine.links(), gucNewCourses: () => engine.newCourses(),
};
const server = await createServer({ server: { host: "127.0.0.1", port: 5233, strictPort: true }, logLevel: "error" });
await server.listen();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const timings = [];
const day = 864e5, now = Date.now();
const state = {
  spaces: [
    { id: "embedded", name: "Embedded Systems", kind: "subject", description: "CSEN 701", memory: "", sources: [] },
    { id: "bio", name: "Biology 101", kind: "subject", description: "", memory: "", sources: [] },
  ],
  chats: [{ id: "c1", title: "Interrupt latency", spaceId: "embedded", updated: now - day, messages: [{ id: "m1", role: "user", content: "How fast is an ISR?" }] }],
};

try {
  for (const theme of ["dark", "light"]) {
    await engine.db.query("update guc_announcements set read_at = null where owner_id = $1", [OWNER]);
    const context = await browser.newContext({ viewport: { width: 1360, height: 880 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.exposeFunction("__guc", async (json) => { const r = JSON.parse(json); await new Promise((d) => setTimeout(d, LATENCY)); return JSON.stringify(await read[r.action](r)); });
    await page.addInitScript(({ theme }) => {
      try { localStorage.setItem("clem-theme", theme); } catch {}
      const guc = new Set();
      window.requests = [];
      window.fireGuc = (p) => { for (const fn of guc) fn(p); };
      window.clemDesktop = {
        onAuth: () => () => {}, onChat: () => () => {},
        onGuc: (fn) => { guc.add(fn); return () => guc.delete(fn); },
        invoke: async (r) => {
          window.requests.push(r);
          if (r.action.startsWith("guc")) {
            const result = JSON.parse(await window.__guc(JSON.stringify(r)));
            if (r.action === "gucSync") window.fireGuc({ phase: "done", done: 1, total: 1, label: "Up to date" });
            return result;
          }
          if (r.action === "folders") return [];
          if (r.action === "memoryList") return { enabled: true, records: [] };
          if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
          if (r.action === "providerAccounts") return { accounts: [], active: null, autoSwitch: false };
          return {};
        },
      };
    }, { theme });
    await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/popups.css"><link rel="stylesheet" href="/src/desktop/desktop.css">' }));
    await page.route("**/api/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.includes("/api/local/")) return r.fallback();
      return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: OWNER, email: "sam@example.com" }, auth: true } : path.endsWith("models") ? [] : {} });
    });
    await mockLocalStorage(page);
    // CMS files through the engine, as desktop/main.ts serves clem://app/api/local/guc/file/<id>.
    await page.route("**/api/local/guc/file/*", async (r) => {
      try { const f = await engine.file(r.request().url().split("/").at(-1)); return r.fulfill({ body: await readFile(f.path), contentType: f.type }); }
      catch (e) { return r.fulfill({ status: 502, json: { error: e.message } }); }
    });
    const boot = async (hash) => {
      await page.goto("http://127.0.0.1:5233/fixture");
      await page.evaluate(async ({ state, hash }) => {
        const { default: RefreshRuntime } = await import("/@react-refresh");
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true;
        const store = await import("/src/store.ts");
        store.setStorageNamespace("fixture-owner");
        if (state) await store.saveState({ ...store.emptyState, ...state });
        location.hash = hash;
        const { default: React } = await import("/node_modules/.vite/deps/react.js");
        const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { default: App } = await import("/src/App.tsx");
        ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
      }, { state: hash === "/app" ? state : null, hash });
    };
    const shot = async (name, el) => { await page.waitForTimeout(450); await (el ? page.locator(el) : page).screenshot({ path: join(out, `hub-${name}-${theme}.png`) }); };
    /** Clicks a hub tab in the page and times it to its first real row (not a skeleton). */
    const timeTab = (label, selector) => page.evaluate(({ label, selector }) => new Promise((done) => {
      const tab = [...document.querySelectorAll(".guc-tabs [role=tab]")].find((b) => b.textContent.startsWith(label));
      const t0 = performance.now(); tab.click();
      const tick = () => document.querySelector(".guc-panel " + selector) ? done(Math.round(performance.now() - t0)) : requestAnimationFrame(tick);
      tick();
    }), { label, selector });
    const tabs = [["Schedule", ".guc-slot"], ["Announcements", ".guc-ann"], ["CMS", ".guc-file"], ["Grades", ".guc-grade"], ["Deadlines", ".guc-deadline"]];

    try {
      await boot("/app");
      await page.locator(".greeting-row").waitFor();
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      const nav = page.locator(".sidebar .nav-item", { hasText: "GUC" });
      await nav.waitFor({ timeout: 5000 });
      check(true, `${theme}: GUC shows in the sidebar while connected`);
      await nav.hover();
      await nav.click();
      await page.locator(".guc-hub .guc-tabs").waitFor();
      check(await page.evaluate(() => location.hash) === "#/app/guc", `${theme}: one tap from the sidebar opens #/app/guc`);
      if (await page.locator(".guc-skel").count()) await shot("skeleton");
      await page.locator(".guc-slot").first().waitFor();
      check(await page.locator(".guc-day.is-today").count() === (new Date().getDay() === 5 ? 0 : 1), `${theme}: today is highlighted`);
      check(await page.locator(".guc-slot").count() === 5, `${theme}: the timetable holds the 5 fixture classes`);
      await shot("schedule");
      await page.getByRole("button", { name: "Next week" }).click();
      await page.getByRole("button", { name: "This week" }).waitFor();
      check(await page.locator(".guc-slot").count() === 5 && await page.locator(".guc-skel").count() === 0, `${theme}: another week draws at once from the timetable it has`);
      await page.getByRole("button", { name: "This week" }).click();

      const cold = {};
      for (const [label, sel] of tabs.slice(1)) cold[label] = await timeTab(label, sel);
      // Announcements: unread dots, marked read on view.
      await timeTab("Announcements", ".guc-ann");
      check(await page.locator(".guc-ann.is-unread .guc-dot").count() > 0, `${theme}: unread announcements have a dot and bold text`);
      await page.waitForFunction(() => window.requests.some((r) => r.action === "gucMarkRead"), null, { timeout: 4000 }).then(() => check(true, `${theme}: announcements in view are marked read`), () => check(false, `${theme}: announcements in view are marked read`));
      await shot("announcements");
      await page.locator(".guc-bar .pick-trigger").click();
      await page.locator(".pick-menu:popover-open").getByRole("menuitemradio", { name: "CSEN 701" }).click();
      await page.waitForFunction(() => [...document.querySelectorAll(".guc-ann header b")].every((b) => b.textContent === "CSEN 701") && document.querySelectorAll(".guc-ann").length > 0);
      check(true, `${theme}: announcements filter by course`);

      // CMS: course → week → files, hover prefetch, preview, search.
      await timeTab("CMS", ".guc-file");
      await page.locator(".guc-courses button", { hasText: "CSEN 701" }).click();
      await page.locator(".guc-week").first().waitFor();
      check((await page.locator(".guc-week").allTextContents()).length === 2, `${theme}: files are grouped by week`);
      await page.locator(".guc-file", { hasText: "Lecture 3" }).hover();
      await page.waitForFunction(() => window.requests.some((r) => r.action === "gucFile"), null, { timeout: 3000 }).then(() => check(true, `${theme}: hovering a file warms it`), () => check(false, `${theme}: hovering a file warms it`));
      await shot("cms");
      const t0 = Date.now();
      await page.getByRole("button", { name: "Preview Lecture 3" }).click();
      const drawn = await page.locator(".ps-page canvas, .ps-page .ps-still").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      check(drawn, `${theme}: the PDF preview draws its first page`);
      if (drawn) timings.push(`${theme}: PDF preview first page ${Date.now() - t0} ms`);
      check(await page.locator(".fp-crumb", { hasText: "GUC CMS" }).count() === 1, `${theme}: the CMS file opens in Clem's file viewer`);
      await shot("preview");
      await page.keyboard.press("Escape");
      await page.locator(".fp-head").waitFor({ state: "detached" }).catch(() => {});
      await page.getByLabel("Search all courses").fill("quiz");
      await page.locator(".guc-hit").first().waitFor();
      check(await page.locator(".guc-hit").count() >= 1, `${theme}: search finds announcements across courses`);
      await shot("search");
      await page.getByLabel("Search all courses").fill("lecture 3");
      await page.locator(".guc-results .guc-file").first().waitFor();
      check(await page.locator(".guc-results .guc-file").count() >= 2, `${theme}: search finds files across courses`);
      await page.getByLabel("Search all courses").fill("");

      await timeTab("Grades", ".guc-grade");
      check(await page.locator(".guc-sem.is-latest h3", { hasText: "Spring 2026" }).count() === 1, `${theme}: the newest semester is highlighted`);
      await shot("grades");
      await timeTab("Deadlines", ".guc-deadline");
      check(await page.locator(".guc-when").first().textContent().then((t) => /^(in |today|tomorrow|\w{3} at)/.test(t)), `${theme}: deadlines read as relative times`);
      await shot("deadlines");
      await timeTab("Exams", ".guc-exam");
      check(await page.locator(".guc-exam").count() === 2, `${theme}: both exam seats show`);
      await shot("exams");
      await timeTab("Mail", ".guc-mail li");
      check(await page.locator(".guc-mail li", { hasText: "Welcome back" }).count() === 1, `${theme}: the Inbox shows`);
      await shot("mail");
      await timeTab("Grades", ".guc-term");
      check(await page.locator(".guc-term .guc-grade", { hasText: "81.5" }).count() === 1, `${theme}: this term's midterms show above the transcript`);
      await page.locator(".guc-work summary").first().click();
      await shot("term");

      const warm = {};
      for (const [label, sel] of tabs) warm[label] = await timeTab(label, sel);

      // Deep links to exact items.
      await page.evaluate((id) => { location.hash = "/app/guc/deadlines/" + id; }, deadline.id);
      await page.locator(`.guc-deadlines li.is-focus[data-deadline="${deadline.id}"]`).waitFor({ timeout: 4000 }).then(() => check(true, `${theme}: #/app/guc/deadlines/<id> focuses that deadline`), () => check(false, `${theme}: deadline deep link`));
      await page.evaluate(() => { location.hash = "/app/guc/cms/1201%3A64/900101"; });
      await page.locator(".fp-head", { hasText: "Lecture 1" }).waitFor({ timeout: 15000 }).then(() => check(true, `${theme}: #/app/guc/cms/<course>/<file> opens that file`), () => check(false, `${theme}: file deep link`));
      await page.keyboard.press("Escape");

      // A subject's CMS tab shows its linked course and opens it in the hub; an unlinked subject offers courses to link.
      await page.locator(".side-space .history-title", { hasText: "Embedded Systems" }).click();
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-subject .guc-file").first().waitFor();
      await shot("subject-linked");
      await page.locator(".guc-subject").getByRole("button", { name: "Open in CMS" }).click();
      await page.locator(".guc-courses button.active", { hasText: "CSEN 701" }).waitFor();
      check(await page.evaluate(() => location.hash) === "#/app/guc/cms/1201%3A64", `${theme}: a subject's CMS tab opens its course in the hub`);
      await page.locator(".side-space .history-title", { hasText: "Biology 101" }).click();
      await page.getByRole("tab", { name: "CMS" }).click();
      await page.locator(".guc-link-pick").getByText("Link a CMS course").waitFor();
      await shot("subject-unlinked");
      check(true, `${theme}: an unlinked subject shows "Link a CMS course"`);

      // After a reload the hub draws from IndexedDB before the engine answers.
      await boot("/app/guc/announcements");
      const fromDisk = await page.evaluate(() => new Promise((done) => { const t0 = performance.now(); const tick = () => document.querySelector(".guc-panel .guc-ann") ? done(Math.round(performance.now() - t0)) : requestAnimationFrame(tick); tick(); }));
      const disk = { Announcements: fromDisk };
      for (const [label, sel] of [tabs[0], ...tabs.slice(2)]) disk[label] = await timeTab(label, sel);
      timings.push(`${theme}: first rows cold (engine ${LATENCY} ms) ${JSON.stringify(cold)}`, `${theme}: warm from memory ${JSON.stringify(warm)}`, `${theme}: after reload from IndexedDB ${JSON.stringify(disk)} (announcements measured from App start)`);
      check(Object.values(warm).every((ms) => ms < 100), `${theme}: every tab draws from memory in under 100 ms`);
      check(Object.entries(disk).filter(([k]) => k !== "Announcements").every(([, ms]) => ms < LATENCY), `${theme}: after a reload, tabs draw from IndexedDB before the engine answers`);

      // GUC refused the password: the banner offers Reconnect.
      await engine.db.query(`update guc_account set last_error = '{"kind":"auth","message":"GUC didn''t accept your username or password."}' where owner_id = $1`, [OWNER]);
      await page.getByRole("button", { name: "Sync now" }).click();
      await page.locator(".guc-banner").getByRole("button", { name: "Reconnect" }).waitFor({ timeout: 5000 }).then(() => check(true, `${theme}: a refused password shows Reconnect`), () => check(false, `${theme}: auth banner`));
      await shot("auth-error");
      await page.locator(".guc-banner").getByRole("button", { name: "Reconnect" }).click();
      await page.getByRole("heading", { name: "GUC is connected" }).waitFor({ timeout: 4000 }).then(() => check(true, `${theme}: Reconnect opens the GUC sign-in`), () => check(false, `${theme}: Reconnect opens the GUC dialog`));
      await page.keyboard.press("Escape");
      await engine.db.query("update guc_account set last_error = null where owner_id = $1", [OWNER]);
      await page.getByRole("button", { name: "Sync now" }).click();
      await page.locator(".guc-banner").waitFor({ state: "detached" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { location.hash = "/app/guc/cms/1201%3A64"; });
      await page.locator(".guc-file").first().waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}: no sideways scroll at phone width`);
      await shot("phone");
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } finally { await context.close(); }
  }
} finally {
  await browser.close(); await server.close(); await engine.close();
}
for (const t of timings) console.log("time " + t);
console.log(failed ? "GUC hub check failed." : "GUC hub verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
