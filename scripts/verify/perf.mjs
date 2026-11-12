// Times the screens this branch added against the real App and engine (docs/PERFORMANCE-GUC-VPS.md): home's first
// paint, home → main thread with 2,000 messages, typing there, a sidebar of 80 subjects, the GUC hub cold and warm, a
// CMS course of 500 files, Settings → Proactivity, and how many requests the window makes while idle. Long tasks
// (> 50 ms) are counted for each step. Budgets are generous (about 3× what this machine measured) so only a real
// regression fails. Usage: node scripts/verify/perf.mjs [--json]
import { chromium } from "playwright";
import { Engine } from "../../desktop/engine/index.ts";
import { fakeGuc, host, noWait, fixture } from "../../tests/guc-fake.ts";
import { bigCourse } from "../bench-guc-engine.ts";
import { urls } from "../../core/guc/parse.ts";
import { openFixture } from "./local-power-fixture.mjs";

const OWNER = "fixture-owner", now = Date.now(), day = 864e5;
const said = (id, role, content, at) => ({ id, role, content, at });
const mainMessages = Array.from({ length: 2000 }, (_, i) => said("mt-" + i, i % 2 ? "assistant" : "user", i % 2
  ? `Here's the plan for block ${i}: review your notes for twenty minutes, then do two practice questions. **Keep it short.**\n\n- One\n- Two`
  : `What should I focus on in block ${i}?`, now - (2000 - i) * 600e3));
const extraSpaces = Array.from({ length: 80 }, (_, i) => ({ id: "s" + i, name: `Subject ${String(i).padStart(2, "0")}`, kind: i % 4 ? "subject" : "project", description: "", memory: "", sources: [] }));
const extraChats = [
  { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: now - 3600e3, messages: mainMessages },
  ...extraSpaces.flatMap((s, i) => Array.from({ length: 5 }, (_, j) => ({ id: `c-${i}-${j}`, title: `${s.name} chat ${j}`, spaceId: s.id, updated: now - (i * 5 + j) * 3600e3, messages: [said(`m-${i}-${j}`, "user", "Hello", now - day)] }))),
];

// A connected engine on a fake GUC whose first course has 500 files (20 weeks × 25).
const pages = {
  [urls.home]: fixture("cms-home"), [urls.schedule]: fixture("schedule"), [urls.transcript]: fixture("transcript"),
  [urls.course(1201, 64)]: bigCourse(1201, "CSEN701 Embedded Systems Architecture", { weeks: 20, perWeek: 25 }),
  [urls.course(1202, 64)]: bigCourse(1202, "CSEN702 Microprocessors", { weeks: 4, perWeek: 5 }),
  [urls.course(1203, 64)]: bigCourse(1203, "CSEN703 Algorithms", { weeks: 4, perWeek: 5 }),
};
const guc = fakeGuc(pages);
const engine = await Engine.open(OWNER, host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
await engine.connect("student.name", "secret");
await engine.db.query("insert into subject_links (owner_id, subject_id, course_key) values ($1, 's1', '1201:64')", [OWNER]);
await engine.syncCourse("1201:64");
const o = engine.organizer;
const call = {
  gucStatus: () => engine.status(), gucOverview: () => engine.overview(), gucNow: () => engine.now(), gucInbox: () => engine.inbox(), gucAckInbox: (r) => engine.ackInbox(r.keys),
  gucNewCourses: () => engine.newCourses(), gucAckNewCourses: (r) => engine.ackNewCourses(r.keys), gucLinks: () => engine.links(), gucCourses: () => engine.courses(),
  gucSchedule: (r) => engine.schedule(r.weekStart), gucAnnouncements: (r) => engine.announcements({ courseKey: r.courseId, cursor: r.cursor }), gucMarkRead: (r) => engine.markRead(r.ids),
  gucMaterials: (r) => engine.materials(r.courseId), gucSearch: (r) => engine.search(r.query), gucGrades: (r) => engine.grades(r.courseId), gucDeadlines: () => engine.deadlines(),
  gucSubject: (r) => engine.subject(r.subjectId), gucFile: () => { throw Error("not in this check"); },
  proInbox: () => o.inbox(), proAck: (r) => o.ack(r), proStatus: (r) => o.statuses(r.keys), proSettings: (r) => (r.set ? o.setSettings(r.set) : o.settings()), proLog: () => o.log(0),
  proWatches: () => o.watches(), proMutes: () => o.mutesList(),
  tgStatus: () => ({ configured: true, bot: "ClemBot", paired: null }),
};

const json = process.argv.includes("--json");
const browser = await chromium.launch();
let failed = false;
const results = [];
const record = (metric, ms, budget, longTasks = 0) => {
  const ok = ms <= budget;
  results.push({ metric, ms: Math.round(ms), budget, longTasks });
  if (!json) console.log(`${ok ? "ok  " : "FAIL"} ${metric}: ${Math.round(ms)} ms (budget ${budget})${longTasks ? `, ${longTasks} long task${longTasks === 1 ? "" : "s"}` : ""}`);
  if (!ok) failed = true;
};
try {
  const fx = await openFixture(browser, { unfold: false,
    port: 5251, viewport: { width: 1360, height: 900 }, extraChats, extraSpaces,
    initScripts: [`try{localStorage.setItem("clem-theme","dark");localStorage.removeItem("clem-sidebar-open")}catch{}`,
      // Long tasks, from page start.
      `window.__long=[];try{new PerformanceObserver((l)=>{for(const e of l.getEntries())window.__long.push({at:e.startTime,ms:e.duration})}).observe({type:"longtask",buffered:true})}catch{}`],
    guc: async (r) => { const fn = call[r.action]; if (!fn) throw Error("Unknown " + r.action); return fn(r); },
  });
  const { page, errors } = fx;
  // Runs `act` in the page (a function source taking the page's document), then waits frames until `until` matches;
  // the time from just before the action to the frame after the result is drawn.
  const time = (act, until) => page.evaluate(async ({ act, until }) => {
    const from = performance.now(), longBefore = window.__long.length;
    new Function(act)();
    await new Promise((done) => { const tick = () => (document.querySelector(until) ? requestAnimationFrame(() => done()) : requestAnimationFrame(tick)); tick(); });
    const ms = performance.now() - from;
    return { ms, long: window.__long.slice(longBefore).filter((l) => l.at >= from).length };
  }, { act, until });

  // Home's first paint: the App remounted with its modules loaded (the window's own code path after sign-in).
  await page.waitForTimeout(800);
  const remount = await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    window.__root.unmount();
    const from = performance.now(), longBefore = window.__long.length;
    window.__root = ReactDOM.createRoot(document.getElementById("root"));
    window.__root.render(React.createElement(App, {}));
    await new Promise((done) => { const tick = () => (document.querySelector(".greeting-row") ? requestAnimationFrame(() => done()) : requestAnimationFrame(tick)); tick(); });
    return { ms: performance.now() - from, long: window.__long.slice(longBefore).length };
  });
  record("Home first paint (80 subjects, 2,000-message thread in state)", remount.ms, 900, remount.long);
  await page.waitForTimeout(1200);

  // Idle: requests the window makes in 10 s with nothing happening.
  const before = await page.evaluate(() => window.requests.length);
  await page.waitForTimeout(10_000);
  const idle = await page.evaluate((n) => window.requests.slice(n).map((r) => r.action), before);
  results.push({ metric: "Requests while idle (10 s)", count: idle.length, actions: [...new Set(idle)].join(", ") });
  if (!json) console.log(`info Requests while idle (10 s): ${idle.length}${idle.length ? " (" + [...new Set(idle)].join(", ") + ")" : ""}`);

  // Sidebar: open a subject's chats.
  const side = await time(`document.querySelector('[aria-label="Show chats in Subject 01"]').click()`, '.side-chat .history-title');
  record("Sidebar: expand a subject (80 subjects)", side.ms, 150, side.long);

  // Home → main thread with 2,000 messages.
  const toMain = await time(`[...document.querySelectorAll(".suggestions button")].find((b) => b.textContent.includes("Research a question")).click()`, ".chat-view.main-thread .main-thread-list .mt-row");
  record("Home → main thread (2,000 messages)", toMain.ms, 300, toMain.long);
  await page.waitForTimeout(1500);
  const rows = await page.locator(".main-thread-list .mt-row").count();
  if (!json) console.log(`info main thread draws ${rows} rows of 2,000`);

  // Typing in the main thread: each key to its next frame.
  const box = page.locator(".composer textarea");
  await box.fill("");
  await box.focus();
  await page.evaluate(() => { window.__keys = []; document.addEventListener("keydown", (e) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__keys.push(performance.now() - t))); }, true); });
  await page.keyboard.type("what should I revise tonight", { delay: 40 });
  await page.waitForTimeout(300);
  const keys = await page.evaluate(() => window.__keys);
  const p95 = [...keys].sort((a, b) => a - b)[Math.floor(keys.length * 0.95) - 1] ?? 0;
  record("Typing in the main thread: key → frame (p95)", p95, 100);
  await box.fill("");

  // Scrolling up pages older messages in.
  const older = await page.evaluate(async () => {
    const list = document.querySelector(".main-thread-list"), was = Number(list.getAttribute("data-older")), from = performance.now(), longBefore = window.__long.length;
    document.querySelector(".workspace").scrollTop = 0;
    await new Promise((done) => { const tick = () => (Number(list.getAttribute("data-older")) < was ? requestAnimationFrame(() => done()) : requestAnimationFrame(tick)); tick(); });
    return { ms: performance.now() - from, long: window.__long.slice(longBefore).length };
  });
  record("Main thread: scroll up loads an older page", older.ms, 300, older.long);

  // The GUC hub: cold (chunk and data), then warm.
  const hubCold = await time(`[...document.querySelectorAll(".sidebar .nav-item")].find((b) => b.textContent.includes("GUC")).click()`, ".guc-hub .guc-slot");
  record("GUC hub, cold (code + schedule)", hubCold.ms, 1500, hubCold.long);
  await page.locator(".nav-item", { hasText: "Clem" }).click();
  await page.locator(".chat-view.main-thread").waitFor();
  const hubWarm = await time(`[...document.querySelectorAll(".sidebar .nav-item")].find((b) => b.textContent.includes("GUC")).click()`, ".guc-hub .guc-slot");
  record("GUC hub, warm", hubWarm.ms, 150, hubWarm.long);
  const tab = (label) => `[...document.querySelectorAll(".guc-tabs [role=tab]")].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`;
  const ann = await time(tab("Announcements"), ".guc-panel .guc-ann");
  record("GUC hub: Announcements tab, cold", ann.ms, 600, ann.long);
  const cms = await time(tab("CMS"), ".guc-panel .guc-courses button");
  record("GUC hub: CMS tab, cold", cms.ms, 600, cms.long);
  const course = await time(`[...document.querySelectorAll(".guc-courses button")].find((b) => b.textContent.includes("CSEN 701")).click()`, ".guc-panel .guc-file");
  record("CMS: open a course of 500 files, cold", course.ms, 900, course.long);
  const files = await page.locator(".guc-panel .guc-file").count();
  if (!json) console.log(`info CMS course draws ${files} file rows of 500`);
  await time(tab("Schedule"), ".guc-panel .guc-slot");
  const cmsWarm = await time(tab("CMS"), ".guc-panel .guc-file");
  record("GUC hub: back to a 500-file course, warm", cmsWarm.ms, 150, cmsWarm.long);

  // Settings → Proactivity.
  await page.keyboard.press("Control+,");
  await page.locator(".st-dialog").waitFor();
  const pro = await time(`[...document.querySelectorAll(".st-nav button")].find((b) => b.textContent.includes("Proactivity")).click()`, ".st-dialog .st-card-wrap");
  record("Settings → Proactivity", pro.ms, 300, pro.long);
  await page.keyboard.press("Escape");

  if (errors.length) { failed = true; console.log("FAIL page errors: " + errors.join("; ")); }
  await fx.close();
} finally {
  await browser.close();
  await engine.close();
}
if (json) console.log(JSON.stringify(results));
process.exit(failed ? 1 : 0);
