import { test } from "node:test";
import assert from "node:assert/strict";
import { dueBySubject, hasFlashcards, localDay, reminderFor, reminderTime } from "../core/study-due.ts";
import { StudyReminders } from "../desktop/study-reminders.ts";

const now = new Date(2026, 9, 23, 9, 30).getTime(), day = 86_400_000;
const card = (dueIn: number, reps = 2) => ({ due: now + dueIn, stability: 3, difficulty: 5, reps, lapses: 0, last: now - day });
const workspace = {
  quiet: false,
  spaces: [{ id: "bio", name: "Biology 101", kind: "subject" }, { id: "chem", name: "Chemistry", kind: "subject" }, { id: "proj", name: "Thesis", kind: "project" }],
  studySets: [
    { spaceId: "bio", kind: "flashcards", items: [1, 2, 3, 4, 5], cards: [card(-60_000), card(-day), card(day), null, card(-1, 0)] },
    { spaceId: "bio", kind: "flashcards", items: [1], cards: [card(0)] },
    { spaceId: "chem", kind: "flashcards", items: [1, 2], cards: [card(-5)] },
    { spaceId: "bio", kind: "quiz", items: [1], cards: [card(-day)] },
    { spaceId: "proj", kind: "flashcards", items: [1], cards: [card(-day)] },
  ],
};

test("due cards are counted per subject like its page does: reviewed cards whose time has come, never new ones", () => {
  assert.deepEqual(dueBySubject(workspace, now), [{ spaceId: "bio", name: "Biology 101", due: 3 }, { spaceId: "chem", name: "Chemistry", due: 1 }]);
  assert.deepEqual(dueBySubject({ spaces: [], studySets: "nonsense" }, now), []);
  assert.deepEqual(dueBySubject(null, now), []);
  assert.equal(hasFlashcards(workspace), true);
  assert.equal(hasFlashcards({ studySets: [{ kind: "quiz", items: [1] }] }), false);
  assert.deepEqual(reminderFor([{ spaceId: "bio", name: "Biology 101", due: 12 }]), { title: "Time to review", body: "12 cards due in Biology 101", spaceId: "bio" });
  assert.equal(reminderFor(dueBySubject(workspace, now))!.body, "4 cards due across 2 subjects, 3 in Biology 101");
  assert.equal(reminderFor([{ spaceId: "x", name: "X", due: 1 }])!.body, "1 card due in X");
  assert.equal(reminderFor([]), null);
});

test("a reminder goes once a day, after the chosen time and before late evening", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);
  const on = { enabled: true, time: "08:00" };
  assert.equal(reminderTime(on, at(7, 59)), false);
  assert.equal(reminderTime(on, at(8, 0)), true);
  assert.equal(reminderTime(on, at(21, 59)), true, "a PC asleep at 8 gets it when it wakes");
  assert.equal(reminderTime(on, at(22, 0)), false);
  assert.equal(reminderTime({ ...on, time: "22:30" }, at(23, 0)), true);
  assert.equal(reminderTime({ ...on, lastSent: localDay(at(9)) }, at(12)), false);
  assert.equal(reminderTime({ ...on, lastSent: "2026-10-22" }, at(12)), true);
  assert.equal(reminderTime({ ...on, enabled: false }, at(12)), false);
  assert.equal(reminderTime({ ...on, time: "8am" }, at(12)), false);
});

test("the reminder service sends at most one a day, stays quiet when nothing is due, and is on once there are flashcards", async () => {
  const store = new Map<string, unknown>(), sent: unknown[] = [];
  let current: unknown = { ...workspace, studySets: [] };
  const reminders = new StudyReminders({
    vault: { read: async (k, f) => (store.has(k) ? structuredClone(store.get(k)) : f) as any, write: async (k, v) => { store.set(k, structuredClone(v)); } },
    workspace: async () => current, notify: (n) => sent.push(n),
  });
  assert.equal((await reminders.settings("o")).enabled, false, "off until there is a study set");
  current = workspace;
  assert.deepEqual(await reminders.settings("o"), { enabled: true, time: "08:00", lastSent: undefined });
  const nine = new Date(now);
  await reminders.tick("o", new Date(2026, 9, 23, 7, 0));
  assert.equal(sent.length, 0, "not before the time");
  await reminders.tick("o", nine);
  await reminders.tick("o", new Date(2026, 9, 23, 15, 0));
  assert.equal(sent.length, 1, "one a day");
  assert.deepEqual(sent[0], { title: "Time to review", body: "4 cards due across 2 subjects, 3 in Biology 101", spaceId: "bio", silent: false });
  // The next day, nothing due: nothing is sent, and the day is still open for cards that come due later.
  current = { ...workspace, quiet: true, studySets: workspace.studySets.map((s) => ({ ...s, cards: s.cards.map(() => card(5 * day)) })) };
  const tomorrow = new Date(2026, 9, 24, 9, 0);
  await reminders.tick("o", tomorrow);
  assert.equal(sent.length, 1);
  current = { ...workspace, quiet: true };
  await reminders.tick("o", new Date(tomorrow.getTime() + 3_600_000));
  assert.equal(sent.length, 2);
  assert.equal((sent[1] as { silent: boolean }).silent, true, "quiet mode sends it without a sound");
  await reminders.configure("o", { enabled: false });
  await reminders.tick("o", new Date(2026, 9, 25, 9, 0));
  assert.equal(sent.length, 2, "off means off");
  await assert.rejects(reminders.configure("o", { time: "25:00" }), /time/);
  assert.equal((await reminders.configure("o", { enabled: true, time: "19:15" })).time, "19:15");
});
