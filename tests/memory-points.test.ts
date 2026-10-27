import test from "node:test";
import assert from "node:assert/strict";
import { memoryPoints, toYou } from "../core/memory-points.ts";

test("a list in a sentence becomes a lead and its points", () => {
  const m = memoryPoints("The user prefers study plans that work backward from deadlines, show fixed dates as milestones, break work into dated tasks small enough to start immediately, use one plan block per subject or project, and ask only when a deadline or required work is missing.");
  assert.equal(m.lead, "You prefer study plans that");
  assert.deepEqual(m.points.map((p) => p.text), [
    "Work backward from deadlines", "Show fixed dates as milestones", "Break work into dated tasks small enough to start immediately",
    "Use one plan block per subject or project", "Ask only when a deadline or required work is missing",
  ]);
});

test("semicolon parts keep their commas and their dates come out", () => {
  const m = memoryPoints("The user is preparing for a DSA lab test and EC quiz on October 15, 2026; a DSA midterm covering L1–6 on October 22; Physics 3 covering L1–4 on October 25; EC 1 on October 27; and Math 3 covering L1–9 on October 29, using worksheets 1–5 selectively.");
  assert.equal(m.lead, "You're preparing for");
  assert.deepEqual(m.points, [
    { text: "A DSA lab test and EC quiz", when: "Oct 15" },
    { text: "A DSA midterm covering L1–6", when: "Oct 22" },
    { text: "Physics 3 covering L1–4", when: "Oct 25" },
    { text: "EC 1", when: "Oct 27" },
    { text: "Math 3 covering L1–9, using worksheets 1–5 selectively", when: "Oct 29" },
  ]);
});

test("a plain fact stays one line; dashed lines are points", () => {
  assert.deepEqual(memoryPoints("The user's calculus exam is on 12 November."), { lead: "Your calculus exam is on 12 November", points: [] });
  assert.deepEqual(memoryPoints("Exams:\n- Calculus on 12 November\n- Physics"), { lead: "Exams", points: [{ text: "Calculus", when: "Nov 12" }, { text: "Physics" }] });
  assert.equal(toYou("The user finds integration by parts hard"), "You find integration by parts hard");
  assert.equal(toYou("The user studies at night"), "You study at night");
});
