import { test } from "node:test";
import assert from "node:assert/strict";
import { codeKey, normCode, sameCode, withCode } from "../core/guc/codes.ts";
import { matchCourse, matchSubject } from "../core/guc/match.ts";
import { defaultSaveRules, describeSaveRules, materialKind, parseSaveRules, shouldSave } from "../core/guc/rules.ts";
import { cairoTime, cronLines, defaultCheckSchedule, describeChecks, nextCheck, parseCheckSchedule, suggestChecks } from "../core/guc/schedule-rules.ts";
import { answer, nextStep, readAiReply, readReply, setupMessage, startSetup, stepOfCard, toPost, updatePatch, updateSummary, type SetupStep } from "../core/guc/setup-flow.ts";
import { cardBlock, cardsIn, readCard } from "../core/guc/cards.ts";
import { mergeSettings, settingsPatch } from "../core/guc/settings.ts";
import { parseSchedule } from "../core/guc/parse.ts";
import { fixture } from "./guc-fake.ts";

test("course codes have one canonical form wherever they come from", () => {
  for (const s of ["CSEN701", "CSEN 701", "csen-701", "(|CSEN701|)", "CSEN 701 Tut", "about csen701 lab"]) assert.equal(normCode(s), "CSEN 701", s);
  assert.equal(normCode("MATH203"), "MATH 203");
  assert.equal(normCode("DMET 901A"), "DMET 901A");
  assert.equal(normCode("Embedded Systems"), "");
  assert.equal(withCode("CSEN701 Embedded Systems Architecture"), "CSEN 701 Embedded Systems Architecture");
  assert.ok(sameCode("CSEN701", "csen 701") && !sameCode("CSEN 701", "CSEN 702") && !sameCode("", ""));
  assert.equal(codeKey("CSEN 701"), "CSEN701");
});

test("the schedule and the CMS agree on codes, and a tutorial cell with a full-name title keeps its type", () => {
  const slots = parseSchedule(fixture("schedule"));
  assert.deepEqual(slots.map((s) => [s.code, s.type]), [["CSEN 701", "Tutorial"], ["CSEN 701", "Lecture"], ["CSEN 702", "Lab"], ["DMET 901", "Lecture"], ["DMET 901", "Tutorial"]]);
  assert.equal(slots[0].name, "CSEN 701 Embedded Systems Architecture");
});

const courses = [
  { key: "1201:64", code: "CSEN 701", name: "Embedded Systems Architecture", active: true, seasonId: 64 },
  { key: "1202:64", code: "CSEN 702", name: "Microprocessors", active: true, seasonId: 64 },
  { key: "1203:64", code: "DMET 901", name: "Computer Vision", active: true, seasonId: 64 },
  { key: "1204:64", code: "HUMA 101", name: "Critical Thinking & Scientific Methods", active: false, seasonId: 64 },
  { key: "1105:63", code: "MATH 203", name: "Mathematics III", active: true, seasonId: 63 },
  { key: "1106:63", code: "MATH 103", name: "Mathematics I", active: false, seasonId: 63 },
  { key: "1001:60", code: "CSEN 701", name: "Embedded Systems Architecture", active: false, seasonId: 60 },
];
const best = (name: string, description?: string) => { const m = matchCourse({ name, description }, courses); return { key: m.best?.item.key, sure: m.sure, conf: m.confidence, alts: m.alternatives.map((a) => a.item.key) }; };

test("subjects find their CMS course by code, name, short name, initials and typos", () => {
  assert.deepEqual([best("CSEN701").key, best("CSEN701").conf], ["1201:64", 1], "a code is certain, and the current term's course wins");
  assert.equal(best("Embedded", "csen 701 with Dr. X").key, "1201:64", "a code in the description");
  for (const [name, key] of [["Embedded Systems", "1201:64"], ["embeded sytems", "1201:64"], ["Micro", "1202:64"], ["Microprocessor", "1202:64"], ["CV", "1203:64"], ["Computer vision", "1203:64"], ["Math 3", "1105:63"], ["Maths III", "1105:63"], ["Critical thinking", "1204:64"]] as const) {
    const m = best(name);
    assert.equal(m.key, key, name);
    assert.ok(m.sure, `${name} is sure (${m.conf})`);
  }
  assert.equal(best("Math 1").key, "1106:63", "a number picks the right one of a series");
  const vague = best("Computer Architecture");
  assert.equal(vague.sure, false, "two courses half-match: ask, don't guess");
  assert.ok(vague.alts.length >= 1);
  assert.equal(best("Biology").key, undefined, "nothing close is nothing");
  assert.equal(best("Mathematics").sure, false, "two math courses: not sure");
});

test("a course finds the subject it belongs to", () => {
  const subjects = [{ id: "a", name: "Embedded" }, { id: "b", name: "Vision", description: "DMET 901" }, { id: "c", name: "Arabic" }];
  assert.equal(matchSubject(courses[2], subjects).best?.item.id, "b");
  const m = matchSubject(courses[0], subjects);
  assert.equal(m.best?.item.id, "a");
  assert.equal(matchSubject(courses[1], subjects).sure, false);
});

test("save rules: file kinds and the common ways of saying what to keep", () => {
  assert.equal(materialKind({ kind: "Lecture slides", title: "Lecture 3" }), "slides");
  assert.equal(materialKind({ kind: "Assignment", title: "Assignment 1" }), "assignments");
  assert.equal(materialKind({ kind: "File", title: "Tutorial 3 solution" }), "sheets");
  assert.equal(materialKind({ kind: "Video", title: "Recorded lecture" }), "videos");
  assert.equal(materialKind({ kind: "Link", title: "https://youtu.be/x" }), "videos");
  assert.equal(materialKind({ kind: "Link", title: "Course site" }), "links");
  const d = defaultSaveRules();
  assert.ok(shouldSave({ kind: "Lecture slides" }, d) && !shouldSave({ kind: "Video" }, d));
  assert.equal(describeSaveRules(d), "Slides, assignments, tutorials and sheets and other files");
  const on = (t: string, base = d) => { const r = parseSaveRules(t, base); return r && Object.entries(r.rules.kinds).filter(([, v]) => v).map(([k]) => k).sort().join(","); };
  assert.equal(on("only slides"), "slides");
  assert.equal(on("just slides and assignments"), "assignments,slides");
  assert.equal(on("slides, sheets"), "sheets,slides");
  assert.equal(on("stop saving videos", parseSaveRules("everything")!.rules), "assignments,links,other,sheets,slides");
  assert.equal(on("no videos", parseSaveRules("everything")!.rules), "assignments,links,other,sheets,slides");
  assert.equal(on("save the lecture recordings too"), "assignments,other,sheets,slides,videos");
  assert.equal(on("everything except links"), "assignments,other,sheets,slides,videos");
  assert.equal(on("all of it"), "assignments,links,other,sheets,slides,videos");
  assert.equal(on("nothing"), "");
  assert.equal(on("sounds good"), "assignments,other,sheets,slides");
  assert.equal(parseSaveRules("hmm what do you think is best for an exam?"), null, "the AI's turn");
});

const slots = parseSchedule(fixture("schedule"));
test("checks: suggested after lectures, next run in Cairo time, cron lines and the common phrasings", () => {
  assert.deepEqual(suggestChecks(slots, "CSEN701"), [{ day: 0, time: "12:00" }], "the Sunday lecture ends 11:30");
  assert.deepEqual(suggestChecks(slots, "CSEN 702"), [{ day: 0, time: "15:45" }], "no lecture: after its other classes");
  assert.equal(defaultCheckSchedule(slots, "HUMA 101").mode, "custom", "no classes: daily");
  assert.equal(describeChecks(defaultCheckSchedule(slots, "HUMA 101")), "Saturday to Thursday at 20:00");
  const after = defaultCheckSchedule(slots, "CSEN 701");
  assert.equal(describeChecks(after), "After each lecture: Sun 12:00");
  // Wednesday 11 Nov 2026, 12:00 in Cairo (UTC+2): the next Sunday lecture check is 15 Nov 12:00 Cairo, 10:00 UTC.
  assert.equal(new Date(nextCheck(after, Date.parse("2026-11-11T10:00:00Z"))!).toISOString(), "2026-11-15T10:00:00.000Z");
  assert.equal(nextCheck({ ...after, mode: "off" }, Date.now()), undefined);
  assert.equal(new Date(cairoTime("2026-07-01", "12:00")).toISOString(), "2026-07-01T09:00:00.000Z", "summer time");
  assert.deepEqual(cronLines(parseCheckSchedule("sunday and tuesday at 6pm")!), [{ time: "18:00", cron: "0 18 * * 0,2" }]);
  assert.equal(describeChecks(parseCheckSchedule("every day at 8pm")!), "Every day at 20:00");
  assert.equal(describeChecks(parseCheckSchedule("daily at 9:30 am")!), "Every day at 09:30");
  assert.equal(parseCheckSchedule("after each lecture", suggestChecks(slots, "CSEN 701"))?.mode, "after_lectures");
  assert.equal(parseCheckSchedule("don't check")?.mode, "off");
  assert.equal(parseCheckSchedule("every evening")?.times[0].time, "20:00");
  assert.equal(parseCheckSchedule("twice a day")?.times.length, 14);
  assert.equal(parseCheckSchedule("whenever the professor feels like it"), null);
});

const ctx = { linked: true, vps: false };
test("setup asks in order, skips what doesn't apply, and storage only with a VPS", () => {
  let s = startSetup(0);
  const order: SetupStep[] = [];
  for (let step = nextStep(s, ctx); step; step = nextStep(s, ctx)) { order.push(step); s = answer(s, step, "answered", ctx); }
  assert.deepEqual(order, ["link", "save", "check", "drive"]);
  assert.equal(s.finished, true);
  assert.equal(nextStep(startSetup(0), { linked: true, vps: true }), "link");
  let v = startSetup(0, true);
  assert.equal(nextStep(v, { linked: true, vps: true }), "save", "made from a course: already linked");
  for (const step of ["save", "check", "drive"] as const) v = answer(v, step, "answered", { linked: true, vps: true });
  assert.equal(nextStep(v, { linked: true, vps: true }), "storage");
  // Skipping the link leaves only what makes sense without a course.
  const skipped = answer(startSetup(0), "link", "skipped", { linked: false, vps: false });
  assert.equal(nextStep(skipped, { linked: false, vps: false }), "drive");
});

test("setup resumes after a restart and editing an earlier answer keeps its place", () => {
  let s = answer(startSetup(0), "link", "answered", ctx);
  assert.equal(toPost(s, ctx, ["link"]), "save", "the app closed before the next question went out");
  assert.equal(toPost(s, ctx, ["link", "save"]), null, "already asked: wait for the answer");
  s = answer(s, "save", "skipped", ctx);
  const again = answer(s, "link", "answered", ctx);
  assert.deepEqual(again.done, s.done);
  assert.equal(nextStep(again, ctx), "check", "changing the link later doesn't go back");
  assert.equal(answer(s, "save", "answered", ctx).done.save, "answered");
  for (const step of ["check", "drive"] as const) s = answer(s, step, "answered", ctx);
  assert.equal(toPost(s, ctx, ["link", "save", "check", "drive"]), "done");
  assert.equal(toPost(s, ctx, ["link", "save", "check", "drive", "done"]), null);
  // The posted steps come back from the thread's cards.
  const msg = setupMessage("save", { subjectId: "s1", subject: "Embedded", linked: true, save: "Slides", check: "" });
  assert.equal(stepOfCard(cardsIn(msg)[0]), "save");
  assert.equal(stepOfCard(readCard('{"type":"save_rules","subjectId":"s1"}')!), undefined, "a card outside setup asks nothing");
});

test("setup messages ask one short question each with its card", () => {
  const info = { subjectId: "s1", subject: "Embedded", course: { key: "1201:64", code: "CSEN 701", name: "Embedded Systems Architecture" }, linked: false, sure: true, save: "Slides and assignments", check: "Half an hour after each lecture works well: Sun 12:00", first: true };
  const link = setupMessage("link", info);
  assert.match(link, /Let's set up \*\*Embedded\*\*/);
  assert.match(link, /This looks like \*\*CSEN 701\*\* \(Embedded Systems Architecture\) on CMS\. Link it\?/);
  assert.deepEqual(cardsIn(link), [{ type: "course_link", subjectId: "s1", setup: true, suggest: "1201:64" }]);
  assert.match(setupMessage("link", { ...info, sure: false }), /Pick the right course/);
  assert.match(setupMessage("link", { ...info, linked: true }), /\*\*CSEN 701\*\* is linked/);
  for (const step of ["save", "check", "drive", "storage", "done"] as const) assert.equal(cardsIn(setupMessage(step, info)).length, 1, step);
});

test("typed setup replies are read locally, and the AI's JSON only when valid", () => {
  const rc = { courses, save: defaultSaveRules(), suggested: suggestChecks(slots, "CSEN 701") };
  assert.deepEqual(readReply("link", "yes", rc), { kind: "confirm" });
  assert.deepEqual(readReply("link", "it's CV", rc), { kind: "link", courseKey: "1203:64" });
  assert.deepEqual(readReply("link", "no", rc), { kind: "skip" });
  assert.deepEqual(readReply("link", "skip", rc), { kind: "skip" });
  assert.equal(readReply("save", "only slides", rc).kind, "settings");
  assert.deepEqual(readReply("check", "ok", rc), { kind: "confirm" });
  assert.deepEqual(readReply("check", "every day at 8pm", rc).kind, "settings");
  assert.deepEqual(readReply("drive", "yes please", rc), { kind: "settings", patch: { drive: { enabled: true } } });
  assert.deepEqual(readReply("storage", "on my vps", rc), { kind: "settings", patch: { storage: { location: "vps" } } });
  assert.deepEqual(readReply("save", "keep whatever matters for the final", rc), { kind: "unknown" });
  assert.deepEqual(readAiReply("save", { action: "set", save: { videos: false, slides: true, bogus: 1 } }, courses), { kind: "settings", patch: { save: { kinds: { slides: true, videos: false } } } });
  assert.deepEqual(readAiReply("link", { action: "link", course: "9999:1" }, courses), { kind: "unknown" }, "a course not in the list is not taken");
  assert.equal(readAiReply("check", { action: "set", check: { mode: "custom", times: [{ day: 9, time: "25:00" }] } }, courses).kind, "unknown");
  assert.equal(readAiReply("check", { action: "set", check: { mode: "custom", times: [{ day: 1, time: "18:00" }] } }, courses).kind, "settings");
});

test("GUC card schemas: setup cards, the AI's settings update and new courses", () => {
  assert.deepEqual(readCard('{"type":"course_link","subjectId":"s1","setup":true,"suggest":"1201:64"}'), { type: "course_link", subjectId: "s1", setup: true, suggest: "1201:64" });
  assert.equal(readCard('{"type":"course_link","subjectId":"s1","suggest":"CSEN701"}'), null, "a course is named by its key");
  for (const t of ["save_rules", "check_schedule", "drive_folder", "storage", "setup_done"]) assert.equal(readCard(`{"type":"${t}","subjectId":"s1"}`)?.type, t);
  assert.equal(readCard('{"type":"save_rules"}'), null);
  const update = readCard('{"type":"settings_update","save":{"videos":false}}');
  assert.deepEqual(update, { type: "settings_update", save: { videos: false } });
  assert.equal(readCard('{"type":"settings_update","save":{"everything":true}}'), null);
  assert.equal(readCard('{"type":"settings_update","check":{"mode":"custom","times":[{"day":0,"time":"8pm"}]}}'), null);
  assert.equal(readCard('{"type":"new_courses","courses":[{"key":"1301:65","code":"CSEN 801","name":"Software Engineering"}]}')?.type, "new_courses");
  assert.equal(readCard('{"type":"new_courses","courses":[]}'), null);
  const block = cardBlock({ type: "check_schedule", subjectId: "s1", setup: true });
  assert.deepEqual(cardsIn("Before\n\n" + block + "\n\nafter " + block), [{ type: "check_schedule", subjectId: "s1", setup: true }, { type: "check_schedule", subjectId: "s1", setup: true }]);
});

test("settings patches are checked and merged deeply", () => {
  assert.equal(settingsPatch.safeParse({ save: { kinds: { videos: true } } }).success, true);
  assert.equal(settingsPatch.safeParse({ owner: "x" }).success, false, "nothing else");
  const m = mergeSettings(undefined, { save: { kinds: { videos: true } }, drive: { enabled: true } });
  assert.equal(m.save.kinds.videos, true);
  assert.equal(m.save.kinds.slides, true, "the rest stays");
  assert.equal(mergeSettings(m, { drive: { folderName: "Embedded" } }).drive.enabled, true);
  assert.equal(m.storage.location, "device");
});

test("the AI's settings_update becomes the same patch a card writes, and reads back in words", () => {
  const u = readCard('{"type":"settings_update","save":{"videos":false,"links":true},"check":{"mode":"custom","times":[{"day":0,"time":"21:00"},{"day":2,"time":"21:00"}]}}');
  assert.ok(u && u.type === "settings_update");
  const patch = updatePatch(u);
  assert.deepEqual(patch, { save: { kinds: { videos: false, links: true } }, check: { mode: "custom", times: [{ day: 0, time: "21:00" }, { day: 2, time: "21:00" }], tz: "Africa/Cairo" } });
  assert.equal(settingsPatch.safeParse(patch).success, true);
  assert.equal(updateSummary(u), "Saving links too · Stopped saving videos · Checks: Sun and Tue at 21:00");
  assert.equal(updateSummary({ type: "settings_update", unlink: true }), "Unlinked from CMS");
  assert.deepEqual(updatePatch({ type: "settings_update", check: { mode: "off", times: [{ day: 1, time: "10:00" }] } }).check?.times, []);
});
