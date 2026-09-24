import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, safeEval } from '../core/expr.ts';
import { compileVisual, defaultValues, parseVisual, type Pen } from '../core/visual-spec.ts';
import { runChecks, parseChecks } from '../core/checks.ts';
import { review, interval, examPace, isDue } from '../core/srs.ts';
import { linkCitations, readCitation, matchSource } from '../core/citations.ts';
import { lineDiff, diffStats, applyEdit, hunks } from '../core/diff.ts';

class CountPen implements Pen {
  readonly w = 800; readonly h = 440; paths = 0; circles = 0; texts: string[] = []; bad = 0;
  path(points: [number, number][]) { this.paths++; if (points.some(p => !p.every(Number.isFinite))) this.bad++; }
  circle(x: number, y: number, r: number) { this.circles++; if (![x, y, r].every(Number.isFinite)) this.bad++; }
  text(x: number, y: number, value: string) { this.texts.push(value); if (![x, y].every(Number.isFinite)) this.bad++; }
}

test('expressions follow arithmetic precedence and never evaluate code', () => {
  assert.equal(compile('2 + 3 * 4 ^ 2')({}), 50);
  assert.equal(compile('-2^2')({}), -4);
  assert.equal(compile('2x + 1', ['x'])({ x: 3 }), 7);
  assert.equal(compile('x > 1 ? 10 : 20', ['x'])({ x: 2 }), 10);
  assert.ok(Math.abs(compile('sin(pi/2) + ln(e)')({}) - 2) < 1e-12);
  assert.equal(compile('mod(-1, 3)')({}), 2);
  assert.throws(() => compile('constructor.constructor("return 1")()'), /Unknown|Unexpected/);
  assert.throws(() => compile('window', ['x']), /Unknown name/);
  assert.throws(() => compile('alert(1)'), /Unknown function/);
  assert.throws(() => compile('x; y', ['x', 'y']), /Unexpected/);
  assert.ok(Number.isNaN(safeEval(compile('1/0 - 1/0'), {})));
  assert.equal(compile('e', ['e'])({ e: 0.5 }), 0.5, 'a slider may shadow a constant');
});

test('model-authored plots compile, animate and draw finite geometry', () => {
  const v = compileVisual({ kind: 'plot', title: 'Travelling wave', params: [{ key: 'A', label: 'Amplitude', min: 0, max: 2, value: 1 }, { key: 'k', label: 'Wave number', min: 0.5, max: 4, value: 1 }], x: { min: 0, max: 10 }, y: { min: -2, max: 2 }, layers: [{ type: 'function', expr: 'A*sin(k*x - 2*t)', label: 'y' }, { type: 'point', x: 't', y: 0 }, { type: 'vector', x: 0, y: 0, dx: 1, dy: 'A' }, { type: 'area', expr: 'A*sin(x)', from: 0, to: 'pi' }], readouts: [{ label: 'Wavelength', expr: '2*pi/k', unit: 'm' }] });
  assert.equal(v.moving, true);
  assert.equal(v.period, Infinity);
  const pen = new CountPen();
  v.draw(pen, defaultValues(v), 1.2);
  assert.equal(pen.bad, 0);
  assert.ok(pen.paths > 10);
  assert.deepEqual(v.readouts(defaultValues(v), 0), [['Wavelength', '6.28 m']]);
});

test('diagrams auto-layout, survive cycles and validate step focus', () => {
  const v = compileVisual({ kind: 'diagram', title: 'Water cycle', nodes: [{ id: 'sea', label: 'Ocean' }, { id: 'cloud', label: 'Clouds' }, { id: 'rain', label: 'Rain', shape: 'pill' }, { id: 'river', label: 'Rivers', shape: 'circle' }], edges: [{ from: 'sea', to: 'cloud', label: 'evaporation', flow: true }, { from: 'cloud', to: 'rain' }, { from: 'rain', to: 'river' }, { from: 'river', to: 'sea' }], steps: [{ title: 'Evaporation', focus: ['sea', 'cloud'] }] });
  assert.equal(v.moving, true);
  const pen = new CountPen();
  v.draw(pen, {}, 0.4, 0);
  assert.equal(pen.bad, 0);
  assert.ok(pen.texts.includes('Ocean') && pen.texts.includes('evaporation'));
  assert.throws(() => compileVisual({ kind: 'diagram', title: 'x', nodes: [{ id: 'a', label: 'A' }], steps: [{ title: 's', focus: ['zzz'] }] }), /unknown node/);
  assert.throws(() => compileVisual({ kind: 'diagram', title: 'x', nodes: [] }), /at least one node/);
});

test('charts accept slider-driven values and reject malformed specs', () => {
  const v = compileVisual({ kind: 'chart', title: 'Savings', params: [{ key: 'r', label: 'Rate', min: 0, max: 10, value: 5, unit: '%' }], chart: { type: 'bar', labels: ['Y1', 'Y2', 'Y3'], series: [{ name: 'Balance', values: [100, '100*(1+r/100)', '100*(1+r/100)^2'] }] } });
  assert.equal(v.moving, false);
  const pen = new CountPen();
  v.draw(pen, defaultValues(v), 1);
  assert.equal(pen.bad, 0);
  assert.ok(pen.texts.includes('110'));
  assert.throws(() => parseVisual('{"kind":"plot"'), /not valid JSON/);
  assert.throws(() => compileVisual({ kind: 'plot', title: 'x', x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, layers: [{ type: 'function', expr: 'process.exit()' }] }), /formula in the visual/);
  assert.throws(() => compileVisual({ kind: 'plot', title: 'x' }), /x and y ranges/);
});

test('checked numbers recompute formulas and flag differences', () => {
  const [ok, wrong, broken] = runChecks({ checks: [
    { label: 'Range', expr: 'v^2*sin(2*theta)/g', vars: { v: 20, theta: 0.5236, g: 9.81 }, claimed: 35.31, unit: 'm' },
    { label: 'Efficiency', expr: '1 - Tc/Th', vars: { Tc: 300, Th: 600 }, claimed: 0.55 },
    { label: 'Bad', expr: 'sqrt(-1)', claimed: 1 },
  ] });
  assert.equal(ok.status, 'ok');
  assert.equal(wrong.status, 'differs');
  assert.equal(wrong.computed, 0.5);
  assert.equal(broken.status, 'error');
  assert.equal(parseChecks('[{"label":"x","expr":"2*3","claimed":6}]')[0].status, 'ok');
  assert.equal(runChecks([{ label: 'unknown', expr: 'a+b', vars: { a: 1 }, claimed: 1 }])[0].status, 'error');
});

test('FSRS schedules longer gaps after successful reviews and resets lapses', () => {
  const day = 86_400_000, t0 = Date.UTC(2026, 0, 1);
  const first = review(undefined, 3, t0);
  assert.equal(first.reps, 1);
  assert.ok(first.due - t0 >= 3 * day);
  const second = review(first, 3, first.due);
  assert.ok(second.stability > first.stability);
  assert.ok(second.due - first.due > first.due - t0, 'interval grows');
  const lapse = review(second, 1, second.due);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.stability < second.stability);
  assert.ok(lapse.due - second.due < day);
  assert.equal(interval(10), 10, 'at 90% retention the interval equals stability');
  assert.ok(isDue(undefined) && !isDue(second, first.due));
  const pace = examPace([undefined, undefined, undefined, first], '2026-01-04', t0);
  assert.equal(pace.unseen, 3);
  assert.equal(pace.days, 4);
  assert.equal(pace.perDay, 1);
});

test('citations link outside code and resolve to stored files', () => {
  const md = linkCitations('Entropy rises [[Lecture 4 notes.pdf, p. 12]] and [[data.csv]].\n```\n[[not a citation]]\n```');
  assert.match(md, /\[Lecture 4 notes\.pdf · p\. 12\]\(source:Lecture%204%20notes\.pdf#p=12\)/);
  assert.match(md, /\(source:data\.csv\)/);
  assert.match(md, /\[\[not a citation\]\]/);
  assert.deepEqual(readCitation('source:Lecture%204%20notes.pdf#p=12'), { name: 'Lecture 4 notes.pdf', page: 12 });
  assert.equal(readCitation('https://example.com'), null);
  assert.equal(matchSource([{ name: 'Lecture 4 Notes.PDF' }], 'lecture 4 notes.pdf')?.name, 'Lecture 4 Notes.PDF');
});

test('file changes diff by line and require a unique match', () => {
  const lines = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
  assert.ok(hunks(lines, 0).some(h => h.kind === 'gap'));
  assert.equal(applyEdit('x = 1\ny = 2', { find: 'y = 2', replace: 'y = 3' }), 'x = 1\ny = 3');
  assert.throws(() => applyEdit('a a', { find: 'a', replace: 'b' }), /more than once/);
  assert.throws(() => applyEdit('abc', { find: 'zzz', replace: 'b' }), /no longer/);
  assert.equal(applyEdit('old', { content: 'new' }), 'new');
});
