import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileVisual, defaultValues, type Pen } from '../core/visual-spec.ts';
import { normalizeMath } from '../core/math-markdown.ts';
import { takeTitle, hideTitleMarker, chatPreview, plainText } from '../core/chat-title.ts';

class CountPen implements Pen {
  readonly w = 800; readonly h = 440; paths = 0; circles = 0; texts: string[] = []; bad = 0;
  path(points: [number, number][]) { this.paths++; if (points.some(p => !p.every(Number.isFinite))) this.bad++; }
  circle(x: number, y: number, r: number) { this.circles++; if (![x, y, r].every(Number.isFinite)) this.bad++; }
  text(x: number, y: number, value: string) { this.texts.push(value); if (![x, y].every(Number.isFinite)) this.bad++; }
}

test('a 3D surface compiles to a mesh and a finite projected drawing', () => {
  const v = compileVisual({ kind: '3d', title: 'Saddle', params: [{ key: 'a', label: 'a', min: 0.5, max: 2, value: 1 }], x: { min: -2, max: 2, label: 'x' }, y: { min: -2, max: 2 }, z: { min: -4, max: 4 },
    objects: [{ type: 'surface', expr: 'a*(x^2 - y^2)', label: 'z = x² − y²' }, { type: 'point', x: 1, y: 1, z: 'a*0' }, { type: 'vector', x: 1, y: 1, z: 0, dx: 1, dy: 0, dz: 2 }] });
  assert.ok(v.scene3d);
  const prims = v.scene3d!.primitives(defaultValues(v), 0);
  const mesh = prims.find(p => p.k === 'mesh');
  assert.ok(mesh && mesh.k === 'mesh' && mesh.rows === 49 && mesh.pos.every(Number.isFinite));
  assert.ok(prims.some(p => p.k === 'arrow') && prims.some(p => p.k === 'point'));
  const pen = new CountPen(); v.draw(pen, defaultValues(v), 0);
  assert.equal(pen.bad, 0); assert.ok(pen.paths > 20);
  assert.equal(v.moving, false);
});

test('curves, fields, shapes and animation work in 3D', () => {
  const v = compileVisual({ kind: '3d', title: 'Helix', animate: { duration: 4 }, objects: [
    { type: 'curve', x: 'cos(s)', y: 'sin(s)', z: 's/6', from: 0, to: '4*pi' },
    { type: 'sphere', x: 'cos(t)', y: 'sin(t)', z: 0, r: 0.2, id: 'ball' },
    { type: 'box', x: 0, y: 0, z: -1, w: 2, d: 2, h: 0.2 }, { type: 'cone', x: 0, y: 0, z: 0, r: 0.5, h: 1 },
    { type: 'polygon', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, { type: 'text', x: 0, y: 0, z: 2, text: 'top' },
  ], steps: [{ title: 'The ball', focus: ['ball'] }] });
  assert.equal(v.moving, true);
  const b = v.scene3d!.bounds({}, 0);
  assert.ok(b.z[1] > 2 && b.x[0] < -1, 'open axes are measured from the scene');
  const focused = v.scene3d!.primitives({}, 1, 0);
  assert.ok(focused.find(p => p.k === 'sphere')!.dim === 1 && focused.find(p => p.k === 'box')!.dim < 1);
  const field = compileVisual({ kind: '3d', title: 'Field', x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 }, objects: [{ type: 'field', dx: '-y', dy: 'x', dz: '0.2', density: 3 }] });
  assert.equal(field.scene3d!.primitives({}, 0).filter(p => p.k === 'arrow').length, 27);
  assert.throws(() => compileVisual({ kind: '3d', title: 'x', objects: [{ type: 'surface', expr: 'x' }] }), /x and y ranges/);
  assert.throws(() => compileVisual({ kind: '3d', title: 'x', objects: [] }), /at least one object/);
  assert.throws(() => compileVisual({ kind: '3d', title: 'x', objects: [{ type: 'point', x: 'fetch(1)', y: 0, z: 0 }] }), /formula in the visual/);
});

test('molecules bond themselves and hide axes', () => {
  const water = compileVisual({ kind: '3d', title: 'Water', objects: [{ type: 'molecule', labels: true, atoms: [{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.757, y: 0.586, z: 0 }, { el: 'H', x: -0.757, y: 0.586, z: 0 }] }] });
  const prims = water.scene3d!.primitives({}, 0);
  assert.equal(prims.filter(p => p.k === 'cyl').length, 2, 'two O–H bonds, no H–H bond');
  assert.equal(prims.filter(p => p.k === 'sphere').length, 3);
  assert.equal(water.scene3d!.axes, false); assert.equal(water.scene3d!.equal, true);
  const co2 = compileVisual({ kind: '3d', title: 'CO2', objects: [{ type: 'molecule', atoms: [{ el: 'O', x: -1.16, y: 0, z: 0 }, { el: 'C', x: 0, y: 0, z: 0 }, { el: 'O', x: 1.16, y: 0, z: 0 }], bonds: [[0, 1, 2], [1, 2, 2]] }] });
  assert.equal(co2.scene3d!.primitives({}, 0).filter(p => p.k === 'cyl').length, 4, 'double bonds draw two sticks');
});

test('new 2D layers and charts draw without invalid points', () => {
  const plot = compileVisual({ kind: 'plot', title: 'Fields', x: { min: -3, max: 3 }, y: { min: -3, max: 3 }, equal: true, layers: [
    { type: 'field', dx: 'y', dy: '-x' }, { type: 'implicit', expr: 'x^2 + y^2', levels: [1, 4] }, { type: 'implicit', expr: '1/x - y' },
    { type: 'polar', r: '1 + cos(theta)' }, { type: 'points', points: [[0, 0], [1, 2], ['a', 1]], line: true },
  ], params: [{ key: 'a', label: 'a', min: 0, max: 2, value: 1 }] });
  const pen = new CountPen(); plot.draw(pen, defaultValues(plot), 0);
  assert.equal(pen.bad, 0); assert.ok(pen.paths > 200);
  for (const type of ['pie', 'area'] as const) {
    const chart = compileVisual({ kind: 'chart', title: 'Share', chart: { type, labels: ['A', 'B', 'C'], series: [{ name: 'Cells', values: [3, 5, 2] }] } });
    const p2 = new CountPen(); chart.draw(p2, {}, 1); assert.equal(p2.bad, 0); assert.ok(p2.paths > 2, type);
  }
});

test('every maths dialect becomes remark-math dollars, prices and code stay as written', () => {
  const out = normalizeMath('Hold $y = 1$ and move along $x$: $\\pdv{z}{x}$. Costs $5 and $10. `$x$` \\(a\\) \\[b\\]');
  assert.match(out, /\$\$x\$\$: /); assert.match(out, /\$\$y = 1\$\$/); assert.match(out, /Costs \$5 and \$10\./);
  assert.match(out, /`\$x\$`/); assert.match(out, /\$\$a\$\$/); assert.match(out, /\n\$\$\nb\n\$\$\n/);
  assert.match(normalizeMath('\\begin{align}\na &= b\n\\end{align}'), /^\n\$\$\n\\begin\{align\}/);
});

test('chats get a one-line summary from a hidden marker, with a readable fallback', () => {
  const reply = takeTitle('Answer.\n\n<!--title: Partial Derivatives-->\n<!--summary: Why $\\partial z/\\partial x$ is a slope along x, with an example at (1, 1).-->');
  assert.equal(reply.content, 'Answer.'); assert.equal(reply.title, 'Partial Derivatives');
  assert.equal(reply.summary, 'Why ∂z/∂x is a slope along x, with an example at (1, 1).');
  for (const tail of ['<!--sum', '<!--summary: Why part']) assert.equal(hideTitleMarker('Answer.\n' + tail), 'Answer.');
  assert.equal(chatPreview({ summary: 'S', messages: [] }), 'S');
  assert.equal(chatPreview({ messages: [{ role: 'user', content: 'What is **$\\frac{a}{b}$**?' }, { role: 'assistant', content: 'Long answer' }, { role: 'user', content: 'And [links](http://x)?' }] as never }), 'What is a/b? · then And links?');
  assert.equal(plainText('## Title\n- item `code`'), 'Title item code');
});
