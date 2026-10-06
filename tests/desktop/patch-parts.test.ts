import test from "node:test";
import assert from "node:assert/strict";
import { patchParts } from "../../desktop/file-guides.ts";

const sections = [
  { heading: "One", text: "a" },
  { heading: "Two", text: "b", figure: { module: "mowr", fn: "circuit", args: [1], align: "center", width: 0.8 } },
  { heading: "Three", text: "c" },
];

test("a patch changes only the parts it names, merging a figure field by field", () => {
  const out = patchParts(sections, [{ at: 2, figure: { align: "wrap-right", width: null } }], "sections") as any[];
  assert.deepEqual(out[0], sections[0]);
  assert.deepEqual(out[2], sections[2]);
  assert.deepEqual(out[1].figure, { module: "mowr", fn: "circuit", args: [1], align: "wrap-right" });
  assert.equal(out[1].text, "b");
  // The stored source is not changed in place.
  assert.equal(sections[1].figure.align, "center");
});

test("a patch removes and inserts parts, counting from the parts as they were", () => {
  const out = patchParts(sections, [{ at: 1, remove: true }, { at: 3, insert: [{ heading: "Two and a half" }] }, { at: 4, insert: [{ heading: "Four" }] }], "sections") as any[];
  assert.deepEqual(out.map((s) => s.heading), ["Two", "Two and a half", "Three", "Four"]);
});

test("a bad patch is refused with what to send", () => {
  assert.throws(() => patchParts(sections, [], "sections"), /list of changes/);
  assert.throws(() => patchParts(sections, [{ at: 9, text: "x" }], "sections"), /needs "at"/);
  assert.throws(() => patchParts(sections, [{ at: 2 }], "sections"), /changes nothing/);
});
