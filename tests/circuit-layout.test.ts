import test from "node:test";
import assert from "node:assert/strict";
import { layoutCircuit } from "../vendor/kinetra/packages/core/src/diagram/circuit_schematic.ts";

// A circuit copied from a figure keeps that figure's arrangement (owner, 2026-11-25: a ladder with diagonals came out as
// one long rail with arches). The full geometry checks are in vendor/kinetra's circuit_layout.test.ts.
test("a circuit given node positions is drawn in that arrangement, diagonals included", () => {
  const R = (from: string, to: string) => ({ kind: "resistor", from, to, value: 10, unit: "Ω" });
  const layout: Record<string, [number, number]> = { 1: [1, 0], 2: [1, 1], 3: [1, 2], 0: [1, 3], 4: [3, 0], 5: [3, 1], 6: [3, 2], 7: [3, 3] };
  const elements = [{ kind: "voltage-source", from: "0", to: "1", value: 120, unit: "V", at: [0, 1.5] as [number, number] },
    R("1", "2"), R("2", "3"), R("3", "0"), R("1", "4"), R("1", "5"), R("5", "2"), R("3", "5"), R("3", "6"), R("3", "7"), R("7", "0"), R("4", "5"), R("5", "6"), R("6", "7")];
  const drawn = layoutCircuit({ layout, elements });
  const unit = drawn.pins[1].at[1].y - drawn.pins[1].at[0].y;
  elements.forEach((e, i) => [e.from, e.to].forEach((n, end) => {
    const p = drawn.pins[i].at[end as 0 | 1];
    assert.ok(Math.abs(p.x - layout[n][0] * unit) < 1 && Math.abs(p.y - layout[n][1] * unit) < 1, `node ${n} moved`);
  }));
  assert.equal(drawn.segments.filter((s) => s.a.x !== s.b.x && s.a.y !== s.b.y).length, 6, "three diagonals, each a lead on both sides of its resistor");
});
