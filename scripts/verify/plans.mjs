// Checks plans end to end against the real App with scripted replies: a chat outside any space drafts plans for a
// subject and a new project (cards with Open/Save), saving them, an update applied when the reply finishes (with
// Undo), the overdue mark on the subject card, the Plan tab (status, chart, ticking tasks, evenly spread tabs), its
// small box changing the plan, deleting a plan only after confirming on its card, and the overdue reminder notice.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture, saved } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/plans";
await mkdir(out, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const D = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fence = (json) => "```plan\n" + JSON.stringify(json) + "\n```";

const draft = `Here is a plan for your Biology midterm and one for the portfolio. Open them to check the dates, then save, or tell me what to change.

${fence({ action: "create", space: "bio", title: "Biology midterm plan", goal: "Every lecture reviewed and one timed past paper before the midterm.", tasks: [
  { id: "t1", title: "Review lecture 1: cells and organelles", due: D(0), group: "Week 1" },
  { id: "t2", title: "Review lecture 2: membranes and osmosis", due: D(1), group: "Week 1" },
  { id: "t3", title: "Finish the osmosis lab write-up", due: D(2), group: "Week 1", notes: "Use the potato data table" },
  { id: "q1", title: "Quiz 1", due: D(3), time: "10:00", kind: "milestone", group: "Week 1" },
  { id: "t4", title: "Practise 20 respiration questions", due: D(5), group: "Week 2" },
  { id: "t5", title: "Flashcards: genetics", due: D(7), group: "Week 2" },
  { id: "t6", title: "Timed past paper", due: D(9), group: "Week 2" },
  { id: "m1", title: "Midterm", due: D(10), time: "09:00", kind: "milestone", group: "Week 2" },
] })}

${fence({ action: "create", new: { kind: "project", name: "Portfolio site" }, title: "Portfolio launch", goal: "Site live with three case studies.", tasks: [
  { id: "t1", title: "Pick three projects to feature", due: D(1), group: "Content" },
  { id: "t2", title: "Write the case studies", due: D(4), group: "Content" },
  { id: "t3", title: "Build the pages", due: D(8), group: "Build" },
  { id: "l1", title: "Launch", due: D(12), kind: "milestone", group: "Build" },
] })}

I assumed about two hours a day for Biology.`;
const update = `Nice work. I ticked off lecture 1 and moved lecture 2 to yesterday as you said.

${fence({ action: "update", space: "bio", summary: "Lecture 1 done; lecture 2 moved", changes: [{ op: "done", id: "t1" }, { op: "edit", id: "t2", due: D(-1) }] })}`;
const boxReply = `Added a revision session on ${D(4)}.

${fence({ action: "update", summary: "Added a revision session", changes: [{ op: "add", title: "Revision session: cells to respiration", due: D(4), group: "Week 2", after: "q1" }] })}`;
const remove = `Here it is; nothing is removed until you confirm.

${fence({ action: "delete", space: "Portfolio site" })}`;

const slip = `Moved the lab write-up to two days ago, when it was really due.

${fence({ action: "update", space: "bio", summary: "Lab write-up was due two days ago", changes: [{ op: "edit", id: "t3", due: D(-2) }] })}`;

const browser = await chromium.launch();
const fixture = await openFixture(browser, { replies: [draft, update, update, boxReply, remove, slip] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const plans = () => page.evaluate(async () => (await (await fetch("/api/local/state", { headers: { "X-Clem-Owner": "fixture-owner" } })).json())?.plans || []);
const send = async (text) => { await page.getByLabel("Your message").fill(text); await page.getByLabel("Your message").press("Enter"); };
const idle = () => page.locator(".message.assistant").last().locator(".pl-proposal").first().waitFor({ timeout: 15000 });
try {
  // 1. Drafts from a chat outside any space: one card per plan, nothing saved yet.
  await send("Plan my Biology midterm and my portfolio site launch");
  await idle();
  await page.waitForFunction(() => document.querySelectorAll(".pl-proposal.draft footer .pl-btn.solid").length === 2, null, { timeout: 15000 });
  const cards = page.locator(".pl-proposal.draft");
  check(await cards.count() === 2, "two plan cards in the reply");
  check(await cards.nth(0).getByText("Biology 101").isVisible(), "the first card names the subject");
  check(await cards.nth(1).getByText(/New project · Portfolio site/).isVisible(), "the second card says it makes a new project");
  check((await plans()).length === 0, "nothing is saved before Save");
  await cards.nth(0).getByRole("button", { name: "Open plan" }).click();
  check(await cards.nth(0).locator(".pl-task").count() === 8, "Open plan shows every task");
  await cards.nth(0).evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  await cards.nth(0).screenshot({ path: `${out}/chat-card.png` });
  await cards.nth(0).getByRole("button", { name: "Save plan" }).click();
  await cards.nth(1).getByRole("button", { name: "Save plan" }).click();
  await saved(page);
  let all = await plans();
  check(all.length === 2, "both plans saved");
  const state = await page.evaluate(async () => (await (await fetch("/api/local/state", { headers: { "X-Clem-Owner": "fixture-owner" } })).json()));
  const portfolio = state.spaces.find((s) => s.name === "Portfolio site");
  check(portfolio?.kind === "project" && all.some((p) => p.spaceId === portfolio.id), "saving made the Portfolio site project with its plan");
  check(await cards.nth(0).getByText("Plan saved").isVisible(), "the card shows it was saved");

  // 2. An update applies when the reply finishes, and Undo puts it back.
  await send("I finished lecture 1. Lecture 2 was actually due yesterday.");
  await page.locator(".pl-proposal.update").first().waitFor({ timeout: 15000 });
  await page.locator(".pl-proposal.update.applied").first().waitFor({ timeout: 15000 });
  await saved(page);
  let bio = (await plans()).find((p) => p.spaceId === "bio");
  check(!!bio.tasks.find((t) => t.id === "t1").done && bio.tasks.find((t) => t.id === "t2").due === D(-1), "the update was applied");
  await page.locator(".pl-proposal.update").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.locator(".pl-proposal.update").first().screenshot({ path: `${out}/update-card.png` });
  await page.locator(".pl-proposal.update").first().getByRole("button", { name: "Undo" }).click();
  await saved(page);
  bio = (await plans()).find((p) => p.spaceId === "bio");
  check(!bio.tasks.find((t) => t.id === "t1").done && bio.tasks.find((t) => t.id === "t2").due === D(1), "Undo restored the plan");
  check(await page.locator(".pl-proposal.update.undone").count() === 1, "the card says it was undone");
  await send("Yes, I finished lecture 1 and lecture 2 was due yesterday.");
  await page.waitForFunction(() => document.querySelectorAll(".pl-proposal.update.applied").length === 1, null, { timeout: 15000 });
  await saved(page);

  // 3. The subject card shows what is overdue.
  await page.evaluate(() => { location.hash = "/app/subjects"; });
  const late = page.locator(".lib-card-late");
  await late.waitFor({ timeout: 5000 });
  check((await late.textContent()).trim() === "1", "the Biology card shows 1 overdue");
  await page.locator(".lib-grid").screenshot({ path: `${out}/subject-card.png` });

  // 4. The Plan tab.
  await late.click();
  await page.locator(".pl-view .pl-card").first().waitFor({ timeout: 5000 });
  check(await page.locator(".pl-state.behind").first().textContent() === "Behind · 1 overdue", "the plan says it is behind");
  const tabs = await page.evaluate(() => { const nav = document.querySelector(".sp-tabs"), r = nav.getBoundingClientRect(), b = [...nav.querySelectorAll("button")].map((x) => x.getBoundingClientRect()); return { nav: r.width, left: b[0].left - r.left, right: r.right - b[b.length - 1].right, widths: b.map((x) => Math.round(x.width)), names: [...nav.querySelectorAll("button")].map((x) => x.textContent) }; });
  check(tabs.names[2].startsWith("Plan") && tabs.names[1].startsWith("Chats"), "Plan comes right after Chats");
  check(tabs.left < 1 && tabs.right < 1, `tabs fill the whole line (left ${tabs.left.toFixed(1)}, right ${tabs.right.toFixed(1)})`);
  check(Math.max(...tabs.widths) - Math.min(...tabs.widths) <= 14, `tabs are evenly spread (${tabs.widths.join(", ")})`);
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1440, height: 2100 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/plan-tab.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".pl-sections").getByRole("checkbox", { name: /Mark done: Review lecture 2/ }).click();
  await saved(page);
  check(await page.locator(".pl-state").first().textContent() !== "Behind · 1 overdue", "ticking the late task catches the plan up");
  check(await page.locator(".sp-tabs .late").count() === 0, "the Plan tab's overdue count clears");

  // 5. The small box changes the plan.
  await page.getByLabel("Tell Clem about your plan").fill("Add a revision session in Week 2");
  await page.getByLabel("Tell Clem about your plan").press("Enter");
  await page.locator(".pl-reply:not(.working)").waitFor({ timeout: 15000 });
  check((await page.locator(".pl-reply:not(.working)").textContent()).startsWith("Added a revision session"), "the box shows Clem's reply without the block");
  check(await page.locator(".pl-task", { hasText: "Revision session: cells to respiration" }).count() === 1, "the new task is in the plan");
  const boxCall = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").at(-1));
  check(boxCall.messages[0].content.includes("small box on its Plan tab") && boxCall.messages[0].content.includes("space id bio"), "the box sends the plan to Clem");
  await page.locator(".pl-view").screenshot({ path: `${out}/plan-box.png` });

  // 6. The Overview card.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.locator(".pl-overview").waitFor({ timeout: 5000 });
  await page.locator(".pl-overview").screenshot({ path: `${out}/overview-card.png` });

  // 7. Deleting from a chat waits for the card.
  await page.evaluate(() => { location.hash = "/app"; });
  await page.getByLabel("Your message").waitFor({ timeout: 5000 });
  await send("Delete my portfolio plan");
  const del = page.locator(".pl-proposal.delete").last();
  await del.getByRole("button", { name: "Delete plan" }).waitFor({ timeout: 15000 });
  check((await plans()).length === 2, "the plan is still there before confirming");
  await del.screenshot({ path: `${out}/delete-card.png` });
  await del.getByRole("button", { name: "Delete plan" }).click();
  await saved(page);
  check((await plans()).length === 1 && (await plans())[0].spaceId === "bio", "Delete plan removed only that plan");

  // 8. The overdue reminder: once a day per plan, with its own drawing, closed with its ×.
  await page.evaluate(() => localStorage.removeItem("clem-plan-reminders"));
  await send("The lab write-up was due two days ago, actually.");
  await page.locator(".pl-proposal.update.applied").last().waitFor({ timeout: 15000 });
  await saved(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const notice = page.locator(".notice-card.kind-reminder");
  const reminded = await notice.waitFor({ timeout: 8000 }).then(() => true, () => false);
  check(reminded, "an overdue reminder appears");
  if (reminded) {
    check(await notice.locator(".ink-alarm").count() === 1, "the reminder has the alarm drawing");
    await page.waitForTimeout(900);
    await page.locator(".notice-stack").screenshot({ path: `${out}/reminder.png` });
    await notice.getByRole("button", { name: /Dismiss/ }).click();
    await notice.waitFor({ state: "detached", timeout: 3000 });
    check(true, "× closes the reminder");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(800);
    check(await page.locator(".notice-card.kind-reminder").count() === 0, "the same plan is not reminded twice in a day");
  }

  // 9. A space with no plan.
  await page.evaluate((id) => { location.hash = "/app/space/" + id; }, portfolio.id);
  await page.getByRole("tab", { name: "Plan" }).click();
  await page.locator(".pl-empty").waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  await page.locator(".pl-empty").screenshot({ path: `${out}/empty.png` });
  check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) {
  failed = true;
  console.log("FAIL " + (e && e.message));
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
