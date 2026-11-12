// The website's pictures: real captures of the desktop build, photographed with the operating system's capture so
// Windows' caption buttons are in frame. Like scripts/glass-electron.mjs it runs a throwaway copy with its own user data
// folder and never touches an installed Clem or its sign-in. The workspace is a scripted demo; nothing calls a model.
//   npm run desktop:build && node scripts/site/capture.mjs [out]
import { _electron as electron, chromium } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = process.argv[2] || "test-results/site-shots";
await mkdir(out, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "clem-site-"));
const DAY = 864e5, now = Date.now(), day = (n) => new Date(now + n * DAY).toISOString().slice(0, 10);
let n = 0;
const id = (p) => p + ++n;

// The op-amp story's damping: it falls as the cable lengthens (10 m gives 0.25).
const Z = "(0.75/(1+L/5))", WD = `(2*sqrt(1-${Z}^2))`;
const ringing = {
  kind: "plot", title: "Why a long cable rings", subject: "Electronics",
  caption: "A simplified model: each metre of cable adds capacitance at the output, which eats into the phase margin. Lengthen the cable and the step response starts to ring.",
  params: [{ key: "L", label: "Cable length", min: 0, max: 20, step: 0.5, value: 10, unit: "m" }],
  readouts: [{ label: "Phase margin", expr: `100*${Z}`, unit: "°", digits: 0 }, { label: "Overshoot", expr: `100*exp(-pi*${Z}/sqrt(1-${Z}^2))`, unit: "%", digits: 0 }],
  x: { min: 0, max: 12, label: "time (µs)" }, y: { min: 0, max: 1.9, label: "output (V)" },
  layers: [
    { type: "function", expr: "1", dash: true, color: "ink", label: "input step" },
    { type: "function", expr: `1 - exp(-${Z}*2*x)*(cos(${WD}*x) + ${Z}/sqrt(1-${Z}^2)*sin(${WD}*x))`, color: "blue", width: 3, label: "output" },
  ],
};

const cards = (items, dueNow) => items.map((_, i) => ({ due: now + (i < dueNow ? -DAY : 6 * DAY), stability: 9, difficulty: 5, reps: 3, lapses: 0, last: now - 7 * DAY }));
const organelles = [
  ["Which organelle makes most of the cell's ATP?", "Mitochondria"], ["What builds proteins?", "Ribosomes"],
  ["What packages and ships proteins?", "The Golgi apparatus"], ["What does selectively permeable mean?", "Only some molecules can cross the membrane freely."],
  ["What is osmosis?", "Diffusion of water across a selectively permeable membrane."], ["What is the rough ER for?", "Folding and modifying proteins for export."],
  ["What does the nucleolus make?", "Ribosomal subunits."], ["What do lysosomes hold?", "Enzymes that break down waste."],
].map(([question, answer]) => ({ question, answer }));

// A term of study: questions on most weekdays, heavier towards the exam.
const history = [];
for (let d = 170; d > 0; d--) {
  const date = new Date(now - d * DAY), weekend = [0, 6].includes(date.getDay());
  const count = (d * 7919) % 11 < (weekend ? 2 : 6) ? 1 + ((d * 31) % (d < 40 ? 13 : 6)) : 0;
  for (let i = 0; i < count; i++) history.push({ id: id("h"), role: "user", content: "Revision question", at: now - d * DAY });
}

const check = { checks: [{ label: "Mass gained", expr: "4.71 - 4.20", claimed: 0.51, unit: "g" }, { label: "Percentage gain", expr: "(4.71 - 4.20) / 4.20 * 100", claimed: 12.1, unit: "%" }] };
const osmosis = { id: "c-osmosis", title: "Osmosis lab write-up", spaceId: "bio", titled: true, updated: now - 3600e3, model: "claude:sonnet", messages: [
  { id: "o1", role: "user", at: now - 3700e3, content: "Why did the potato gain mass in pure water? Use my lab handout, and check the percentage." },
  { id: "o2", role: "assistant", at: now - 3600e3, model: "claude:sonnet", content: [
    "The potato gained mass because of **osmosis**. Its cells hold more solute than pure water does, so water crosses the selectively permeable membrane into the cells until the pressure inside balances the pull [[Lab handout.pdf, p. 2]].",
    "The cylinder went from 4.20 g to 4.71 g, a gain of 12.1%. That matches the 8 to 15% range the handout expects for a 0 mol/L solution [[Lab handout.pdf, p. 3]].",
    "For your write-up, name the membrane, the direction of water and the concentration gradient in one sentence. The marking scheme gives a point for each [[Lab handout.pdf, p. 4]].",
    "```check\n" + JSON.stringify(check) + "\n```",
  ].join("\n\n"), verify: { status: "done", claims: [
    { claim: "Water crosses the selectively permeable membrane into the cells.", status: "supported", source: "Lab handout.pdf", page: 2 },
    { claim: "A 0 mol/L solution gives an 8 to 15% gain.", status: "supported", source: "Lab handout.pdf", page: 3 },
  ] } },
] };
const cable = { id: "c-cable", title: "Why a long cable rings", spaceId: "report", titled: true, updated: now - 2 * 3600e3, model: "gpt-5.5", messages: [
  { id: "r1", role: "user", at: now - 7300e3, content: "/visual why does my op-amp oscillate with a long cable?" },
  { id: "r2", role: "assistant", at: now - 7200e3, model: "gpt-5.5", content: "Cable capacitance loads the output and eats into the phase margin. Drag the length and watch the overshoot climb.\n\n```visual\n" + JSON.stringify(ringing) + "\n```" },
] };
const seed = (title, spaceId, ago, question, answer) => ({ id: id("c"), title, spaceId, titled: true, updated: now - ago * DAY, messages: [{ id: id("m"), role: "user", content: question, at: now - ago * DAY }, { id: id("m"), role: "assistant", content: answer, at: now - ago * DAY }] });
const workspace = {
  name: "Sam",
  spaces: [
    { id: "bio", name: "Biology 101", kind: "subject", description: "Cells, genetics and evolution. Midterm on the 19th.", memory: "", sources: ["handout", "syllabus", "slides"], examDate: day(12) },
    { id: "calc", name: "Calculus II", kind: "subject", description: "Series, integrals and polar coordinates.", memory: "", sources: [], examDate: day(27) },
    { id: "report", name: "Op-amp stability report", kind: "project", description: "Final-year lab report on cable loading.", memory: "", sources: [] },
  ],
  files: [
    { id: "handout", name: "Lab handout.pdf", size: 412e3, type: "application/pdf", created: now - 9 * DAY, spaceId: "bio" },
    { id: "syllabus", name: "Biology 101 syllabus.txt", size: 1800, type: "text/plain", created: now - 30 * DAY, spaceId: "bio" },
    { id: "slides", name: "Week 6 membranes.pptx", size: 8.4e6, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", created: now - 4 * DAY, spaceId: "bio" },
    { id: "bench", name: "Bench measurements.xlsx", size: 96e3, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", created: now - 6 * DAY, spaceId: "report" },
    { id: "draft", name: "Stability report draft.docx", size: 240e3, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", created: now - 2 * DAY, spaceId: "report" },
  ],
  chats: [
    osmosis, cable,
    seed("Krebs cycle in plain words", "bio", 1, "Explain the Krebs cycle simply.", "The Krebs cycle runs inside mitochondria and strips energy from acetyl-CoA."),
    seed("Ratio test or root test?", "calc", 2, "When do I use the ratio test?", "Reach for it when factorials or exponentials appear."),
    seed("Phase margin against load", "report", 3, "How much margin is enough?", "Aim for about 60 degrees."),
    { id: "c-history", title: "Week 6 revision", spaceId: "bio", titled: true, updated: now - 4 * DAY, messages: [...history, { id: "h-a", role: "assistant", content: "Good. Next, membranes.", at: now - 4 * DAY }] },
  ],
  studySets: [
    { id: "set-cells", spaceId: "bio", kind: "flashcards", title: "Cell organelles", created: now - 8 * DAY, attempts: [], items: organelles, cards: cards(organelles, 6) },
    { id: "set-quiz", spaceId: "bio", kind: "quiz", title: "Membranes quiz", created: now - 5 * DAY, attempts: [{ at: now - 2 * DAY, correct: 8, total: 10 }], items: [{ question: "Water moves toward the side with…", answer: "more solute", choices: ["more solute", "less solute"], correct: 0 }] },
  ],
  plans: [{ id: "plan-bio", spaceId: "bio", title: "Midterm plan", goal: "Ready for the midterm on the 19th", start: day(-6), created: now - 6 * DAY, updated: now - DAY, rev: 3, history: [], tasks: [
    { id: "t1", title: "Reread membranes and transport", due: day(-2), done: true, group: "This week" },
    { id: "t2", title: "Osmosis lab write-up", due: day(1), group: "This week" },
    { id: "t3", title: "Practice quiz on respiration", due: day(3), group: "This week" },
    { id: "t4", title: "Genetics problem set", due: day(6), group: "Next week" },
  ] }],
  visuals: [{ id: "v1", chatId: "c-cable", title: ringing.title, created: now - 2 * 3600e3, spec: ringing }],
  skills: [], automations: [], memory: "", quiet: false,
};

// A real PDF for the citation to open: the lab handout the demo chat quotes.
const printer = await chromium.launch(), sheet = await printer.newPage();
await sheet.setContent(`<style>body{font:15px/1.6 Georgia,serif;color:#111;margin:0}section{page-break-after:always;padding:64px 72px;height:900px;box-sizing:border-box}h1{font-size:26px;margin:0 0 6px}h2{font-size:17px;margin:26px 0 6px}small{color:#555}table{border-collapse:collapse;margin-top:10px;width:100%}td,th{border:1px solid #999;padding:6px 10px;text-align:left}</style>
<section><h1>Lab 4: Osmosis in potato tissue</h1><small>Biology 101, Week 6</small><h2>Aim</h2><p>Measure how the mass of potato cylinders changes in sucrose solutions of different concentration, and estimate the concentration of the cell sap.</p><h2>Equipment</h2><p>Cork borer, scalpel, balance to 0.01 g, boiling tubes, sucrose solutions from 0 to 1.0 mol/L, paper towel.</p></section>
<section><h1>Background</h1><p>Plant cell membranes are selectively permeable: water crosses freely, while most solutes cannot. In pure water the cell sap holds more solute than its surroundings, so water enters the cells by osmosis.</p><p>Entry continues until the pressure of the cell wall balances the pull of the solute. The tissue becomes turgid and gains mass.</p></section>
<section><h1>Expected results</h1><table><tr><th>Solution (mol/L)</th><th>Expected change in mass</th></tr><tr><td>0</td><td>+8 to +15%</td></tr><tr><td>0.2</td><td>+2 to +6%</td></tr><tr><td>0.4</td><td>-2 to -6%</td></tr><tr><td>0.8</td><td>-12 to -20%</td></tr></table></section>
<section><h1>Marking scheme</h1><p>One point each for naming the membrane, the direction of water movement, and the concentration gradient. Two points for a correctly calculated percentage change.</p></section>`);
const handout = await sheet.pdf({ format: "A4" });
await printer.close();

const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData, "--force-device-scale-factor=2"], timeout: 30000 });
const log = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => log.push("page error: " + e.message));
  const capture = async (name) => {
    await page.waitForTimeout(1800);
    const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible()) || BrowserWindow.getAllWindows()[0];
      win.focus();
      const [w, h] = win.getSize(), sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: w * 2, height: h * 2 } });
      const me = sources.find((s) => s.id === win.getMediaSourceId());
      return me ? me.thumbnail.toPNG().toString("base64") : null;
    });
    if (png) await writeFile(`${out}/${name}.png`, Buffer.from(png, "base64"));
    else { log.push("window capture unavailable for " + name); await page.screenshot({ path: `${out}/${name}.png` }); }
  };
  await page.getByRole("heading", { name: "Welcome to Clem." }).waitFor();
  await capture("welcome");
  await app.evaluate(async ({ app: electronApp, ipcMain, net, protocol, BrowserWindow }, { workspace, handout }) => {
    const { join } = process.getBuiltinModule("path"), { pathToFileURL } = process.getBuiltinModule("url");
    const root = join(electronApp.getAppPath(), "..", "dist"), user = { id: "tour", email: "sam@example.com", name: "Sam" };
    const status = { configured: true, user, setup: { step: 4, username: "sam", displayName: "Sam", memory: true }, entitlement: { active: true, reason: "" } };
    const models = [{ id: "gpt-5.5", name: "GPT-5.5", provider: "OpenAI", connected: true, context: 32000, specialties: [], tools: [], isDefault: true }, { id: "claude:sonnet", name: "Claude Sonnet", provider: "Anthropic", connected: true, context: 32000, specialties: [], tools: [] }];
    const account = (id, plan) => ({ id, connected: true, installed: true, email: "sam@example.com", plan });
    let state = workspace;
    ipcMain.removeHandler("clem:request");
    ipcMain.handle("clem:request", (_event, r) => {
      if (r.action === "status") return status;
      if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
      if (r.action === "providerAccounts") return { accounts: [account("openai", "Plus")], active: "openai", autoSwitch: true };
      if (r.action === "cliAccounts") return { active: "a", accounts: [account("a", "Pro")], autoSwitch: true };
      if (["claudeStatus", "grokStatus", "antigravityStatus"].includes(r.action)) return { installed: true, connected: r.action !== "grokStatus", loggedIn: r.action !== "grokStatus", email: "sam@example.com" };
      if (r.action === "models") return models;
      if (r.action === "memoryAll") return { enabled: true, records: [] };
      if (r.action === "folders" || r.action === "foldersAll" || r.action === "folderChanges") return [];
      return {};
    });
    protocol.unhandle("clem");
    protocol.handle("clem", async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/session") return Response.json({ user, database: false, auth: true, storage: false, drive: true, scheduler: false });
      if (url.pathname === "/api/models") return Response.json(models);
      if (url.pathname === "/api/local/state") { if (request.method === "PUT") { state = await request.json(); return Response.json({ ok: true }); } return Response.json(state); }
      if (url.pathname.endsWith("/files/handout")) return new Response(Buffer.from(handout, "base64"), { headers: { "Content-Type": "application/pdf" } });
      if (url.pathname.startsWith("/api/local/files/")) return new Response("Biology 101 covers cells, membranes, osmosis and genetics.");
      if (url.pathname.startsWith("/api/")) return Response.json({});
      return net.fetch(pathToFileURL(join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname))).toString());
    });
    BrowserWindow.getAllWindows()[0].webContents.reload();
  }, { workspace, handout: handout.toString("base64") });
  await page.locator(".greeting-row").waitFor({ timeout: 20000 }).catch((e) => log.push("workspace did not open: " + String(e.message).split("\n")[0]));

  const nav = (label) => page.locator(".sidebar .nav-item", { hasText: label }).click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
  const open = (title) => page.locator(".history-title", { hasText: title }).first().click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
  const tour = async (suffix) => {
    await nav("New chat");
    await capture("home" + suffix);
    await open("Osmosis lab");
    await page.waitForTimeout(700);
    await page.getByText("Source check").first().click({ timeout: 3000 }).catch(() => log.push("no source check"));
    await capture("chat" + suffix);
    await page.locator("main a, main button").filter({ hasText: /Lab handout/ }).first().click({ timeout: 3000 }).catch(() => log.push("no citation"));
    await page.waitForTimeout(1500);
    await capture("cited" + suffix);
    await page.keyboard.press("Escape");
    await open("Why a long cable");
    await page.waitForTimeout(1200);
    await capture("visual" + suffix);
    await nav("Subjects");
    await capture("subjects" + suffix);
    await page.locator("main").getByText("Biology 101", { exact: true }).first().click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
    await capture("subject" + suffix);
    await page.getByRole("tab", { name: /Flashcards/ }).click({ timeout: 3000 }).catch(() => log.push("no Flashcards tab"));
    await capture("flashcards" + suffix);
    await page.getByRole("tab", { name: /Plan/ }).click({ timeout: 3000 }).catch(() => log.push("no Plan tab"));
    await capture("plan" + suffix);
    await nav("Visuals");
    await capture("visuals" + suffix);
    await nav("Files");
    await capture("files" + suffix);
    await page.locator(".profile-settings").click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /^Models$/ }).click({ timeout: 3000 }).catch(() => log.push("no Models tab"));
    await capture("models" + suffix);
    await page.keyboard.press("Escape");
  };
  await page.evaluate(() => { localStorage.setItem("clem-theme", "dark"); location.reload(); });
  await page.waitForTimeout(1200);
  await page.locator(".greeting-row").waitFor({ timeout: 20000 }).catch(() => {});
  await tour("-dark");
  await page.evaluate(() => { localStorage.setItem("clem-theme", "light"); location.reload(); });
  await page.waitForTimeout(1200);
  await page.locator(".greeting-row").waitFor({ timeout: 20000 }).catch(() => {});
  await tour("-light");
} finally {
  console.log(log.length ? log.slice(0, 30).join("\n") : "no problems logged");
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
