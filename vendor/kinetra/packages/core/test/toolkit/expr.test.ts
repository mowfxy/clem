import { test } from "node:test";
import assert from "node:assert/strict";
import { toolkitDimLabel, toolkitEvalQuantity, toolkitVariableScope, ToolkitFailure } from "../../src/toolkit/index.js";
import { evalAngle, evalLength } from "../../src/toolkit/expr.js";
import { close } from "./helpers.js";

const scope = toolkitVariableScope({ m: "5 kg", g: "9.81 m/s^2", theta: "30 deg", W: "m*g", h: "20 cm" });
const q = (s: string | number) => toolkitEvalQuantity(s, scope, "t", ["x"]);
const code = (f: () => unknown) => { try { f(); } catch (e) { if (e instanceof ToolkitFailure) return e.issue.code; throw e; } return "none"; };

test("toolkit expr: formulas with units evaluate in SI with dimensions", () => {
  close(q("m*g").value, 49.05);
  assert.equal(toolkitDimLabel(q("m*g").dim), "N (kg*m*s^-2)");
  close(q("W*sin(theta)").value, 24.525);
  close(q("0.5*m*(3 m/s)^2").value, 22.5);
  assert.equal(toolkitDimLabel(q("0.5*m*(3 m/s)^2").dim), "J (kg*m^2*s^-2)");
  close(q("h + 5 mm").value, 0.205);
  close(q("30°").value, Math.PI / 6);
  close(q("atan2(3, 4)").value, Math.atan2(3, 4));
  close(q("sqrt(4 m^2)").value, 2);
  close(q("min(1 m, 30 cm)").value, 0.3);
  close(q("2 kg m/s^2").value, 2);
  assert.equal(toolkitDimLabel(q("2 kg m/s^2").dim), "N (kg*m*s^-2)");
  close(q(7).value, 7);
});

test("toolkit expr: a number followed by units is one quantity literal", () => {
  // "m" after a number is the metre, even though m is a variable (5 kg).
  close(q("9.81 m/s^2").value, 9.81);
  assert.equal(toolkitDimLabel(q("9.81 m/s^2").dim), "m*s^-2");
  close(q("4/2 m").value, 2); // 4 / (2 m)
  assert.equal(toolkitDimLabel(q("4/2 m").dim), "m^-1");
});

test("toolkit expr: unary minus binds looser than ^ and literals before ) parse", () => {
  close(q("-3^2").value, -9);
  close(q("2*-3").value, -6);
  close(q("2^-1").value, 0.5);
  close(q("(2)").value, 2);
  close(q("sin(90 deg)").value, 1);
});

test("toolkit expr: unit mismatches and bare trig arguments are errors", () => {
  assert.equal(code(() => q("1 N + 2 m")), "E_UNIT_MISMATCH");
  assert.equal(code(() => q("sin(30)")), "E_UNIT_MISMATCH");
  assert.equal(code(() => q("exp(2 m)")), "E_UNIT_MISMATCH");
  assert.equal(code(() => q("2^(1 m)")), "E_UNIT_MISMATCH");
  assert.equal(code(() => q("asin(2 m)")), "E_UNIT_MISMATCH");
});

test("toolkit expr: unknown names suggest close matches; parse and non-finite errors", () => {
  try { q("thet + 1"); assert.fail("should throw"); } catch (e) {
    assert.ok(e instanceof ToolkitFailure);
    assert.equal(e.issue.code, "E_EXPR_UNKNOWN_NAME");
    assert.match(e.issue.suggestion!, /theta/);
  }
  assert.equal(code(() => q("(1 + 2")), "E_EXPR_PARSE");
  assert.equal(code(() => q("1 $ 2")), "E_EXPR_PARSE");
  assert.equal(code(() => q("pow(2, 3)")), "E_EXPR_PARSE");
  assert.equal(code(() => q("1/0")), "E_NON_FINITE");
  assert.equal(code(() => q("sqrt(-1)")), "E_NON_FINITE");
  assert.equal(code(() => q("")), "E_SCHEMA");
});

test("toolkit expr: circular variables are reported with the cycle", () => {
  const s = toolkitVariableScope({ a: "b + 1", b: "2*a" });
  try { toolkitEvalQuantity("a", s, "t", []); assert.fail("should throw"); } catch (e) {
    assert.ok(e instanceof ToolkitFailure);
    assert.equal(e.issue.code, "E_CIRCULAR");
    assert.deepEqual(e.issue.elements, ["var:a", "var:b", "var:a"]);
  }
});

test("toolkit expr: lengths convert through the world unit, angles need units in strings", () => {
  const ctx = { scope, worldUnitSI: 0.01 }; // world unit = 1 cm
  close(evalLength("2 m", ctx, "l", []), 200);
  close(evalLength(3, ctx, "l", []), 3);
  close(evalLength("h", ctx, "l", []), 20);
  assert.equal(code(() => evalLength("2 s", ctx, "l", [])), "E_UNIT_MISMATCH");
  close(evalAngle(90, ctx, "a", []), Math.PI / 2); // JSON numbers are degrees
  close(evalAngle("theta + 0.5 rad", ctx, "a", []), Math.PI / 6 + 0.5);
  assert.equal(code(() => evalAngle("30", ctx, "a", [])), "E_UNIT_MISMATCH");
});
