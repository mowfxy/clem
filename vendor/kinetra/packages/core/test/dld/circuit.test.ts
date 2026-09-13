import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoolExpr, collectVariables } from "../../src/dld/expression.js";
import { expressionToCircuit, simulateCombinational } from "../../src/dld/circuit.js";
import { expressionToMask } from "../../src/dld/truth_table.js";
import { context } from "../../src/dld/boolean.js";

test("expressionToCircuit: AND of two variables matches mask", () => {
  const expr = parseBoolExpr("AB");
  const c = expressionToCircuit("and2", expr);
  const vars = collectVariables(expr);
  const ctx = context(vars);
  const expectedMask = expressionToMask(expr, ctx);
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const assignment = {};
    for (let v = 0; v < vars.length; v++) {
      assignment[vars[v]] = (((i >> v) & 1) ? 1 : 0);
    }
    const out = simulateCombinational(c, assignment);
    const want = ((expectedMask >> BigInt(i)) & 1n) === 1n ? 1 : 0;
    assert.equal(out.F, want, "mismatch for " + JSON.stringify(assignment));
  }
});

test("expressionToCircuit: XOR matches mask", () => {
  const expr = parseBoolExpr("A?B");
  const c = expressionToCircuit("xor2", expr);
  const vars = collectVariables(expr);
  const ctx = context(vars);
  const expectedMask = expressionToMask(expr, ctx);
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const assignment = {};
    for (let v = 0; v < vars.length; v++) {
      assignment[vars[v]] = (((i >> v) & 1) ? 1 : 0);
    }
    const out = simulateCombinational(c, assignment);
    const want = ((expectedMask >> BigInt(i)) & 1n) === 1n ? 1 : 0;
    assert.equal(out.F, want);
  }
});

test("expressionToCircuit: NOT propagates", () => {
  const expr = parseBoolExpr("!A");
  const c = expressionToCircuit("not1", expr);
  for (let a = 0; a < 2; a++) {
    const out = simulateCombinational(c, { A: a });
    assert.equal(out.F, a === 0 ? 1 : 0);
  }
});

test("expressionToCircuit: deeper expression (A!B + !AB) matches mask", () => {
  const expr = parseBoolExpr("(A!B) + (!AB)");
  const c = expressionToCircuit("muxlike", expr);
  const vars = collectVariables(expr);
  const ctx = context(vars);
  const expectedMask = expressionToMask(expr, ctx);
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const assignment = {};
    for (let v = 0; v < vars.length; v++) {
      assignment[vars[v]] = (((i >> v) & 1) ? 1 : 0);
    }
    const out = simulateCombinational(c, assignment);
    const want = ((expectedMask >> BigInt(i)) & 1n) === 1n ? 1 : 0;
    assert.equal(out.F, want);
  }
});

test("expressionToCircuit: 3-input OR matches mask", () => {
  const expr = parseBoolExpr("A + B + C");
  const c = expressionToCircuit("or3", expr);
  const vars = collectVariables(expr);
  const ctx = context(vars);
  const expectedMask = expressionToMask(expr, ctx);
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const assignment = {};
    for (let v = 0; v < vars.length; v++) {
      assignment[vars[v]] = (((i >> v) & 1) ? 1 : 0);
    }
    const out = simulateCombinational(c, assignment);
    const want = ((expectedMask >> BigInt(i)) & 1n) === 1n ? 1 : 0;
    assert.equal(out.F, want);
  }
});

test("expressionToCircuit: missing input throws", () => {
  const expr = parseBoolExpr("AB");
  const c = expressionToCircuit("and2", expr);
  assert.throws(() => simulateCombinational(c, { A: 1 }));
});

test("expressionToCircuit: every variable has an INPUT gate", () => {
  const expr = parseBoolExpr("A + B + C");
  const c = expressionToCircuit("or3", expr);
  const inputGates = c.gates.filter((g) => g.kind === "INPUT");
  assert.equal(inputGates.length, 3);
  for (const inp of c.inputs) {
    const bound = inputGates.find((g) => (g.meta && g.meta.inputPinId) === inp.id);
    assert.ok(bound, "INPUT gate missing for " + inp.label);
  }
});
