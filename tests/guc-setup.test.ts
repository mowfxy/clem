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
  assert.equal(describeChecks(defaultCheckSchedule(slots, "HUMA 101")), "Sat–Thu (GUC week) at 20:00");
  const after = defaultCheckSchedule(slots, "CSEN 701");
  assert.equal(describeChecks(after), "After each lecture: Sun 12:00 · evening check 21:00");
  // Wednesday 11 Nov 2026, 12:00 in Cairo (UTC+2): the next Sunday lecture check is 15 Nov 12:00 Cairo, 10:00 UTC.
  assert.equal(new Date(nextCheck(after, Date.parse("2026-11-11T10:00:00Z"))!).toISOString(), "2026-11-15T10:00:00.000Z");
  assert.equal(nextCheck({ ...after, mode: "off" }, Date.now()), undefined);
  assert.equal(new Date(cairoTime("2026-07-01", "12:00")).toISOString(), "2026-07-01T09:00:00.000Z", "summer time");
  assert.deepEqual(cronLines(parseCheckSchedule("sunday and tuesday at 6pm")!), [{ key: "m0h18d02", cron: "0 18 * * 0,2" }]);
  assert.equal(describeChecks(parseCheckSchedule("every day at 8pm")!), "Every day at 20:00");
  assert.equal(describeChecks(parseCheckSchedule("daily at 9:30 am")!), "Every day at 09:30");
  assert.equal(parseCheckSchedule("after each lecture", suggestChecks(slots, "CSEN 701"))?.mode, "after_lectures");
  assert.equal(parseCheckSchedule("don't check")?.mode, "off");
  assert.equal(parseCheckSchedule("every evening")?.times[0].time, "20:00");
  assert.equal(parseCheckSchedule("twice a day")?.times.length, 14);
  assert.equal(parseCheckSchedule("whenever the professor feels like it"), null);
});

const ctx = { linked: true, vps: false };
test("setup asks only which course it is, and only when Clem can't tell", () => {
  let s = startSetup(0);
  const order: SetupStep[] = [];
  for (let step = nextStep(s, ctx); step; step = nextStep(s, ctx)) { order.push(step); s = answer(s, step, "answered", ctx); }
  assert.deepEqual(order, ["link"]);
  assert.equal(s.finished, true);
  assert.equal(nextStep(startSetup(0, true), { linked: true, vps: true }), null, "made from a course: nothing to ask, not what to save, when to check, Drive or storage");
  assert.equal(toPost(startSetup(0, true), { linked: true, vps: true }, []), "done", "only the line that says what Clem does");
  // A thread an older Clem left waiting on "what to save" just closes.
  assert.equal(toPost({ done: { link: "answered" }, started: 0 }, ctx, ["link", "save"]), "done");
  const skipped = answer(startSetup(0), "link", "skipped", { linked: false, vps: false });
  assert.equal(skipped.finished, true, "no course: nothing left to ask");
});

test("setup resumes after a restart and editing an earlier answer keeps its place", () => {
  assert.equal(toPost(startSetup(0), ctx, []), "link");
  assert.equal(toPost(startSetup(0), ctx, ["link"]), null, "already asked: wait for the answer");
  const s = answer(startSetup(0), "link", "answered", ctx);
  assert.equal(toPost(s, ctx, ["link"]), "done", "the app closed before the closing line went out");
  const again = answer(s, "link", "answered", ctx);
  assert.deepEqual(again.done, s.done);
  assert.equal(nextStep(again, ctx), null, "changing the link later doesn't go back");
  assert.equal(toPost(s, ctx, ["link", "done"]), null, "said once");
  // Old threads' cards still count as asked.
  assert.equal(stepOfCard(readCard('{"type":"save_rules","subjectId":"s1","setup":true}')!), "save");
  assert.equal(stepOfCard(readCard('{"type":"save_rules","subjectId":"s1"}')!), undefined, "a card outside setup asks nothing");
});

test("setup messages are plain chat text, no cards, and never ask what to keep", () => {
  const info = { subjectId: "s1", subject: "Embedded", course: { key: "1201:64", code: "CSEN 701", name: "Embedded Systems Architecture" }, linked: false, sure: false, save: "Slides and assignments", check: "", first: true, choices: ["CSEN 702 Microprocessors"] };
  const link = setupMessage("link", info);
  assert.ok(link.startsWith("Is **Embedded** **CSEN 701** (Embedded Systems Architecture) on CMS?"), link);
  assert.ok(link.includes("CSEN 702 Microprocessors"));
  assert.ok(setupMessage("link", { ...info, course: undefined }).startsWith("Which CMS course is **Embedded**?"));
  assert.equal(setupMessage("save", { ...info, linked: true }), "", "not a question any more");
  const done = setupMessage("done", { ...info, linked: true });
  assert.ok(done.startsWith("**Embedded** is linked to **CSEN 701**"), done);
  assert.ok(done.includes("I keep slides and assignments the moment they're posted"), done);
  assert.ok(done.includes("for this course or for all of them"));
  assert.ok(setupMessage("done", { ...info, linked: true, lead: "I found it and linked it." }).startsWith("I found it and linked it. I watch it"));
  assert.match(setupMessage("done", { ...info, course: undefined }), /stays off CMS/);
  for (const step of ["link", "save", "done"] as const) assert.equal(cardsIn(setupMessage(step, info)).length, 0, step);
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
