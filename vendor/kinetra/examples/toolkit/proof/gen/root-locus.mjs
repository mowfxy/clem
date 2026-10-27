// Computes the locus branches used by 23-root-locus.json and rewrites that model.
// Open loop G(s)H(s) = K / (s (s + 2) (s + 4)); closed-loop poles are the roots of
// s^3 + 6 s^2 + 8 s + K = 0 for K >= 0 (Durand-Kerner), tracked into three
// continuous branches by nearest-neighbour matching.
// Run: node examples/toolkit/proof/gen/root-locus.mjs
import fs from 'node:fs';

const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const poly = (s, K) => { const s2 = mul(s, s), s3 = mul(s2, s); return [s3[0] + 6 * s2[0] + 8 * s[0] + K, s3[1] + 6 * s2[1] + 8 * s[1]]; };
function roots(K, guess) {
  let r = guess.map(g => [...g]);
  for (let it = 0; it < 500; it++) {
    r = r.map((ri, i) => { let den = [1, 0]; r.forEach((rj, j) => { if (j !== i) den = mul(den, sub(ri, rj)); }); return sub(ri, div(poly(ri, K), den)); });
  }
  return r;
}
const Ks = [];
for (let k = 0; k <= 120; k++) Ks.push(3.0792 * (k / 120) ** 0.5);      // dense up to the breakaway gain
for (let k = 1; k <= 160; k++) Ks.push(3.0792 + (200 - 3.0792) * (k / 160) ** 2);
let prev = [[0, 0], [-2, 0], [-4, 0]];
const branches = [[], [], []];
for (const K of Ks) {
  const r = roots(K, K === 0 ? [[0.01, 0.01], [-2.01, -0.01], [-3.99, 0.02]] : prev.map(p => [p[0] + 1e-3, p[1] + 1e-3]));
  // Match each branch to the nearest new root.
  const used = new Set(), next = [];
  for (const p of prev) { let best = -1, bd = Infinity; r.forEach((q, j) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (!used.has(j) && d < bd) { bd = d; best = j; } }); used.add(best); next.push(r[best]); }
  prev = next;
  next.forEach((q, b) => branches[b].push([q[0], Math.abs(q[1]) < 1e-9 ? 0 : q[1]]));
}
const r4 = n => Math.round(n * 1e4) / 1e4;
const inView = ([x, y]) => x >= -7.2 && x <= 2.2 && Math.abs(y) <= 5.2;
const toData = br => br.filter(inView).map(([x, y]) => [r4(x), r4(y)]);
const up = toData(branches[0].map(([x, y]) => [x, Math.abs(y)]));      // from s = 0, upper half after breakaway
const dn = toData(branches[1].map(([x, y]) => [x, -Math.abs(y)]));     // from s = -2, lower half after breakaway
const left = toData(branches[2]);                                        // from s = -4 to -infinity
const dedupe = d => d.filter((p, k) => k === 0 || p[0] !== d[k - 1][0] || p[1] !== d[k - 1][1]);

// Guide lines are declared before the series, so list them in front of the branches they cross.
const model = {
  version: 1,
  title: 'Root locus of K / (s(s + 2)(s + 4)) with unity feedback',
  caption: 'Asymptotes at ±60° and 180° from σ = −2; breakaway at s = −0.845; crosses the jω axis at ±j2.83 when K = 48',
  canvas: { width: 760, height: 640, world: { xMin: -1.4, xMax: 10.8, yMin: -1.4, yMax: 9.2 } },
  vars: { sb: '-2 + 2/sqrt(3)', wc: 'sqrt(8)', Kc: 'wc*sqrt(wc^2 + 4)*sqrt(wc^2 + 16)', sigma: '(0 + (-2) + (-4))/3' },
  elements: [
    { id: 'ax', type: 'axes', at: { x: 0, y: 0 }, w: 9.4, h: 8.0, frame: 'box',
      x: { min: -7, max: 2.4, ticks: [-6, -4, -2, 0, 2], label: 'σ' }, y: { min: -4, max: 4, ticks: [-4, -2, 0, 2, 4], label: 'jω' } },
    { id: 're', type: 'guideLine', axes: 'ax', y: 0, dashed: false, color: 'axis', mayTouch: ['asU', 'asD', 'b1', 'b2', 'b3', 'p0', 'p2', 'p4', 'brk', 'cen'] },
    { id: 'im', type: 'guideLine', axes: 'ax', x: 0, dashed: false, color: 'axis', mayTouch: ['re', 'asU', 'asD', 'b1', 'b2', 'p0', 'cu', 'cd'] },
    { id: 'asU', type: 'series', axes: 'ax', fn: 'tan(60 deg)*(x - sigma)', domain: [-2, 0.3], color: 'guide', dashed: true, width: 1 },
    { id: 'asD', type: 'series', axes: 'ax', fn: '-tan(60 deg)*(x - sigma)', domain: [-2, 0.3], color: 'guide', dashed: true, width: 1, mayTouch: ['asU'] },
    { id: 'b1', type: 'series', axes: 'ax', data: dedupe(up), style: 'line', color: 'rayAlt', mayTouch: ['asU', 'asD'] },
    { id: 'b2', type: 'series', axes: 'ax', data: dedupe(dn), style: 'line', color: 'rayAlt', mayTouch: ['asU', 'asD', 'b1'] },
    { id: 'b3', type: 'series', axes: 'ax', data: dedupe(left), style: 'line', color: 'rayAlt', mayTouch: ['b2'] },
    { id: 'p0', type: 'plotPoint', axes: 'ax', x: 0, y: 0, marker: 'x', mayTouch: ['b1', 'b2', 'asU', 'asD'] },
    { id: 'p2', type: 'plotPoint', axes: 'ax', x: -2, y: 0, marker: 'x', mayTouch: ['b1', 'b2', 'asU', 'asD'] },
    { id: 'p4', type: 'plotPoint', axes: 'ax', x: -4, y: 0, marker: 'x', mayTouch: ['b3'] },
    { id: 'brk', type: 'plotPoint', axes: 'ax', x: 'sb', y: 0, marker: 'circle', mayTouch: ['b1', 'b2'] },
    { id: 'brkL', type: 'leader', target: 'brk', text: 'breakaway s = −0.845', dx: -1.6, dy: -1.4, marker: 'none', mayTouch: ['b1', 'b2', 're', 'asD'] },
    { id: 'cu', type: 'plotPoint', axes: 'ax', x: 0, y: 'wc', marker: 'circle', mayTouch: ['b1', 'asU'], label: 'K = 48, s = j2.83' },
    { id: 'cd', type: 'plotPoint', axes: 'ax', x: 0, y: '-wc', marker: 'circle', mayTouch: ['b2', 'asD'] },
    { id: 'cen', type: 'plotPoint', axes: 'ax', x: 'sigma', y: 0, marker: 'cross', mayTouch: ['asU', 'asD', 'b1', 'b2', 'p2'] },
  ],
  checks: [
    { id: 'breakaway_dK_ds_zero', type: 'equal', left: '3*sb^2 + 12*sb + 8', right: 0, tol: 1e-12 },
    { id: 'breakaway_between_poles', type: 'less', left: 'sb', right: 0 },
    { id: 'crossing_magnitude_condition', type: 'equal', left: 'Kc', right: 48, tol: 1e-9 },
    { id: 'crossing_routh', type: 'equal', left: '6*8', right: 'Kc', tol: 1e-9 },
    { id: 'crossing_angle_condition', type: 'equal', left: 'atan2(wc, 0) + atan2(wc, 2) + atan2(wc, 4)', right: '180 deg', tol: '1e-9 deg' },
    { id: 'centroid', type: 'equal', left: 'cen.dataX', right: -2, tol: 1e-12 },
  ],
};
const json = JSON.stringify(model, null, 2).replace(/\[\s+([-\d.e]+),\s+([-\d.e]+)\s+\]/g, '[$1, $2]').replace(/(\[[-\d.e]+, [-\d.e]+\]),\s+(?=\[[-\d.e]+, [-\d.e]+\])/g, '$1, ');
fs.writeFileSync(new URL('../23-root-locus.json', import.meta.url), json + '\n');
console.log(`wrote 23-root-locus.json (${up.length}/${dn.length}/${left.length} points)`);
