import { test } from "node:test";
import assert from "node:assert/strict";
import { close, err, model, ok, origin } from "./helpers.js";

test("toolkit resolver: raw coordinates, attach and anchors", () => {
  const r = ok(model([
    { id: "ground", type: "segment", from: { x: -5, y: -2 }, to: { x: 5, y: -2 } },
    { id: "b", type: "block", w: 2, h: 1, place: { attach: "bottom", to: "ground.mid" }, mayTouch: ["ground"] },
    { id: "c", type: "circle", r: 0.5, at: { ref: "b.top", dy: 1.5 } },
  ]));
  close(origin(r, "b").x, 0); close(origin(r, "b").y, -1.5);
  close(origin(r, "c").x, 0); close(origin(r, "c").y, -1 + 1.5);
});

test("toolkit resolver: rotated anchors follow the body", () => {
  const r = ok(model([
    { id: "p", type: "point", at: { x: 0, y: 0 } },
    { id: "b", type: "rect", w: 2, h: 1, rotation: 90, place: { attach: "bottom", to: { x: 3, y: 0 } } },
  ]));
  // Rotated 90 deg, the bottom anchor sits at +x of the centre... (rot(0,-0.5) by 90 deg = (0.5, 0))
  close(origin(r, "b").x, 2.5); close(origin(r, "b").y, 0);
});

test("toolkit resolver: side-by-side relations with gap and alignment", () => {
  const r = ok(model([
    { id: "a", type: "rect", w: 2, h: 2, at: { x: -3, y: 0 } },
    { id: "b", type: "rect", w: 1, h: 1, place: { rightOf: "a", gap: 0.5 } },
    { id: "c", type: "rect", w: 1, h: 1, place: { below: "a", gap: "50 cm", align: "start" } },
    { id: "d", type: "rect", w: 1, h: 1, place: [{ above: "a", gap: 0.5, align: "none" }, { x: -2 }] },
  ]));
  close(origin(r, "b").x, -3 + 1 + 0.5 + 0.5); close(origin(r, "b").y, 0);
  close(origin(r, "c").x, -4 + 0.5); close(origin(r, "c").y, -1 - 0.5 - 0.5);
  close(origin(r, "d").x, -2); close(origin(r, "d").y, 1 + 0.5 + 0.5);
});

test("toolkit resolver: along, alignedWith, distance with prefer", () => {
  const r = ok(model([
    { id: "o", type: "point", at: { x: 0, y: 0 } },
    { id: "p", type: "point", place: { along: { from: "o", angle: "45 deg", distance: "2 m" } } },
    { id: "q", type: "point", place: [{ along: { from: "o", angle: 0 } }, { x: 3 }] },
    { id: "s", type: "point", place: [{ alignedWith: "p", axis: "x" }, { distance: 2, from: "o" }], prefer: "below" },
  ]));
  close(origin(r, "p").x, Math.SQRT2); close(origin(r, "p").y, Math.SQRT2);
  close(origin(r, "q").x, 3); close(origin(r, "q").y, 0);
  close(origin(r, "s").x, Math.SQRT2); close(origin(r, "s").y, -Math.SQRT2);
});

test("toolkit resolver: tangency to circles and segments", () => {
  const r = ok(model([
    { id: "big", type: "circle", r: 2, at: { x: -2, y: 0 } },
    { id: "small", type: "circle", r: 1, place: [{ tangentTo: "big" }, { y: 0 }], prefer: "right", mayTouch: ["big"] },
    { id: "inner", type: "circle", r: 0.5, place: [{ tangentTo: "big", mode: "internal" }, { y: 0 }], prefer: "left", mayTouch: ["big"] },
    { id: "slope", type: "segment", from: { x: 0, y: -3 }, to: { x: 5, y: -0.5 } },
    { id: "ball", type: "circle", r: 0.5, place: [{ tangentTo: "slope", side: "above" }, { x: 3 }], mayTouch: ["slope"] },
  ]));
  close(origin(r, "small").x, 1);
  close(origin(r, "inner").x, -3.5);
  const b = origin(r, "ball");
  const dir = { x: 5, y: 2.5 }, len = Math.hypot(dir.x, dir.y);
  const dist = ((b.x - 0) * dir.y - (b.y + 3) * dir.x) / len;
  close(Math.abs(dist), 0.5);
  assert.ok(b.y > -3 + 3 * 0.5); // above the line
});

test("toolkit resolver: under-constrained elements name the free direction", () => {
  let e = err(model([{ id: "a", type: "rect", w: 1, h: 1 }]), "E_UNDERCONSTRAINED");
  assert.deepEqual(e.elements, ["a"]);
  assert.match(e.message, /both x and y are free/);
  e = err(model([{ id: "a", type: "rect", w: 1, h: 1, place: { y: 1 } }]), "E_UNDERCONSTRAINED");
  assert.match(e.message, /x is free/);
  assert.match(e.suggestion!, /Fix x/);
  e = err(model([{ id: "o", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "point", place: { distance: 1, from: "o" } }]), "E_UNDERCONSTRAINED");
  assert.deepEqual(e.elements, ["a", "o"]);
  assert.match(e.message, /circle/);
  e = err(model([{ id: "a", type: "rect", w: 1, h: 1 }, { id: "b", type: "rect", w: 1, h: 1, place: { rightOf: "a", align: "none" } }]), "E_UNDERCONSTRAINED");
});

test("toolkit resolver: contradictory constraints name the relations and residual", () => {
  const e = err(model([{ id: "a", type: "point", place: [{ x: 1 }, { at: { x: 2, y: 0 } }] }]), "E_CONTRADICTORY");
  assert.deepEqual(e.elements, ["a"]);
  close((e.measured as { residual: number }).residual, 1, 1e-9);
  assert.match(e.message, /place\[0\], place\[1\]/);
  err(model([{ id: "o", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "point", place: [{ distance: 1, from: "o" }, { x: 3 }] }]), "E_CONTRADICTORY");
  err(model([{ id: "a", type: "point", place: [{ x: 1 }, { x: 2 }, { y: 0 }] }]), "E_CONTRADICTORY");
  err(model([{ id: "o", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "point", place: [{ along: { from: "o", angle: 0 } }, { x: -2 }] }]), "E_CONTRADICTORY");
  err(model([{ id: "s", type: "segment", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, { id: "c", type: "circle", r: 0.5, place: [{ tangentTo: "s", side: "above" }, { x: 4 }] }]), "E_CONTRADICTORY");
});

test("toolkit resolver: ambiguous intersections ask for prefer", () => {
  const e = err(model([{ id: "o", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "point", place: [{ distance: 2, from: "o" }, { x: 1 }] }]), "E_AMBIGUOUS");
  assert.match(e.suggestion!, /"prefer": "above" or "below"/);
  assert.equal((e.measured as { candidates: unknown[] }).candidates.length, 2);
  err(model([{ id: "s", type: "segment", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, { id: "c", type: "circle", r: 0.5, place: [{ tangentTo: "s" }, { x: 0.5 }] }]), "E_AMBIGUOUS");
});

test("toolkit resolver: circular placement is reported with the cycle", () => {
  const e = err(model([
    { id: "a", type: "rect", w: 1, h: 1, place: { rightOf: "b" } },
    { id: "b", type: "rect", w: 1, h: 1, place: { rightOf: "c" } },
    { id: "c", type: "rect", w: 1, h: 1, place: { leftOf: "a" } },
  ]), "E_CIRCULAR");
  assert.deepEqual([...e.elements].sort(), ["a", "b", "c"]);
  assert.match(e.message, /a -> b -> c -> a/);
  err(model([{ id: "a", type: "point", at: "a.center" }]), "E_CIRCULAR");
});

test("toolkit resolver: references, anchors, ids and part types are validated", () => {
  let e = err(model([{ id: "a", type: "point", at: "blok.top" }, { id: "block", type: "point", at: { x: 0, y: 0 } }]), "E_UNKNOWN_REF");
  assert.match(e.suggestion!, /block/);
  e = err(model([{ id: "b", type: "rect", w: 1, h: 1, at: { x: 0, y: 0 } }, { id: "a", type: "point", at: "b.tpo" }]), "E_UNKNOWN_ANCHOR");
  assert.match(e.suggestion!, /top/);
  err(model([{ id: "c", type: "circle", r: 1, at: { x: 0, y: 0 } }, { id: "a", type: "point", at: "c.rim" }]), "E_UNKNOWN_ANCHOR");
  err(model([{ id: "a", type: "point", at: { x: 0, y: 0 } }, { id: "a", type: "point", at: { x: 1, y: 0 } }]), "E_DUPLICATE_ID");
  e = err(model([{ id: "a", type: "circel", at: { x: 0, y: 0 } }]), "E_UNKNOWN_PART");
  assert.match(e.suggestion!, /circle/);
  e = err(model([{ id: "a", type: "rect", w: 1, h: 1, width: 3, at: { x: 0, y: 0 } }]), "E_SCHEMA");
  assert.match(e.message, /"width" is not a property of rect/);
  err(model([{ id: "a.b", type: "point", at: { x: 0, y: 0 } }]), "E_SCHEMA");
  err(model([{ id: "s", type: "segment", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, at: { x: 0, y: 0 } }]), "E_SCHEMA");
});

test("toolkit resolver: inside relations are verified after resolution", () => {
  ok(model([
    { id: "box", type: "rect", w: 4, h: 3, at: { x: 0, y: 0 } },
    { id: "c", type: "circle", r: 0.5, place: [{ at: { x: 0, y: 0 } }, { inside: "box", margin: 0.2 }] },
  ]));
  const e = err(model([
    { id: "box", type: "rect", w: 4, h: 3, at: { x: 0, y: 0 } },
    { id: "c", type: "circle", r: 0.5, place: [{ at: { x: 1.8, y: 0 } }, { inside: "box" }], mayTouch: ["box"] },
  ]), "E_CONSTRAINT_VIOLATED");
  assert.deepEqual(e.elements, ["c", "box"]);
});
