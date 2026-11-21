// Clem speaks only through its AI (owner, 2026-11-21): the engine's news, reminders and routines are briefings for the
// main thread's AI, never templates; the AI can't claim a Coming up change it didn't make; an item the person adds to
// Coming up stays through every sync; and the VPS says why its AI CLI failed.
import test from "node:test";
import assert from "node:assert/strict";
import { unbackedClaim } from "../core/claims.ts";
import { applyCorrections, fingerprint, type Correction } from "../core/guc/corrections.ts";
import { NOTHING, ownGuide, ownMessages } from "../core/telegram/thread.ts";
import { failure } from "../desktop/engine/vps/headless.ts";
import { runKinetraTurn } from "../desktop/kinetra-turn.ts";
import { Engine } from "../desktop/engine/index.ts";
import { draftsOf, host as fakeHost } from "./guc-fake.ts";

test("an answer that says Coming up changed goes back unless guc.correct did it", () => {
  const said = "I've updated your Coming up section: ELCT 301 Quiz 2 is now Thursday 26 November at 16:30 in H17.";
  assert.match(unbackedClaim(said, []) || "", /no action did it/);
  assert.match(unbackedClaim(said, [{ request: { action: "guc.correct", do: "edit" }, result: { error: "Nothing in Coming up matches" } }]) || "", /the action failed/);
  assert.equal(unbackedClaim(said, [{ request: { action: "guc.correct", do: "add" }, result: "Added ELCT 301 Quiz 2 (Thu 26 Nov, 4:30 pm, H17) to Coming up." }]), undefined);
  assert.equal(unbackedClaim(said, [{ request: { action: "guc.fix" }, result: "Changed it." }]), undefined, "an alias counts as the action");
  assert.equal(unbackedClaim("Your Circuits quiz is Thursday at 4:30 pm in H17.", []), undefined, "saying what Coming up holds is no claim");
  assert.match(unbackedClaim("I've set reminders for Wednesday at 20:00 and Thursday at 13:30.", []) || "", /reminder/);
  assert.equal(unbackedClaim("I've set reminders for Wednesday at 20:00.", [{ request: { action: "clem.remind" }, result: { ok: true } }]), undefined);
});

test("the turn loop sends a false Coming up claim back once, and the corrected answer stands", async () => {
  const replies = [
    "I've updated your Coming up section with ELCT 301 Quiz 2 on Thursday at 16:30.",
    '{"kinetra":{"action":"guc.correct","do":"add","item":"Quiz 2","subject":"ELCT 301","date":"2026-11-26","time":"16:30","place":"H17"}}',
    "Added ELCT 301 Quiz 2 to Coming up: Thursday 26 November, 4:30 pm in H17.",
  ];
  const ran: string[] = [];
  const answer = await runKinetraTurn("update coming up", "", async () => replies.shift()!, async (r) => { ran.push(r.action); return "Added ELCT 301 Quiz 2 (Thu 26 Nov, 4:30 pm, H17) to Coming up."; }, () => false);
  assert.deepEqual(ran, ["guc.correct"]);
  assert.match(answer, /^Added ELCT 301 Quiz 2/);
});

test("an item the person added stays in Coming up through a sync, once, until a post brings it or it is undone", () => {
  const item = { id: "you-1", courseKey: "45:70", title: "Quiz 2", kind: "quiz", due: "2026-11-26T14:30:00.000Z", source: "you", timeKnown: true, place: "H17" };
  const add: Correction = { id: "fix1", kind: "add", at: 1, label: "Added", itemId: item.id, fingerprint: fingerprint(item), courseKey: item.courseKey, patch: { item } };
  const now = Date.parse("2026-11-21T00:00:00Z");
  assert.deepEqual(applyCorrections([], [add], { now, course: "45:70" }).map((d) => d.id), ["you-1"], "the reader dropped it: it comes back");
  assert.deepEqual(applyCorrections([], [add], { now, course: "45:99" }), [], "only in its own course");
  const read = { ...item, id: "post-q2", source: "post", place: "H18" };
  assert.deepEqual(applyCorrections([read], [add], { now, course: "45:70" }).map((d) => d.id), ["post-q2"], "a post about the same quiz is that quiz, never a second row");
  const moved: Correction = { id: "fix2", kind: "edit", at: 2, label: "Moved", itemId: item.id, courseKey: item.courseKey, patch: { place: "H20" } };
  assert.equal(applyCorrections([], [add, moved], { now, course: "45:70" })[0].place, "H20", "later corrections apply to it");
});

test("a briefing's answer is its messages, split where the AI said, or none", () => {
  assert.deepEqual(ownMessages(NOTHING), []);
  assert.deepEqual(ownMessages("Your Circuits quiz moved to Thursday 4:30 pm in H17.\n---\nYour Math grade is out: 18/20, nice work."), ["Your Circuits quiz moved to Thursday 4:30 pm in H17.", "Your Math grade is out: 18/20, nice work."]);
  assert.match(ownGuide(), /guc\.correct/, "it can fix what Clem holds before it speaks");
  assert.match(ownGuide(), /NOTHING/);
});

test("the VPS says why its AI CLI failed, from stdout when stderr is empty", () => {
  assert.equal(failure("claude", 1, "", "Invalid API key · Please run /login\n"), "Invalid API key · Please run /login");
  assert.equal(failure("gemini", 41, "\x1b[31mManual authorization is required\x1b[0m", ""), "Manual authorization is required");
  assert.match(failure("codex", 2, "", ""), /exit code 2/);
});

test("engine: without an AI nothing is said by itself; with one, a reminder is a briefing it words", async () => {
  const T = Date.parse("2026-11-21T08:00:00Z");
  const ws = { spaces: [], plans: [], chats: [{ id: "main", kind: "main", messages: [] }], files: [], studySets: [], automations: [] };
  const quiet = Object.assign(fakeHost(), {});
  delete (quiet as { speak?: unknown }).speak;
  quiet.workspace = async () => ws;
  const e1 = await Engine.open("sp-owner", quiet, { memory: true, jobs: false, clock: () => T });
  try {
    await e1.organizer.remind({ text: "Call the TA", at: T - 60_000, source: "study" });
    await e1.organizer.ring();
    assert.deepEqual((await e1.organizer.inbox()).posts, [], "no template when no AI can say it");
    assert.deepEqual(quiet.notices, []);
  } finally { await e1.close(); }

  const h = fakeHost();
  h.workspace = async () => ws;
  const e2 = await Engine.open("sp-owner", h, { memory: true, jobs: false, clock: () => T });
  h.speaker = e2.organizer;
  try {
    await e2.organizer.remind({ text: "Email Dr. Amr", at: T - 60_000, source: "person" });
    await e2.organizer.ring();
    assert.equal(h.briefs.length, 1);
    assert.match(h.briefs[0], /the person set/);
    assert.deepEqual(draftsOf(h.briefs[0]).length, 1);
    assert.equal((await e2.organizer.inbox()).posts.length, 1, "said once, by the AI");
  } finally { await e2.close(); }
});
