// Captures the product film's footage: the real Mowr interface at 2× pixel density, driven through
// the story, with every cursor move, click and point of interest logged for the compositor.
//   node scripts/film/capture.mjs          scripted demo in the browser fixture
//   node scripts/film/capture.mjs --live   the desktop app, GPT-6 Luna at medium reasoning
import { chromium, _electron as electron } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openFixture, workspace, notes } from "../verify/local-power-fixture.mjs";
import { handoutPdf } from "../verify/fixture-docs.mjs";

export const VIEW = { width: 1600, height: 900 };
const setup = process.argv.includes("--live-setup"), live = setup || process.argv.includes("--live");
const MODEL = { match: /luna/i, name: "GPT-6 Luna", effort: "Medium" };
const out = resolve(".work/ads", live ? "live" : "demo"), frameDir = join(out, "frames");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => Date.now() / 1000;

let page, cdp;
const log = { view: VIEW, live, model: live ? `${MODEL.name} · medium reasoning` : null, frames: [], cursor: [], focus: [], events: [], marks: {} };
let pos = { x: VIEW.width * 0.62, y: VIEW.height * 0.7 }, frameNo = 0, writing = Promise.resolve();

async function startScreencast() {
  cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const n = ++frameNo, file = String(n).padStart(6, "0") + ".jpg";
    log.frames.push({ file, t: metadata.timestamp });
    writing = writing.then(() => writeFile(join(frameDir, file), Buffer.from(data, "base64")));
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: VIEW.width * 2, maxHeight: VIEW.height * 2, everyNthFrame: 1 });
}
const mark = (name) => { log.marks[name] = clock(); };
const event = (kind, data = {}) => log.events.push({ t: clock(), kind, ...data });
/** A pause meant to be watched; the compositor keeps it at normal speed. Other waits are trimmed. */
const hold = async (ms) => { event("hold", { dur: ms / 1000 }); await wait(ms); };
/** Points the camera at a region (CSS pixels of the app) with a zoom; `null` shows the whole app. */
async function focus(target, zoom = 1.6) {
  let box = null;
  if (target && typeof target.boundingBox === "function") { await target.waitFor({ state: "visible", timeout: 60_000 }); box = await target.boundingBox(); }
  else if (target) box = target;
  log.focus.push({ t: clock(), box, zoom: box ? zoom : 1 });
}
/** The cursor is drawn by the compositor from this log, so the page only gets the final move:
 *  synthetic moves are slow while the 2× screencast runs. */
async function moveTo(x, y, ms = 650) {
  const from = { ...pos }, start = clock(), steps = Math.max(10, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    log.cursor.push({ t: start + (ms / 1000) * k, x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e });
  }
  await wait(ms);
  await page.mouse.move(x, y);
  pos = { x, y };
}
async function click(locator, { pause = 350, sound = "click" } = {}) {
  await locator.waitFor({ state: "visible", timeout: live ? 240_000 : 30_000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await moveTo(box.x + box.width / 2, box.y + box.height / 2);
  await wait(140);
  event("down", { x: pos.x, y: pos.y, sound });
  await page.mouse.down(); await wait(90); await page.mouse.up();
  event("up", { x: pos.x, y: pos.y });
  await wait(pause);
  return box;
}
async function type(locator, text, perChar = 45) {
  await click(locator, { pause: 150 });
  event("typing", { chars: text.length, perChar });
  const start = clock();
  for (let i = 0; i < text.length; i += 2) {
    await page.keyboard.insertText(text.slice(i, i + 2));
    const due = start + ((i + 2) * perChar) / 1000 - clock();
    if (due > 0) await wait(due * 1000);
  }
}

async function startDemo() {
  const browser = await chromium.launch();
  const opened = await openFixture(browser, { viewport: VIEW, deviceScaleFactor: 2,
    models: [{ id: "gpt-6-luna", name: MODEL.name, provider: "OpenAI", connected: true, context: 200000, specialties: [], tools: [], isDefault: true, defaultReasoningEffort: "medium", reasoningEfforts: [{ reasoningEffort: "low", description: "Light" }, { reasoningEffort: "medium", description: "Medium" }, { reasoningEffort: "high", description: "High" }] }] });
  page = opened.page;
  return { finish: async () => { await opened.close(); await browser.close(); } };
}

async function startLive() {
  const profile = resolve(process.env.LOCALAPPDATA || out, "Mowr ad profile"), work = resolve("ads/work");
  const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), `--user-data-dir=${profile}`] });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, s) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(s.width, s.height); w.center(); }, VIEW);
  if (setup) {
    console.log("Sign in, finish setup and connect the ChatGPT account with GPT-6 Luna (Settings → Models) in this separate ad profile. Close the window when done.");
    await new Promise((r) => app.on("close", r));
    process.exit(0);
  }
  await page.locator(".greeting-row").waitFor({ timeout: 60_000 }).catch(() => { throw Error("The ad profile is not signed in. Run: npm run film:live-setup"); });
  // Seed the ad profile: the Biology subject with folders, cards and chats, a linked notes folder and the handout.
  await mkdir(join(work, "Biology 101"), { recursive: true });
  for (const [path, text] of Object.entries(notes)) { await mkdir(join(work, "Biology 101", path, ".."), { recursive: true }); await writeFile(join(work, "Biology 101", path), text); }
  const browser = await chromium.launch(); await writeFile(join(work, "Osmosis lab handout.pdf"), await handoutPdf(browser)); await browser.close();
  const id = await page.evaluate(async (seed) => {
    const session = await (await fetch("/api/auth/session")).json(), owner = session.user.id, headers = { "X-Mowr-Owner": owner };
    const state = (await (await fetch("/api/local/state", { headers })).json()) || {};
    const has = (state.spaces || []).find((s) => s.name === "Biology 101");
    if (has) return has.id;
    const next = { chats: [], spaces: [], files: [], skills: [], visuals: [], automations: [], studySets: [], name: seed.name, memory: "", quiet: false, ...state };
    next.spaces = [...next.spaces, { ...seed.spaces[0], sources: [] }];
    next.chats = [...next.chats, ...seed.chats]; next.studySets = [...next.studySets, ...seed.studySets];
    await fetch("/api/local/state", { method: "PUT", headers, body: JSON.stringify(next) });
    location.reload();
    return seed.spaces[0].id;
  }, workspace);
  await page.locator(".greeting-row").waitFor();
  const linked = await page.evaluate(() => window.mowrDesktop.invoke({ action: "foldersAll" }));
  if (!linked.some((f) => f.scope === "subject:" + id)) {
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(work, "Biology 101"));
    await page.evaluate((scope) => window.mowrDesktop.invoke({ action: "linkFolder", scope }), "subject:" + id);
  }
  await page.locator(".picker-trigger").first().click();
  const row = page.locator(".picker-model-row").filter({ hasText: MODEL.match });
  if (!(await row.count())) throw Error(`${MODEL.name} is not in your model list. Connect the ChatGPT account that has it, then retry.`);
  await row.first().click();
  await page.getByRole("radio", { name: new RegExp("^" + MODEL.effort, "i") }).click().catch(() => {});
  await page.keyboard.press("Escape");
  await page.evaluate((id) => { location.hash = "/app/space/" + id; }, id);
  await page.getByRole("tab", { name: /^Files/ }).click();
  if (!(await page.locator(".sp-file", { hasText: "Osmosis lab handout.pdf" }).count())) await page.locator(".sp-tool-actions input[type=file]").setInputFiles(join(work, "Osmosis lab handout.pdf"));
  await page.getByRole("tab", { name: "Overview" }).click();
  return { finish: async () => { await app.close(); } };
}

process.on("uncaughtException", async (e) => { console.error(e.message); await page?.screenshot({ path: join(out, "failure.png") }).catch(() => {}); process.exit(1); });
await rm(out, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });
const driver = live ? await startLive() : await startDemo();
await page.addStyleTag({ content: ".toast{transition:none} ::-webkit-scrollbar{width:0;height:0}" });
if (!live) await page.evaluate(() => { location.hash = "/app/space/bio"; });
await page.locator(".space-page .sp-name").waitFor();
await page.mouse.move(pos.x, pos.y);
await wait(600);
await startScreencast();
await wait(900);

await page.evaluate(() => document.fonts.ready);
// 1 · The subject page.
mark("subject");
await focus(page.locator(".sp-title"), 1.9);
await hold(1500);
await focus(page.locator(".sp-hero"), 1.08);
await moveTo(520, 330, 900);
await moveTo(760, 330, 500); await moveTo(1010, 330, 500); await moveTo(1250, 330, 500);
await hold(500);
mark("subject-end");

// 2 · A worksheet, made and filed.
mark("worksheet");
await focus(page.locator(".sp-card.make"), 1.55);
await hold(400);
await click(page.locator(".sp-make button", { hasText: "Worksheet" }), { pause: 300 });
await focus(page.locator(".messages").first(), 1.35);
await page.getByText(live ? /\.pdf/i : "I saved it as a PDF.").first().waitFor({ timeout: live ? 300_000 : 30_000 });
event("fast-end");
await hold(900);
await focus(null);
await click(page.locator(".workspace-top .breadcrumb"), { pause: 500 });
await click(page.getByRole("tab", { name: /^Files/ }), { pause: 400 });
await focus(page.locator(".sp-folders"), 1.7);
await hold(400);
await click(page.locator(".sp-folder", { hasText: "Worksheets" }), { pause: 500 });
await focus(page.locator(".sp-file-list"), 1.65);
await hold(1300);
mark("worksheet-end");

// 3 · Editing a PDF Mowr made.
mark("pdf");
await focus(null);
await click(page.locator(".sp-file", { hasText: live ? /worksheet/i : "Cell biology worksheet.pdf" }).first().locator(".sp-file-open"), { pause: 900 });
await page.locator(".pdf-studio .ps-page canvas").first().waitFor();
await hold(700);
await focus(page.locator(".ps-input"), 1.8);
await type(page.getByLabel("Describe the change to this PDF"), "Make it harder and add an answer key", 42);
await hold(250);
await click(page.getByRole("button", { name: "Edit PDF" }), { pause: 200 });
await focus(page.locator(".ps-working"), 1.5);
await page.locator(".ps-proposal").waitFor({ timeout: live ? 300_000 : 60_000 });
event("fast-end");
await focus(page.locator(".ps-page").first(), 1.35);
event("sweep");
await hold(1900);
await focus(page.locator(".ps-proposal"), 1.6);
await hold(500);
await click(page.getByRole("button", { name: "Keep changes" }), { pause: 800, sound: "confirm" });
mark("pdf-end");

// 4 · Editing someone else's PDF, in place.
mark("handout");
await focus(null);
await click(page.getByRole("button", { name: "Close PDF" }), { pause: 400 });
await click(page.locator(".sp-path button", { hasText: "Files" }), { pause: 400 });
await click(page.locator(".sp-file", { hasText: "Osmosis lab handout.pdf" }).locator(".sp-file-open"), { pause: 900 });
await page.locator(".pdf-studio .ps-page canvas").first().waitFor();
await hold(800);
const dueLine = page.locator(".ps-text span", { hasText: "Due Friday" }).first();
await focus(dueLine, 2.6);
await hold(1300);
await focus(page.locator(".ps-input"), 1.8);
await type(page.getByLabel("Describe the change to this PDF"), "Move the due date to Monday", 42);
await click(page.getByRole("button", { name: "Edit PDF" }), { pause: 200 });
await page.locator(".ps-proposal").waitFor({ timeout: live ? 300_000 : 60_000 });
event("fast-end");
await hold(300);
await focus(page.locator(".ps-text span", { hasText: "Due Monday" }).first(), 2.6);
event("sweep");
await hold(2200);
await focus(null);
await click(page.getByRole("button", { name: "Keep changes" }), { pause: 700, sound: "confirm" });
await click(page.getByRole("button", { name: "Close PDF" }), { pause: 400 });
mark("handout-end");

// 5 · Review.
mark("review");
await click(page.getByRole("tab", { name: "Overview" }), { pause: 400 });
await click(page.locator(".sp-card.today .primary"), { pause: 600 });
await focus(page.locator(".review-card"), 1.55);
await hold(900);
await click(page.locator(".review-reveal"), { pause: 900 });
await click(page.locator(".grade-good"), { pause: 700 });
await click(page.locator(".review-reveal"), { pause: 800 });
await click(page.locator(".grade-easy"), { pause: 600 });
mark("review-end");

// 6 · Search everything.
mark("search");
await focus(null);
event("key", { sound: "key" });
await page.keyboard.press("Control+Shift+F");
await focus(page.locator("dialog.search-everything"), 1.28);
await type(page.getByRole("combobox", { name: "Search everything" }), "mitochondria", 70);
await page.locator(".se-results .se-kind.kind-folder").first().waitFor();
await hold(1600);
await page.keyboard.press("Escape");
mark("search-end");

// 7 · Share.
mark("share");
await page.locator(".sp-share").scrollIntoViewIfNeeded();
await focus(page.locator(".sp-share"), 3.1);
await hold(500);
const shareBox = await click(page.locator(".sp-share"), { pause: 150, sound: "pop" });
event("burst", { x: shareBox.x + shareBox.width / 2, y: shareBox.y + shareBox.height / 2 });
await hold(500);
await focus(page.locator("dialog.share-sheet"), 1.45);
await hold(500);
const worksheets = page.getByRole("checkbox", { name: /Worksheets/ });
if (await worksheets.count()) await click(worksheets, { pause: 400 });
await click(page.locator(".sh-foot .primary"), { pause: 900, sound: "confirm" });
await focus(page.locator(".sh-file"), 2);
await hold(700);
const tile = await page.locator(".sh-file").boundingBox();
await moveTo(tile.x + tile.width * 0.3, tile.y + tile.height / 2, 500);
await hold(200);
event("drag", { x: pos.x, y: pos.y, box: tile, label: (await page.locator(".sh-file strong").innerText()) });
await focus(null);
await moveTo(VIEW.width + 260, tile.y - 140, 1300);
event("drag-end");
await hold(600);
mark("share-end");

await wait(400);
await cdp.send("Page.stopScreencast");
await writing;
await driver.finish();
await writeFile(join(out, "log.json"), JSON.stringify(log));
console.log(`Captured ${log.frames.length} frames over ${(log.frames.at(-1).t - log.frames[0].t).toFixed(1)}s → ${out}`);
