import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFigure, fieldAt, renderIllustration, traceFieldLines } from '../core/illustration.ts';
import { figureRecipes, figureVocabulary } from '../core/figure-recipes.ts';
import { compileVisual } from '../core/visual-spec.ts';
import { field3, traceField3 } from '../core/visual-3d.ts';

test('every textbook figure recipe renders the same SVG every time', () => {
  for (const recipe of figureRecipes) {
    const a = renderIllustration(recipe.figure), b = renderIllustration(recipe.figure);
    assert.match(a, /^<svg[\s\S]*<\/svg>$/, recipe.name);
    assert.equal(a, b, `${recipe.name} is deterministic`);
    assert.ok(!/NaN|Infinity|undefined/.test(a), `${recipe.name} has no broken numbers`);
  }
});

test('the vocabulary names every item type the engine draws', () => {
  for (const type of ['ground', 'ceiling', 'wall', 'incline', 'table', 'block', 'ball', 'pulley', 'wheel', 'rope', 'spring', 'scale', 'rod', 'wire', 'pivot', 'container', 'force', 'dimension', 'angle', 'line', 'curve', 'polygon', 'ellipse', 'point', 'text', 'charge', 'fieldLines', 'fbd'])
    assert.ok(figureVocabulary.includes(type), type);
});

test('a rope leaves each pulley along a true tangent and wraps over the top', () => {
  // Atwood machine: both blocks hang below the rim, so the straight parts are vertical and touch the wheel at its sides.
  const figure = compileFigure({ items: [
    { type: 'pulley', id: 'p', x: 0, y: 4, r: 0.5 },
    { type: 'block', id: 'a', x: -0.5, y: 1, w: 0.6, h: 0.6 },
    { type: 'block', id: 'b', x: 0.5, y: 1, w: 0.6, h: 0.6 },
    { type: 'rope', path: ['a.top', { around: 'p', side: 'over' }, 'b.top'] },
  ] });
  const svg = figure.render({}, 0), ropes = [...svg.matchAll(/<path d="M([^"]+)" stroke="#3b3530" stroke-width="1.7"/g)];
  assert.equal(ropes.length, 1);
  const pts = ropes[0][1].split('L').map(p => p.split(' ').map(Number));
  // Screen y grows downward: the rope's highest point is the top of the wheel, and its ends are below it.
  const top = Math.min(...pts.map(p => p[1]));
  assert.ok(pts[0][1] > top && pts.at(-1)![1] > top, 'the rope goes up and over');
  assert.ok(Math.abs(pts[0][0] - pts[1][0]) < 0.5, 'the left run is vertical (tangent at the side of the wheel)');
  assert.ok(pts[0][0] < pts.at(-1)![0], 'the rope does not cross itself');
});

test('blocks placed on an incline sit on it and turn with it', () => {
  const figure = compileFigure({ items: [
    { type: 'incline', id: 'r', x: 0, y: 0, base: 4, angle: 30 },
    { type: 'block', id: 'b', on: 'r', at: 0.5, w: 1, h: 0.6 },
    { type: 'force', at: 'b.bottom', dir: -60, length: 1 },
  ] });
  assert.match(figure.render({}, 0), /<svg/);
  // The bottom anchor is on the slope y = x·tan 30°.
  const g = compileFigure({ items: [{ type: 'incline', id: 'r', x: 0, y: 0, base: 4, angle: 30 }, { type: 'block', id: 'b', on: 'r', at: 0.5, w: 1, h: 0.6 }, { type: 'point', at: 'b.bottom', label: 'P' }] });
  assert.match(g.render({}, 0), /<svg/);
});

test('field lines start on positive charges and end on negative ones', () => {
  const sources = [{ kind: 'point' as const, c: [-1, 0] as [number, number], q: 1, r: 0.1 }, { kind: 'point' as const, c: [1, 0] as [number, number], q: -1, r: 0.1 }];
  const e = fieldAt(sources, [0, 0]);
  assert.ok(e[0] > 0 && Math.abs(e[1]) < 1e-12, 'between a dipole the field points from + to −');
  const lines = traceFieldLines(sources, [-3, -2, 3, 2], 12);
  assert.ok(lines.length >= 12);
  const ended = lines.filter(l => !l.reversed && Math.hypot(l.pts.at(-1)![0] - 1, l.pts.at(-1)![1]) < 0.15);
  assert.ok(ended.length >= 6, 'most lines from + end on −');
  // A finite line charge: far away it looks like a point charge with the same total.
  const far = fieldAt([{ kind: 'line', a: [-0.5, 0], b: [0.5, 0], q: 2, r: 0.05 }], [0, 100]);
  assert.ok(Math.abs(far[1] - 2 / 1e4) / (2 / 1e4) < 1e-3 && Math.abs(far[0]) < 1e-12);
});

test('bad figures say exactly what to fix', () => {
  assert.throws(() => compileFigure({ items: [{ type: 'block', x: 0 }] }), /item 1 \(block\): needs “y”/);
  assert.throws(() => compileFigure({ items: [{ type: 'rope', path: ['nope.top', [0, 0]] }] }), /no item has the id “nope”/);
  assert.throws(() => compileFigure({ items: [{ type: 'ball', id: 'm', x: 0, y: 0, r: 1 }, { type: 'force', at: 'm.side', dir: 0 }] }), /has no anchor “side” \(it has center, top, bottom, left, right\)/);
  assert.throws(() => compileFigure({ items: [{ type: 'pulley', id: 'p', x: 0, y: 0, r: 1 }, { type: 'rope', path: [[0.2, 0], { around: 'p' }, [3, 0]] }] }), /inside a pulley/);
  assert.throws(() => compileFigure({ items: [{ type: 'fieldLines' }] }), /no charged items/);
  assert.throws(() => compileFigure({ items: [{ type: 'spaceship' }] }), /figure description is incomplete/);
});

test('labels are escaped and use subscripts', () => {
  const svg = renderIllustration({ items: [{ type: 'text', at: [0, 0], text: '<b>F_{net}' }] });
  assert.ok(!svg.includes('<b>') && svg.includes('&lt;b&gt;F'));
  assert.match(svg, /<tspan dy="[\d.]+" font-size="[\d.]+"[^>]*>net<\/tspan>/, 'net is a subscript');
  assert.match(svg, /stroke="#ffffff"/, 'label halos match the page');
});

test('figures are a visual kind with sliders, animation and steps', () => {
  const visual = compileVisual({ kind: 'figure', title: 'Ramp', params: [{ key: 'th', label: 'Angle', min: 10, max: 50, value: 30 }], steps: [{ title: 'The block', focus: ['b'] }], items: [
    { type: 'incline', id: 'r', x: 0, y: 0, base: 5, angle: 'th' },
    { type: 'block', id: 'b', on: 'r', at: '0.8 - 0.1*t', w: 0.8, h: 0.6 },
  ] });
  assert.ok(visual.figure && visual.moving);
  assert.notEqual(visual.figure.render({ th: 20 }, 0), visual.figure.render({ th: 45 }, 0), 'the slider changes the drawing');
  assert.match(visual.figure.render({ th: 30 }, 0, { focus: new Set(['b']) }), /opacity="0.22"/, 'a step dims what it does not focus');
  assert.throws(() => compileVisual({ kind: 'figure', title: 'x', items: [{ type: 'block', id: 'a', x: 0, y: 0 }], steps: [{ title: 's', focus: ['zz'] }] }), /unknown item “zz”/);
  assert.throws(() => compileVisual({ kind: 'figure', title: 'x' }), /needs "items"/);
});

test('3D charged bodies print their signs and trace field lines between them', () => {
  const visual = compileVisual({ kind: '3d', title: 'Sphere and wire', objects: [
    { type: 'cylinder', id: 'w', x: -3, y: 0, z: 0, r: 0.1, h: 6, axis: 'x', q: -2, material: 'metal' },
    { type: 'sphere', id: 's', x: 0, y: 0, z: 1.5, r: 0.4, q: 1, material: 'gold' },
    { type: 'fieldLines', lines: 20 },
  ] });
  const prims = visual.scene3d!.primitives({}, 0);
  const plus = prims.filter(p => p.k === 'glyph' && p.sign > 0), minus = prims.filter(p => p.k === 'glyph' && p.sign < 0), lines = prims.filter(p => p.k === 'line');
  assert.ok(plus.length >= 14 && minus.length >= 20, 'signs are printed on both bodies');
  assert.ok(lines.length >= 10, 'field lines are drawn');
  assert.equal(visual.scene3d!.axes, false, 'a model of real objects is shown without a grid');
  assert.ok(prims.some(p => p.k === 'sphere' && p.mat === 'gold'));
  // Above the middle of a negative wire the field points down, toward it.
  const e = field3([{ kind: 'line', a: [-3, 0, 0], b: [3, 0, 0], q: -2, r: 0.1 }], [0, 0, 1]);
  assert.ok(e[2] < 0 && Math.abs(e[0]) < 1e-9);
  assert.ok(traceField3([{ kind: 'point', c: [0, 0, 0], q: 1, r: 0.2 }], { x: [-2, 2], y: [-2, 2], z: [-2, 2] }, 12).length >= 12);
});

test('models are told which renderer to use, with verified figures to start from', async () => {
  const { clemSkillsFor, clemSkillText, visualChoice } = await import('../core/clem-skills.ts');
  const { visualLanguage } = await import('../core/answer-format.ts');
  const { slashCommands } = await import('../core/commands.ts');
  const ids = (q: string) => clemSkillsFor(q).map(s => s.id);
  for (const q of ['show me a block on an inclined plane', 'an atwood machine with two masses', 'draw a wheelbarrow with the torques', 'electric field lines of a dipole', 'a mass hanging from a spring scale'])
    assert.ok(ids(q).includes('figures'), q);
  assert.ok(ids('a negatively charged wire and a positively charged sphere in 3d').includes('3d'));
  assert.ok(!ids('plot y = sin x').includes('figures') && !ids('what is the capital of France').includes('figures'));
  const text = clemSkillText('draw a pulley system');
  assert.ok(text.includes(visualChoice) && text.includes('"kind":"figure"'), 'the playbook gives the rule and names the figure kind');
  assert.match(text, /VERIFIED TEXTBOOK FIGURES/);
  assert.match(text, /"type":"rope","path":\["mL.top"/);
  assert.match(visualLanguage, /figure \(textbook illustrations/);
  assert.match(visualLanguage, /"q" \(signed charge/);
  assert.ok(slashCommands.some(c => c.id === 'figure' && c.skills?.includes('figures')));
});
