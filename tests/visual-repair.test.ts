import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual } from '../core/visual-spec.ts';

test('a diagram with shapes and text outside the schema is mended, not refused', () => {
  const v = compileVisual({ kind: 'diagram', title: 'Flow', direction: 'vertical',
    nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Check', shape: 'diamond' }, { id: 'c', label: 'Store', shape: 'Rectangle' }, { id: 'd', label: 'x'.repeat(90), shape: 'oval' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'missing' }], steps: [{ title: 'One', focus: ['a', 'nowhere'] }] });
  assert.equal(v.spec.nodes![1].shape, undefined);
  assert.equal(v.spec.nodes![2].shape, 'box');
  assert.equal(v.spec.nodes![3].shape, 'circle');
  assert.ok(v.spec.nodes![3].label.length <= 60);
  assert.equal(v.spec.direction, 'down');
  assert.deepEqual(v.spec.steps![0].focus, ['a']);
});

test('a visual missing what it needs is still refused with a reason', () => {
  assert.throws(() => compileVisual({ kind: 'diagram', nodes: [] }), /title/);
  assert.throws(() => compileVisual({ kind: 'blob', title: 'x' }), /kind/);
});

test('the original description is left untouched', () => {
  const raw = { kind: 'diagram', title: 'T', nodes: [{ id: 'a', label: 'A', shape: 'hexagon' }] };
  compileVisual(raw);
  assert.equal(raw.nodes[0].shape, 'hexagon');
});
