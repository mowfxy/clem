import test from "node:test";
import assert from "node:assert/strict";
import { resumeAt } from "../core/account-usage.ts";

const now = 1_800_000_000_000, s = now / 1000;

test("a used-up window resumes when it resets; with two used up, when the later one does", () => {
  assert.equal(resumeAt({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: s + 600 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: s + 90_000 } } }, now), now + 600_000);
  assert.equal(resumeAt({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: s + 600 }, secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: s + 90_000 } } }, now), now + 90_000_000);
});

test("no used-up window: the soonest reset ahead; nothing known: undefined", () => {
  assert.equal(resumeAt({ rateLimits: { primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: s + 600 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: s + 90_000 } } }, now), now + 600_000);
  assert.equal(resumeAt({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: s - 5 } } }, now), undefined);
  assert.equal(resumeAt(undefined, now), undefined);
});
