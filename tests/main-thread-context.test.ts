import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, tokens, localNowCard, renderNow, type ContextInput } from "../core/main-thread/context.ts";
import { planFolds, applyFold, foldPrompt, dayKey } from "../core/main-thread/fold.ts";
import { recallIndex, recall, windowOf } from "../core/main-thread/recall.ts";

const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
const turn = (id: string, role: "user" | "assistant", content: string, time: number) => ({ id, role, content, at: time });
const PREFIX = ["You are Clem's organizer. Keep it short.", "The person's skills: none."];
const thread = Array.from({ length: 200 }, (_, i) => turn("m" + i, i % 2 ? "assistant" : "user", `Turn ${i}: ` + "words ".repeat(60).trim(), at(1) + i * 60_000));
const base = (extra: Partial<ContextInput> = {}): ContextInput => ({ prefix: PREFIX, profile: "Studies EE at GUC.", now: "Today: 2026-11-11", messages: thread, current: "What's next?", ...extra });

test("the context stays within its budget and keeps the newest turns", () => {
  for (const budget of [2_000, 6_000, 12_000]) {
    const built = buildContext(base({ budget }));
    const total = built.messages.reduce((n, m) => n + tokens(m.content), 0);
    assert.ok(total <= budget, `${total} <= ${budget}`);
    assert.equal(built.used, total);
    assert.ok(built.turns > 0 && built.turns < thread.length);
    const sent = built.messages.filter((m) => m.role !== "system").slice(0, -1).map((m) => m.content);
    assert.equal(sent.at(-1), thread.at(-1)!.content, "the newest turn is last before the message");
    assert.equal(sent[0], thread[thread.length - built.turns].content, "turns are a contiguous run ending at the newest");
  }
  assert.ok(buildContext(base({ budget: 12_000 })).turns > buildContext(base({ budget: 2_000 })).turns);
});

test("layers come in order: prefix, profile, now, instructions, summary, recall, turns, message", () => {
  const digest = { id: "d1", role: "assistant" as const, content: "Planned the circuits week.", at: at(1, 23), digest: { level: "day" as const, from: at(1, 0), to: at(1, 23) } };
  const later = [turn("x1", "user", "Hello again", at(2)), turn("x2", "assistant", "Hi!", at(2, 13))];
  const built = buildContext(base({ instructions: "Plans playbook.", messages: [...thread, digest, ...later], recall: [{ source: "Circuits chat", text: "Thevenin first." }] }));
  const kinds = built.messages.map((m) => m.role === "system" ? (PREFIX.includes(m.content) ? "prefix" : m.content.split("\n")[0].slice(0, 12)) : m.role);
  assert.deepEqual(kinds, ["prefix", "prefix", "What you kno", "Now:", "Plans playbo", "Earlier in t", "Possibly rel", "user", "assistant", "user"]);
  assert.equal(built.digests, 1);
  assert.equal(built.turns, 2, "turns the digest covers are not sent again word for word");
  assert.equal(built.messages.at(-1)!.content, "What's next?");
});

test("the prefix is byte-stable whatever else changes", () => {
  const a = buildContext(base({ budget: 3000 })), b = buildContext(base({ budget: 9000, profile: "Different memory", now: "Today: 2027-01-01", current: "Other", recall: [{ source: "x", text: "y" }] }));
  assert.deepEqual(a.messages.slice(0, 2), b.messages.slice(0, 2));
  assert.deepEqual(a.messages.slice(0, 2).map((m) => m.content), PREFIX);
});

test("a long profile or summary cannot crowd out the conversation", () => {
  const built = buildContext(base({ profile: "fact ".repeat(20_000), budget: 4000 }));
  assert.ok(tokens(built.messages[2].content) <= 4000 * 0.12 + 1);
  assert.ok(built.turns >= 3);
});

test("card blocks are sent as words", () => {
  const card = turn("c", "assistant", '```clem-card\n{"type":"handoff","spaceName":"Circuits","spaceId":"s","chatId":"c"}\n```', at(3));
  const built = buildContext(base({ messages: [card] }));
  assert.ok(built.messages.some((m) => m.content === "[Continued in Circuits]"));
});

test("the local Now card lists open tasks, deadlines and the next exam", () => {
  const card = localNowCard({ today: "2026-11-11", spaces: [{ id: "c", name: "Circuits", kind: "subject", examDate: "2026-12-01" }, { id: "p", name: "Site", kind: "project" }, { id: "o", name: "Old", kind: "subject", examDate: "2026-01-01" }],
    plans: [{ spaceId: "c", tasks: [{ title: "Sheet 3", due: "2026-11-10" }, { title: "Lab report", due: "2026-11-13" }, { title: "Done", due: "2026-11-12", done: 1 }, { title: "Far", due: "2026-12-30" }, { title: "Quiz 2", due: "2026-11-14", kind: "milestone" }] }] });
  assert.deepEqual(card.tasks!.map((t) => t.title), ["Sheet 3", "Lab report"]);
  assert.equal(card.tasks![0].overdue, true);
  assert.deepEqual(card.deadlines, [{ title: "Quiz 2", due: "2026-11-14", space: "Circuits" }]);
  assert.deepEqual(card.nextExam, { space: "Circuits", date: "2026-12-01" });
  assert.match(renderNow(card), /Open tasks: \[overdue\] Sheet 3 2026-11-10 · Circuits/);
});

test("folding: past days fold to day digests, finished weeks to week digests, recent days stay word for word", () => {
  const msgs = [1, 2, 3, 4, 10].flatMap((d) => [turn("u" + d, "user", "day " + d, at(d, 9)), turn("a" + d, "assistant", "ok " + d, at(d, 10))]);
  const now = at(11, 15);
  const jobs = planFolds(msgs, now);
  assert.deepEqual(jobs.map((j) => dayKey(j.from)), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"], "today and yesterday are kept");
  let next: typeof msgs = msgs;
  for (const j of jobs) next = applyFold(next, j, "summary of " + dayKey(j.from), "d-" + dayKey(j.from)) as typeof msgs;
  assert.deepEqual(planFolds(next, now).map((j) => j.level), ["week"], "Nov 1 (a Sunday) is a week of one day; Nov 2–4 fold into a week");
  const week = planFolds(next, now).find((j) => dayKey(j.from) === "2026-11-02")!;
  assert.deepEqual(week.ids, ["d-2026-11-02", "d-2026-11-03", "d-2026-11-04"]);
  assert.match(foldPrompt(week)[0].content, /one week/);
  assert.equal(planFolds(next, now, { minParts: 1 }).length, 2, "with minParts 1 the lone day folds too");
  const folded = applyFold(next, week, "the week", "w1");
  assert.ok(folded.filter((m) => m.digest?.into === "w1").length === 3);
  assert.equal(folded.findIndex((m) => m.id === "w1") > folded.findIndex((m) => m.id === "d-2026-11-04"), true);
  const ctx = buildContext({ prefix: [], messages: folded, current: "q" });
  assert.equal(ctx.digests, 2, "the week digest and the lone Nov 1 day digest; the week's days are folded into it");
  assert.equal(ctx.turns, 2, "only Nov 10 is sent word for word");
  assert.equal(applyFold(next, week, "  ", "w2"), next, "an empty summary changes nothing");
});

test("recall finds the right passages, quotes a window and skips what is already sent", () => {
  const docs = [
    { id: "m1", source: "Main thread", text: "We agreed the circuits lab report is due Thursday and Thevenin equivalents need more practice." },
    { id: "m2", source: "Main thread", text: "Bought groceries and planned the gym schedule." },
    { id: "s1", source: "Physics chat summary", text: "Projectile motion and drag; reviewed kinematics." },
    { id: "long", source: "Main thread", text: "intro ".repeat(200) + "the midterm for Data Structures covers AVL trees" + " outro".repeat(200) },
  ];
  const index = recallIndex(docs);
  const hits = recall(index, "when is the circuits lab due?");
  assert.equal(hits[0].id, "m1");
  assert.ok(!hits.some((h) => h.id === "m2"));
  assert.equal(recall(index, "kinematics drag")[0].source, "Physics chat summary");
  assert.ok(!recall(index, "circuits lab", { exclude: new Set(["m1"]) }).some((h) => h.id === "m1"));
  const w = recall(index, "AVL trees midterm")[0];
  assert.equal(w.id, "long");
  assert.ok(w.text.length <= 330 && /AVL trees/.test(w.text) && w.text.startsWith("…"));
  assert.deepEqual(recall(index, "   "), []);
  assert.equal(windowOf("short text", ["x"], 100), "short text");
});
