import { test } from "node:test";
import assert from "node:assert/strict";
import { CronExpressionParser } from "cron-parser";
import { parseSchedule } from "../core/guc/parse.ts";
import { active, convertCheckSchedule, cronLines, defaultCheckSchedule, describeChecks, GUC_DAYS, nextRuns, suggestSchedule, weekly, type CheckSchedule } from "../core/guc/schedule-rules.ts";
import { checkSchema } from "../core/guc/settings.ts";
import { fixture } from "./guc-fake.ts";

const slots = parseSchedule(fixture("schedule"));
const ctx = { suggested: suggestSchedule(slots, "CSEN 701"), slots, code: "CSEN 701", exam: "2027-01-20" };
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
// Wednesday 11 Nov 2026, 12:00 in Cairo (UTC+2, no daylight saving in winter).
const NOW = Date.parse("2026-11-11T10:00:00Z");

// Words → description, cron lines, the next two runs (UTC). null: the AI's turn; a string starting "ask:" asks the person.
const rows: [string, string | null, string[]?, string[]?, typeof ctx?][] = [
  ["every 2 hours on weekdays 8am–10pm", "Every 2 hours, 08:00–22:00, Sat–Thu (GUC week)", ["0 8,10,12,14,16,18,20,22 * * 0,1,2,3,4,6"], ["2026-11-11T12:00", "2026-11-11T14:00"]],
  ["twice a day", "Every day at 08:00 and 20:00", ["0 8,20 * * 0,1,2,3,4,5,6"], ["2026-11-11T18:00", "2026-11-12T06:00"]],
  ["three times a day", "Every day at 08:00 and 15:00 and 22:00", ["0 8,15,22 * * 0,1,2,3,4,5,6"]],
  ["only on lecture days", "Sun at 20:00", ["0 20 * * 0"], ["2026-11-15T18:00", "2026-11-22T18:00"]],
  ["hourly during exams", "Every hour, 08:00–22:00, every day · during exams (30 Dec–20 Jan)", undefined, ["2026-12-30T06:00", "2026-12-30T07:00"]],
  ["after each lecture", "After each lecture: Sun 12:00 · evening check 21:00", ["0 12,21 * * 0"], ["2026-11-15T10:00", "2026-11-15T19:00"]],
  ["sounds good", "After each lecture: Sun 12:00 · evening check 21:00"],
  ["every day at 8pm", "Every day at 20:00", ["0 20 * * 0,1,2,3,4,5,6"]],
  ["sunday and tuesday at 6pm", "Sun and Tue at 18:00", ["0 18 * * 0,2"], ["2026-11-15T16:00", "2026-11-17T16:00"]],
  ["weekdays at 7pm", "Sat–Thu (GUC week) at 19:00", ["0 19 * * 0,1,2,3,4,6"], ["2026-11-11T17:00", "2026-11-12T17:00"]],
  ["on weekdays", "Sat–Thu (GUC week) at 20:00"],
  ["daily at 9:30 am", "Every day at 09:30", ["30 9 * * 0,1,2,3,4,5,6"]],
  ["every evening", "Every day at 20:00"],
  ["every 30 minutes from 9 to 5", "Every 30 minutes, 09:00–17:00, every day", ["0 9,10,11,12,13,14,15,16,17 * * 0,1,2,3,4,5,6", "30 9,10,11,12,13,14,15,16 * * 0,1,2,3,4,5,6"]],
  ["every 10 minutes", "Every 30 minutes, 08:00–22:00, every day"],
  ["every hour between 9am and 6pm on sunday", "Every hour, 09:00–18:00, Sun", ["0 9,10,11,12,13,14,15,16,17,18 * * 0"]],
  ["every 90 minutes on saturday", "Every 90 minutes, 08:00–22:00, Sat", ["0 8,11,14,17,20 * * 6", "30 9,12,15,18,21 * * 6"]],
  ["don't check", "Off", []],
  ["I'll check myself", "Off", []],
  ["whenever the professor feels like it", null],
  ["every day except friday", null],
  ["hourly during exams", "ask:", undefined, undefined, { ...ctx, exam: undefined as unknown as string }],
  ["after each lecture", "ask:", undefined, undefined, { ...ctx, suggested: [] }],
  ["only on lecture days", "ask:", undefined, undefined, { ...ctx, code: "HUMA 101" }],
];
test("check schedules: the person's words → rules, Cairo cron lines and the next runs", () => {
  for (const [text, want, crons, next, c = ctx] of rows) {
    const r = convertCheckSchedule(text, c);
    if (want === null) { assert.ok("needsAI" in r, `${text} → AI`); continue; }
    if (want === "ask:") { assert.ok("ask" in r, `${text} asks`); continue; }
    assert.ok("mode" in r, text);
    assert.equal(describeChecks(r), want, text);
    assert.equal(checkSchema.safeParse(r).success, true, `${text} passes the schema`);
    if (crons) assert.deepEqual(cronLines(r).map((l) => l.cron).sort(), [...crons].sort(), text);
    if (next) assert.deepEqual(nextRuns(r, NOW, 2).map(iso), next, text);
  }
});

test("cron lines and nextRuns agree with pg-boss's cron parser in Africa/Cairo", () => {
  for (const text of ["every 2 hours on weekdays 8am–10pm", "twice a day", "every 90 minutes on saturday", "after each lecture", "sunday and tuesday at 6pm", "every 30 minutes from 9 to 5"]) {
    const s = convertCheckSchedule(text, ctx) as CheckSchedule;
    // Across the April daylight-saving change too.
    for (const from of [NOW, Date.parse("2026-04-20T00:00:00Z")]) {
      const fromCron = cronLines(s).flatMap((l) => { const it = CronExpressionParser.parse(l.cron, { currentDate: new Date(from), tz: "Africa/Cairo" }); return Array.from({ length: 12 }, () => it.next().getTime()); }).sort((a, b) => a - b).slice(0, 12);
      assert.deepEqual(nextRuns(s, from, 12).map(iso), fromCron.map(iso), text);
    }
  }
});

test("Cairo time: winter is UTC+2 all season, summer UTC+3, and the switch nights behave", () => {
  const daily = (time: string): CheckSchedule => ({ mode: "custom", times: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, time })), tz: "Africa/Cairo" });
  // No daylight saving from November to late April: the same UTC hour every day.
  assert.deepEqual(new Set(nextRuns(daily("20:00"), NOW, 60).map((t) => new Date(t).getUTCHours())), new Set([18]));
  // Last Friday of April 2026 (the 24th): clocks go 00:00 → 01:00. 20:00 Cairo is 18:00 UTC before, 17:00 after.
  assert.deepEqual(nextRuns(daily("20:00"), Date.parse("2026-04-22T12:00:00Z"), 3).map(iso), ["2026-04-22T18:00", "2026-04-23T18:00", "2026-04-24T17:00"]);
  // A 00:30 check on the night the clock skips it still runs once that night, and never twice.
  const night = nextRuns(daily("00:30"), Date.parse("2026-04-22T12:00:00Z"), 4);
  assert.equal(new Set(night).size, 4);
  assert.ok(night.every((t, i) => !i || t > night[i - 1]));
  // Last Thursday of October 2026 (the 29th): summer time lasts to its midnight, then UTC+2.
  assert.deepEqual(nextRuns(daily("20:00"), Date.parse("2026-10-28T12:00:00Z"), 3).map(iso), ["2026-10-28T17:00", "2026-10-29T17:00", "2026-10-30T18:00"]);
  // Midnight and Saturday: the GUC week starts on Saturday.
  assert.deepEqual(nextRuns({ mode: "custom", times: [{ day: 6, time: "00:00" }], tz: "Africa/Cairo" }, NOW, 1).map(iso), ["2026-11-13T22:00"]);
});

test("defaults come from the course's schedule; date ranges switch a schedule on and off", () => {
  const after = defaultCheckSchedule(slots, "CSEN 701");
  assert.equal(after.mode, "after_lectures");
  assert.deepEqual(after.times, [{ day: 0, time: "12:00" }, { day: 0, time: "21:00" }], "half an hour after the lecture, and that evening");
  assert.deepEqual(defaultCheckSchedule(slots, "HUMA 101").times.map((t) => t.day).sort(), [...GUC_DAYS].sort(), "no classes: every GUC day");
  const exams = convertCheckSchedule("hourly during exams", ctx) as CheckSchedule;
  assert.equal(active(exams, NOW), false);
  assert.equal(active(exams, Date.parse("2027-01-10T10:00:00Z")), true);
  assert.equal(weekly({ mode: "off", times: [{ day: 1, time: "10:00" }], tz: "Africa/Cairo" }).length, 0);
  assert.deepEqual(nextRuns({ ...exams, during: { from: "2026-01-01", to: "2026-01-02" } }, NOW, 3), [], "a range in the past runs no more");
});
