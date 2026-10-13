import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedKind } from '../desktop/pdf-document.ts';
import { voiceProblems } from '../core/document-standard.ts';
import { compileVisual, defaultValues, type Pen } from '../core/visual-spec.ts';
import { recipesFor } from '../desktop/kinetra-recipes.ts';

test('a technical report prints only when the person asks for a report or paper', () => {
  assert.equal(askedKind('report', 'create a pdf or two explaining lectures 1-2 and worksheet 1'), 'notes');
  assert.equal(askedKind('paper', 'a study guide from the past papers'), 'notes');
  assert.equal(askedKind('report', 'a cheat sheet for the midterm'), 'handout');
  assert.equal(askedKind(undefined, 'make me a pdf of these notes'), 'notes');
  assert.equal(askedKind('report', 'write a report on climate policy'), 'report');
  assert.equal(askedKind('paper', 'format it like a research paper'), 'paper');
  assert.equal(askedKind('worksheet', 'questions for worksheet 1'), 'worksheet');
});

test('text standing in for a figure is refused, ordinary sentences are not', () => {
  const flagged = (text: string) => voiceProblems([{ where: 'S', text }], 'notes').some((p) => p.includes('instead of drawn'));
  for (const text of ['The pictures for questions 9 and 10 are described in words rather than redrawn.', 'The contour sketches are not reproduced here.', '[Insert diagram of level curves]', 'See the worksheet for the graphs of each function.'])
    assert.ok(flagged(text), text);
  for (const text of ['Each term is explained in words before the formula is given.', 'Rather than drawing every path, two paths suffice.', 'Figure 3 shows the level curves.'])
    assert.ok(!flagged(text), text);
});

test('multivariable maths requests get the graph recipes', () => {
  const names = recipesFor('Lecture 1: domains, level curves and contour maps of functions of two variables').recipes.map((r) => r.name);
  for (const name of ['domain in the plane', 'contour map / level curves', 'surface z = f(x, y)', 'limit along paths']) assert.ok(names.includes(name), name);
  assert.ok(!recipesFor('The causes of the French Revolution').recipes.some((r) => r.name === 'contour map / level curves'));
});

test('plot labels sit clear of every curve and of each other', () => {
  const visual = compileVisual({ kind: 'plot', title: 'Contours', x: { min: -3, max: 3 }, y: { min: -3, max: 3 }, equal: true, layers: [{ type: 'implicit', expr: 'x^2 - y^2', levels: [-4, -1, 0, 1, 4], label: 'k' }, { type: 'implicit', expr: 'x-1', dash: true, label: 'x = 1 excluded' }] });
  const strokes: [number, number][][] = [], labels: { x: number; y: number; w: number; align?: string; text: string }[] = [];
  const pen: Pen = { w: 800, h: 440, path: (pts, s) => { if (s.stroke) strokes.push(pts); }, circle: () => {}, text: (x, y, text, s) => { if (s?.size === 12) labels.push({ x, y, w: text.length * 12 * 0.56, align: s.align, text }); } };
  visual.draw(pen, defaultValues(visual), 0);
  const boxes = labels.map((l) => { const left = l.align === 'end' ? l.x - l.w : l.align === 'middle' ? l.x - l.w / 2 : l.x; return { ...l, box: [left, l.y - 12, left + l.w, l.y + 4] }; });
  assert.equal(boxes.filter((b) => b.text.startsWith('k = ')).length, 5);
  for (const { box, text } of boxes) {
    const hit = strokes.some((pts) => pts.some(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]));
    assert.ok(!hit, `${text} sits on a curve`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].box, c = boxes[j].box;
    assert.ok(!(Math.min(a[2], c[2]) > Math.max(a[0], c[0]) && Math.min(a[3], c[3]) > Math.max(a[1], c[1])), `${boxes[i].text} overlaps ${boxes[j].text}`);
  }
});

test('chemistry superscripts and subscripts stay maths and never swallow the next sentence', async () => {
  const { normalizeMath } = await import('../core/math-markdown.ts');
  assert.equal(normalizeMath('stop for lack of NAD$^+$. Fermentation regenerates NAD$^+$. Done.'), 'stop for lack of NAD$$^+$$. Fermentation regenerates NAD$$^+$$. Done.');
  assert.equal(normalizeMath('Water is H$_2$O.'), 'Water is H$$_2$$O.');
  assert.equal(normalizeMath('Prices $2 and $5 stay.'), 'Prices $2 and $5 stay.');
});

test('running heads are one short line', async () => {
  const { runningTitle } = await import('../desktop/pdf-document.ts');
  assert.equal(runningTitle('Math 301 Lecture 1: Functions of Several Variables, with Worksheet 1 Questions 9 and 10'), 'Math 301 Lecture 1: Functions of Several Variables');
  assert.ok(runningTitle('A very long title that has no natural break anywhere in it at all so it must be cut').length <= 58);
  assert.equal(runningTitle('Short title'), 'Short title');
});

test('a long chain of steps is set in rows that fit the page', async () => {
  const { flowchart } = await import('../desktop/kinetra-diagrams.ts');
  const nodes = Array.from({ length: 9 }, (_, i) => ({ id: 'n' + i, label: 'Step ' + (i + 1) }));
  const svg = flowchart({ direction: 'right', nodes, edges: nodes.slice(1).map((n, i) => ({ from: 'n' + i, to: n.id })) });
  const [w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
  assert.ok(w < 1000, `width ${w}`);
  assert.ok(h < w, `height ${h} should stay under width ${w}`);
});
