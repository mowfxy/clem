import assert from "node:assert/strict";
import { compose } from "../../src/toolkit/index.js";
import type { ComposeModel, ComposeResult, ElementSpec, ToolkitIssue } from "../../src/toolkit/index.js";

/** A roomy canvas: 1 world unit = 50 px, world [-6, 6] x [-4, 4]. */
export function model(elements: ElementSpec[], extra: Partial<ComposeModel> = {}): ComposeModel {
  return { canvas: { width: 600, height: 400, world: { xMin: -6, xMax: 6, yMin: -4, yMax: 4 } }, elements, ...extra };
}

export function ok(m: ComposeModel): Extract<ComposeResult, { ok: true }> {
  const r = compose(m);
  if (!r.ok) assert.fail(`expected success, got ${JSON.stringify(r.errors, null, 2)}`);
  return r;
}

export function err(m: ComposeModel, code: string): ToolkitIssue {
  const r = compose(m);
  if (r.ok) assert.fail(`expected ${code}, but compose succeeded`);
  const hit = r.errors.find(e => e.code === code);
  if (!hit) assert.fail(`expected ${code}, got ${r.errors.map(e => `${e.code}: ${e.message}`).join("; ")}`);
  assert.ok(hit.message.length > 0);
  return hit;
}

export function origin(r: Extract<ComposeResult, { ok: true }>, id: string) {
  return r.report.elements.find(e => e.id === id)!.origin;
}

export function close(a: number, b: number, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
}
