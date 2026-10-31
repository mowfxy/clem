// A document's date is read in New York, where a bare "2026-10-31" read as UTC midnight falls on the 30th.
process.env.TZ = "America/New_York";
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatNumber } from "../core/numfmt.ts";
import { newPlan, planStatus } from "../core/plans.ts";
import { compileVisual, defaultValues, type Pen } from "../core/visual-spec.ts";
import { studyStanding } from "../core/study-standing.ts";
import { longDate } from "../desktop/pdf-document.ts";
import type { StudySet } from "../core/types.ts";

test("a document dated 2026-10-31 says 31 October wherever it is made", () => {
  assert.equal(longDate("2026-10-31"), "31 October 2026");
  assert.equal(longDate("Autumn term"), "Autumn term");
});

test("a plan the model starts next week shows as upcoming", () => {
  const now = new Date(2026, 9, 12, 12).getTime();
  const plan = newPlan("s1", { title: "Revision", start: "2026-10-20", tasks: [{ id: "a", title: "a", due: "2026-11-01" }] }, now);
  assert.equal(plan.start, "2026-10-20");
  assert.equal(planStatus(plan, "2026-10-12").state, "upcoming");
});

test("scientific formats carry rounding into the exponent and step by engineering places", () => {
  assert.equal(formatNumber(9.999, "0.00E+00"), "1.00E+01");
  assert.equal(formatNumber(99999, "0.0E+00"), "1.0E+05");
  assert.equal(formatNumber(12345, "##0.0E+0"), "12.3E+3");
  assert.equal(formatNumber(0.0123, "##0.0E+0"), "12.3E-3");
  assert.equal(formatNumber(999999, "##0.0E+0"), "1.0E+6");
});

test("serials before Excel's 29 February 1900 show the days Excel shows", () => {
  assert.equal(formatNumber(1, "m/d/yyyy"), "1/1/1900");
  assert.equal(formatNumber(59, "m/d/yyyy"), "2/28/1900");
  assert.equal(formatNumber(61, "m/d/yyyy"), "3/1/1900");
  assert.equal(formatNumber(1, "m/d/yyyy", true), "1/2/1904");
});

test("a plot whose range runs to infinity still draws on finite axes", () => {
  const plot = compileVisual({ kind: "plot", title: "Open", x: { min: 0, max: "1/0" }, y: { min: -1, max: 1 }, layers: [{ type: "function", expr: "sin(x)" }] });
  const ticks: string[] = [];
  const pen: Pen = { w: 800, h: 440, path: () => {}, circle: () => {}, text: (_x, _y, text) => { ticks.push(text); } };
  plot.draw(pen, defaultValues(plot), 0);
  // An infinite x axis had no ticks and no curve on it; a missing bound falls back to 0–1.
  assert.ok(ticks.includes("0.5"), ticks.join(" | "));
});

test("a strong card the learner just missed is not counted as known", () => {
  const DAY = 86_400_000, now = Date.parse("2026-10-23T12:00:00Z");
  const card = (missed: boolean) => ({ stability: 30, difficulty: 5, reps: 4, lapses: missed ? 1 : 0, last: now - DAY, due: missed ? now - DAY + 600_000 : now + 20 * DAY });
  const sets: StudySet[] = [{ id: "f", spaceId: "s", kind: "flashcards", title: "Cells", items: [{ question: "a", answer: "b" }, { question: "c", answer: "d" }], created: 0, attempts: [], cards: [card(false), card(true)] }];
  assert.match(studyStanding(sets, undefined, now), /knows 1 well/);
});
