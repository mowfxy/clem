import { test } from "node:test";
import assert from "node:assert/strict";
import { daysAgo, shortWhen, dayBefore } from "../src/ui/when.ts";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test("dates are counted by calendar day, not by 24-hour steps", () => {
  // Late yesterday is yesterday even when less than a day has passed.
  assert.equal(daysAgo(at(2026, 10, 15, 23), at(2026, 10, 16, 1)), 1);
  assert.equal(shortWhen(at(2026, 10, 15, 23), at(2026, 10, 16, 1)), "yesterday");
  assert.equal(shortWhen(at(2026, 10, 16, 0, 5), at(2026, 10, 16, 23)), "today");
  assert.equal(shortWhen(at(2026, 10, 13), at(2026, 10, 16)), "3 days ago");
  assert.match(shortWhen(at(2026, 9, 1), at(2026, 10, 16)), /Sep|9/);
  assert.match(shortWhen(at(2025, 9, 1), at(2026, 10, 16)), /2025/);
});

test("stepping back a day lands on every date once, across months and clock changes", () => {
  const seen: string[] = [];
  // From 2 April back through March, which holds the European and US clock changes.
  for (let t = at(2026, 4, 2, 0, 30), i = 0; i < 40; i++, t = dayBefore(t)) seen.push(new Date(t).toDateString());
  assert.equal(new Set(seen).size, 40, "no date repeats");
  for (let i = 1; i < seen.length; i++) assert.equal(daysAgo(new Date(seen[i]).getTime(), new Date(seen[i - 1]).getTime()), 1, "no date is skipped: " + seen[i]);
});
