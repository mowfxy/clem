// Design tour: screenshots of every main screen in the fixture workspace, for before/after comparisons.
// node scripts/verify/tour.mjs [out-dir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/tour";
await mkdir(out, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const D = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plan = "Here is a plan for your Biology midterm.\n\n```plan\n" + JSON.stringify({ action: "create", space: "bio", title: "Biology midterm plan", goal: "Every lecture reviewed and one timed past paper before the midterm.", tasks: [
  { id: "t1", title: "Review lecture 1: cells and organelles", due: D(-1), group: "Week 1" },
  { id: "t2", title: "Review lecture 2: membranes and osmosis", due: D(1), group: "Week 1" },
  { id: "q1", title: "Quiz 1", due: D(3), time: "10:00", kind: "milestone", group: "Week 1" },
  { id: "t4", title: "Practise 20 respiration questions", due: D(5), group: "Week 2" },
  { id: "m1", title: "Midterm", due: D(10), time: "09:00", kind: "milestone", group: "Week 2" },
] }) + "\n```\n\nI assumed about two hours a day.";
const answer = "## Osmosis in one line\n\nWater moves **towards more solute** across a membrane that lets water through but not the solute.\n\n- Pure water outside a potato cell: water flows *in*, the cylinder gains mass.\n- Strong sugar outside: water flows *out*, it loses mass.\n\n| Sucrose (M) | Mass change |\n|---|---|\n| 0.0 | +18% |\n| 0.4 | −4% |\n\nThe isotonic point sits near **0.33 M**.";

const visual = { kind: "diagram", title: "Water cycle", nodes: [{ id: "sea", label: "Ocean" }, { id: "cloud", label: "Clouds" }, { id: "rain", label: "Rain" }], edges: [{ from: "sea", to: "cloud", flow: true }, { from: "cloud", to: "rain" }, { from: "rain", to: "sea" }], steps: [{ title: "Evaporation", text: "Sun heats the ocean.", focus: ["sea", "cloud"] }, { title: "Rain", focus: ["cloud", "rain"] }] };
const drawn = ["Here is the water cycle.", "```visual\n" + JSON.stringify(visual) + "\n```", "Press the steps to follow the water."].join("\n\n");
const browser = await chromium.launch();
const { page, close, errors } = await openFixture(browser, { replies: [answer, plan, drawn], deviceScaleFactor: 1 });
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); };
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500); };
const send = async (text) => { await page.getByLabel("Your message").fill(text); await page.getByLabel("Your message").press("Enter"); };
try {
  await shot("01-home");
  await send("Explain osmosis with the potato lab");
  await page.locator(".message.assistant .message-text table").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await shot("02-chat");
  await send("Plan my Biology midterm");
  await page.locator(".pl-proposal").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator(".pl-proposal").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot("03-plan-card");
  const save = page.getByRole("button", { name: "Save plan" }).first();
  if (await save.count()) await save.click();
  await send("Show me the water cycle");
  await page.locator(".spec-visual").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.locator(".spec-visual").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot("03b-visual");
  for (const [hash, name] of [["/app/visuals", "04-visuals"], ["/app/projects", "05-projects"], ["/app/subjects", "06-subjects"], ["/app/files", "07-files"]]) { await go(hash); await shot(name); }
  await go("/app/projects");
  await page.waitForTimeout(1200);
  await page.locator(".calm-template").nth(1).hover();
  await shot("05b-hover");
  await page.locator(".calm-template").nth(1).click();
  await shot("05c-modal");
  await page.keyboard.press("Escape");
  await go("/app/subjects");
  await page.locator(".lib-card").first().click();
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1440, height: 1500 });
  await shot("08-subject");
  const planTab = page.getByRole("tab", { name: /Plan/ });
  if (await planTab.count()) { await planTab.first().click(); await shot("09-plan-tab"); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await go("/app");
  await page.keyboard.press("Control+,");
  await shot("10-settings");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await shot("11-palette");
  await page.keyboard.press("Escape");
} catch (e) { console.log("tour stopped:", e.message); await shot("99-stopped"); }
if (errors.length) console.log("page errors:", errors);
await close();
await browser.close();
