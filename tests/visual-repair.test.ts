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

test('shapes a model often writes are rewritten into the schema rather than refused', () => {
  const molecule = compileVisual({ kind: '3d', title: 'Water', objects: [{ type: 'molecule', atoms: [{ el: 'O', pos: [0, 0, 0] }, { element: 'h', x: '0.757', y: 0.586 }, ['H', -0.757, 0.586, 0]] }] });
  const atoms = (molecule.spec.objects![0] as { atoms: { el: string; x: number; z: number }[] }).atoms;
  assert.deepEqual(atoms.map(a => a.el), ['O', 'H', 'H']);
  assert.equal(atoms[1].x, 0.757);
  assert.equal(atoms[1].z, 0);
  const flow = compileVisual({ type: 'flowchart', title: 'Flow', nodes: ['Start', { name: 'Stop' }], edges: [['Start', 'Stop', 'go'], { source: 'Stop', target: 'Start' }] });
  assert.equal(flow.spec.kind, 'diagram');
  assert.deepEqual(flow.spec.edges!.map(e => [e.from, e.to]), [['Start', 'Stop'], ['Stop', 'Start']]);
  const chart = compileVisual({ kind: 'bar', title: 'Sales', labels: ['Q1', 'Q2'], series: [{ label: 'EU', data: [3, 4] }] });
  assert.equal(chart.spec.chart!.series[0].name, 'EU');
});

test('an entry of a list missing a required field is dropped and the rest still drawn', () => {
  const v = compileVisual({ kind: '3d', title: 'Ammonia', objects: [{ type: 'molecule', atoms: [{ el: 'N', x: 0, y: 0, z: 0 }, { el: 'H' }, { el: 'H', x: 0.94, y: 0, z: -0.38 }], bonds: [[0, 2]] }] });
  const m = v.spec.objects![0] as { atoms: unknown[]; bonds?: unknown };
  assert.equal(m.atoms.length, 2);
  assert.equal(m.bonds, undefined, 'numbered bonds are dropped once an atom is, and bonding goes by distance');
});
