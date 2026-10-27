import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolkitStyle, formatLabelText, measureLabelWidth, toolkitTextBox } from "../../src/toolkit/index.js";
import { segSegDist, shapeDistance, pointInPolygon, containedIn } from "../../src/toolkit/geometry.js";
import { close, err, model, ok } from "./helpers.js";

test("toolkit geometry: exact distances between stroke, area and disc shapes", () => {
  close(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }, { x: 5, y: 10 }), 3);
  close(segSegDist({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), 0);
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  close(shapeDistance({ kind: "stroke", points: [{ x: 13, y: 0 }, { x: 13, y: 10 }], r: 1 }, { kind: "area", points: sq }), 2);
  close(shapeDistance({ kind: "disc", c: { x: 5, y: 5 }, r: 1 }, { kind: "area", points: sq }), 0);
  close(shapeDistance({ kind: "disc", c: { x: 0, y: 0 }, r: 1 }, { kind: "disc", c: { x: 5, y: 0 }, r: 2 }), 2);
  // A stroke ring around a hole does not collide with what is inside the hole.
  close(shapeDistance({ kind: "stroke", points: sq, r: 0.5, closed: true }, { kind: "disc", c: { x: 5, y: 5 }, r: 1 }), 3.5);
  assert.ok(pointInPolygon({ x: 5, y: 5 }, sq) && !pointInPolygon({ x: 11, y: 5 }, sq));
  assert.ok(containedIn([{ x: 4, y: 4 }, { x: 6, y: 6 }], sq, 2) && !containedIn([{ x: 1, y: 4 }], sq, 2));
});

test("toolkit text: per-character Arial widths, Greek, sub/superscripts", () => {
  close(measureLabelWidth("W", 10), 9.44);
  close(measureLabelWidth("il", 10), 4.44);
  assert.ok(measureLabelWidth("mg", 12) > measureLabelWidth("ii", 12));
  assert.equal(formatLabelText("F_n"), "Fₙ");
  assert.equal(formatLabelText("v_0"), "v₀");
  assert.equal(formatLabelText("x^2"), "x²");
  assert.equal(formatLabelText("v_{max}"), "vₘₐₓ");
  assert.equal(formatLabelText("\\theta = 30\\deg"), "θ = 30°");
  close(measureLabelWidth("θ", 10), 5.56);
  // Unknown glyphs are measured as a full em: never underestimated.
  close(measureLabelWidth("☃", 12), 12);
  // Unicode has no capital subscripts: F_N is rejected with a precise error.
  assert.throws(() => formatLabelText("F_N"), /"N" has no Unicode subscript/);
  assert.throws(() => formatLabelText("\\foo"), /Unknown symbol/);
  const b = toolkitTextBox(100, 50, "mg", 12, "middle");
  assert.ok(b.x0 < 100 && b.x1 > 100 && b.y0 < 50 - 10 && b.y1 > 50);
});

const twoBoxes = (extra: Record<string, unknown> = {}) => model([
  { id: "a", type: "rect", w: 2, h: 2, at: { x: 0, y: 0 } },
  { id: "b", type: "rect", w: 2, h: 2, at: { x: 1.5, y: 0 }, ...extra },
]);

test("toolkit gate: overlapping elements fail unless mayTouch is declared", () => {
  const e = err(twoBoxes(), "E_COLLISION");
  assert.deepEqual(e.elements, ["a", "b"]);
  assert.match(e.suggestion!, /"mayTouch": \["a"\] to "b"|"mayTouch": \["b"\] to "a"/);
  const r = ok(twoBoxes({ mayTouch: ["a"] }));
  assert.deepEqual(r.report.contacts, [{ a: "a", b: "b", reason: "mayTouch" }]);
  assert.equal(r.report.gate!.collisions, 0);
});

test("toolkit gate: an arrow starting on its body needs an explicit contact", () => {
  const els = [
    { id: "body", type: "block", w: 2, h: 1, at: { x: 0, y: 0 } },
    { id: "F", type: "arrow", from: "body.center", angle: 0, length: 3 },
  ];
  const e = err(model(els), "E_COLLISION");
  assert.deepEqual(e.elements, ["body", "F"]);
  ok(model([els[0]!, { ...els[1]!, mayTouch: ["body"] }]));
});

test("toolkit gate: unfilled outlines do not collide with their contents; filled ones do", () => {
  ok(model([{ id: "frame", type: "rect", w: 6, h: 4, at: { x: 0, y: 0 } }, { id: "c", type: "circle", r: 0.5, at: { x: 0, y: 0 } }]));
  err(model([{ id: "frame", type: "rect", w: 6, h: 4, fill: "bodyFill", at: { x: 0, y: 0 } }, { id: "c", type: "circle", r: 0.5, at: { x: 0, y: 0 } }]), "E_COLLISION");
});

test("toolkit gate: out-of-bounds geometry, title and caption", () => {
  let e = err(model([{ id: "s", type: "segment", from: { x: 0, y: 0 }, to: { x: 9, y: 0 } }]), "E_OUT_OF_BOUNDS");
  assert.deepEqual(e.elements, ["s"]);
  assert.equal((e.measured as { side: string }).side, "right");
  e = err(model([{ id: "p", type: "point", at: { x: 0, y: 0 } }], { caption: "x".repeat(140) }), "E_OUT_OF_BOUNDS");
  assert.deepEqual(e.elements, ["caption"]);
  assert.match(e.suggestion!, /Shorten the caption/);
  err(model([{ id: "s", type: "segment", from: { x: -2, y: 3.9 }, to: { x: 2, y: 3.9 } }], { title: "A title" }), "E_COLLISION");
});

test("toolkit gate: arrows too short to read are rejected with a scale suggestion", () => {
  const e = err(model([{ id: "F", type: "force", from: { x: 0, y: 0 }, angle: 0, magnitude: "1 N" }], { scales: { force: { per: "10 N" } } }), "E_ARROW_TOO_SHORT");
  assert.match(e.suggestion!, /scales\.force\.per/);
});

test("toolkit labels: greedy placement avoids geometry and keeps labels in bounds", () => {
  const r = ok(model([
    { id: "F", type: "arrow", from: { x: 0, y: 0 }, angle: 0, length: 2, label: "F" },
    { id: "G", type: "arrow", from: { x: 0, y: 0.6 }, angle: 0, length: 2, label: "G", mayTouch: [] },
  ]));
  assert.equal(r.report.labels.length, 2);
  const [a, b] = r.report.labels.map(l => l.box);
  assert.ok(a!.x1 <= b!.x0 || b!.x1 <= a!.x0 || a!.y1 <= b!.y0 || b!.y1 <= a!.y0, "labels must not overlap");
  assert.equal(r.report.labels.find(l => l.owner === "F")!.position, "right");
});

test("toolkit labels: a pinned label that collides reports the free positions", () => {
  const e = err(model([
    { id: "mg", type: "arrow", from: { x: 0, y: 0 }, angle: -90, length: 2 },
    { id: "N", type: "arrow", from: { x: 0.3, y: -1 }, angle: 90, length: 0.6, label: { text: "N", position: "left" } },
  ]), "E_COLLISION");
  assert.deepEqual(e.elements, ["label:N", "mg"]);
  assert.match(e.message, /label "N" of "N" at "left" overlaps "mg"; free positions: .*right/);
  assert.match(e.suggestion!, /Set "position": /);
});

test("toolkit labels: priority, local search and leader lines", () => {
  // A ring of segments with one gap leaves no free direct position near the
  // point; only a leader through the gap works.
  const ring = Array.from({ length: 7 }, (_, k) => {
    const a = k * Math.PI / 4;
    return { id: `s${k}`, type: "segment", from: { x: 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) }, to: { x: 0.5 * Math.cos(a + Math.PI / 4), y: 0.5 * Math.sin(a + Math.PI / 4) }, mayTouch: [`s${(k + 1) % 8}`, `s${(k + 7) % 8}`].filter(n => n !== "s7") };
  });
  const r = ok(model([...ring, { id: "p", type: "point", at: { x: 0, y: 0 }, label: "centre" }]));
  const l = r.report.labels.find(x => x.owner === "p")!;
  assert.equal(l.position, "leader");
  assert.ok(l.leader && Math.hypot(l.leader.to.x - l.leader.from.x, l.leader.to.y - l.leader.from.y) >= 6);
  assert.match(r.svg, /stroke="#777" stroke-width="0.8"/);
  // Leaders can be disabled, giving a precise unplaceable error.
  const e = err(model([...ring, { id: "p", type: "point", at: { x: 0, y: 0 }, label: { text: "centre", leader: false } }]), "E_LABEL_UNPLACEABLE");
  assert.ok((e.measured as { tried: unknown[] }).tried.length >= 8);
});

test("toolkit labels: label inside a closed owner, or outside when the inside is busy", () => {
  let r = ok(model([{ id: "b", type: "block", w: 2, h: 1, at: { x: 0, y: 0 }, label: "box" }]));
  assert.equal(r.report.labels[0]!.position, "center");
  assert.deepEqual(r.report.contacts.map(c => c.reason), ["label inside its owner"]);
  r = ok(model([
    { id: "b", type: "block", w: 2, h: 1, at: { x: 0, y: 0 }, label: "box" },
    { id: "F", type: "arrow", from: "b.center", angle: 0, length: 2, mayTouch: ["b"] },
  ]));
  assert.notEqual(r.report.labels[0]!.position, "center");
});

test("toolkit style: composed SVG conforms to the style contract and rejects off-palette colours", () => {
  const r = ok(model([{ id: "b", type: "block", w: 2, h: 1, at: { x: 0, y: 0 }, label: "m" }], { title: "Body", caption: "One body" }));
  assert.deepEqual(checkToolkitStyle(r.svg, { title: "Body", caption: "One body" }), []);
  assert.ok(r.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">'));
  err(model([{ id: "b", type: "rect", w: 2, h: 1, fill: "#ff00ff", at: { x: 0, y: 0 } }]), "E_STYLE");
  err(model([{ id: "s", type: "segment", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, width: 5 }]), "E_STYLE");
  err(model([{ id: "t", type: "text", text: "hi", size: 30, at: { x: 0, y: 0 } }]), "E_STYLE");
  err(model([{ id: "p", type: "point", at: { x: 0, y: 0 }, label: { text: "x", size: 20 as 12 } }]), "E_STYLE");
});

test("toolkit determinism: the same model renders the same bytes", () => {
  const m = model([
    { id: "b", type: "block", w: 2, h: 1, at: { x: 0, y: 0 }, label: "m" },
    { id: "F", type: "arrow", from: "b.right", angle: 20, length: 2, label: "F", mayTouch: ["b"] },
  ], { title: "Same", caption: "twice" });
  assert.equal(ok(m).svg, ok(structuredClone(m)).svg);
});
