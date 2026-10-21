import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDiagram } from '../core/visual-spec.ts';

type Rect = [number, number, number, number];
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
/** Node-on-node and label-on-node or label-on-label overlaps, in square pixels. */
function clashes(nodes: { id: string; label: string }[], edges: { from: string; to: string; label?: string }[], direction: 'right' | 'down' = 'right') {
  const { boxes, routes } = layoutDiagram(nodes as never, edges as never, direction);
  const rects = [...boxes.values()].map(b => { const hw = b.shape === 'circle' ? b.r : b.w / 2, hh = b.shape === 'circle' ? b.r : b.h / 2; return [b.x - hw, b.y - hh, b.x + hw, b.y + hh] as Rect; });
  let total = 0;
  rects.forEach((a, i) => rects.slice(i + 1).forEach(b => (total += overlap(a, b))));
  const labels: Rect[] = [];
  edges.forEach((e, i) => {
    if (!e.label) return;
    const [x, y] = routes[i].labelAt ?? routes[i].at(0.5), w = e.label.length * 11 * 0.56 + 14, r: Rect = [x - w / 2, y - 10, x + w / 2, y + 10];
    for (const n of rects) total += overlap(r, n);
    for (const l of labels) total += overlap(r, l);
    labels.push(r);
  });
  return total;
}

test('a labelled chain wraps so its labels sit clear of the nodes', () => {
  const nodes = [1, 2, 3, 4, 0].map(i => ({ id: 'c' + i, label: `Chair [${i}] = ${i * 10} front` }));
  const edges = [{ from: 'c1', to: 'c2' }, { from: 'c2', to: 'c3' }, { from: 'c3', to: 'c4' }, { from: 'c4', to: 'c0', label: 'loops back' }];
  assert.equal(clashes(nodes, edges), 0);
});

test('a layer with more siblings than fit side by side never stacks nodes on each other', () => {
  for (const n of [8, 12, 16]) {
    const nodes = [{ id: 's', label: 'Source' }, ...Array.from({ length: n }, (_, i) => ({ id: 'w' + i, label: 'Worker number ' + i })), { id: 't', label: 'Sink' }];
    const edges = [...nodes.slice(1, -1).map(w => ({ from: 's', to: w.id, label: 'task' })), ...nodes.slice(1, -1).map(w => ({ from: w.id, to: 't' }))];
    assert.equal(clashes(nodes, edges, 'right'), 0, `${n} workers across`);
    assert.equal(clashes(nodes, edges, 'down'), 0, `${n} workers down`);
  }
});
