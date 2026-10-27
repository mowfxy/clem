// Computes the streamlines and equipotentials used by 15-dipole-field-lines.json.
// Field of +q at (-a, 0) and -q at (+a, 0) (k q = 1, a = 1 world unit):
//   field lines: RK4 along E/|E| from the + charge rim at launch angle alpha until
//   they reach the - charge rim; equipotentials: V(x, y) = 1/r+ - 1/r- = V0 found by
//   bisection along rays from each charge.
// Run: node examples/toolkit/proof/gen/dipole-lines.mjs  (rewrites ../15-dipole-field-lines.json)
import fs from 'node:fs';
const a = 1, rc = 0.16;
const E = (x, y) => {
  const dx1 = x + a, dx2 = x - a, r1 = Math.hypot(dx1, y) ** 3, r2 = Math.hypot(dx2, y) ** 3;
  return [dx1 / r1 - dx2 / r2, y / r1 - y / r2];
};
const V = (x, y) => 1 / Math.hypot(x + a, y) - 1 / Math.hypot(x - a, y);
const r4 = n => Math.round(n * 1e4) / 1e4;
function line(alphaDeg) {
  const al = alphaDeg * Math.PI / 180;
  let p = [-a + rc * Math.cos(al), rc * Math.sin(al)];
  const pts = [p];
  const h = 0.004;
  const dir = (x, y) => { const [ex, ey] = E(x, y), m = Math.hypot(ex, ey); return [ex / m, ey / m]; };
  for (let k = 0; k < 200000; k++) {
    const [x, y] = p;
    const k1 = dir(x, y), k2 = dir(x + h / 2 * k1[0], y + h / 2 * k1[1]), k3 = dir(x + h / 2 * k2[0], y + h / 2 * k2[1]), k4 = dir(x + h * k3[0], y + h * k3[1]);
    p = [x + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), y + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    if (Math.hypot(p[0] - a, p[1]) <= rc) { const u = Math.atan2(p[1], p[0] - a); pts.push([a + rc * Math.cos(u), rc * Math.sin(u)]); break; }
    if (k % 25 === 0) pts.push(p);
  }
  return pts.map(([x, y]) => ({ x: r4(x), y: r4(y) }));
}
function equi(V0, cx) {
  const pts = [];
  for (let k = 0; k <= 48; k++) {
    const ph = k / 48 * 2 * Math.PI;
    let lo = 0.02, hi = 0.99;
    const f = r => V(cx + r * Math.cos(ph), r * Math.sin(ph)) - V0;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid; else hi = mid; }
    const r = (lo + hi) / 2;
    pts.push({ x: r4(cx + r * Math.cos(ph)), y: r4(r * Math.sin(ph)) });
  }
  return pts;
}
const out = {};
for (const al of [35, 70, 110]) { out[`up${al}`] = line(al); out[`dn${al}`] = line(-al).map(p => p); }
out.eqPlus = equi(1.6, -a);
out.eqMinus = equi(-1.6, a);
const els = [
  { id: 'qp', type: 'charge', at: { x: -1, y: 0 }, sign: '+', r: 0.16, filled: true },
  { id: 'qm', type: 'charge', at: { x: 1, y: 0 }, sign: '-', r: 0.16, filled: true },
  { id: 'axis', type: 'fieldLine', points: ['qp.right', 'qm.left'], arrows: [0.5] },
];
const lines = ['up35', 'up70', 'up110', 'dn35', 'dn70', 'dn110'];
for (const k of lines) els.push({ id: k, type: 'fieldLine', points: out[k], arrows: [0.3, 0.75], mayTouch: ['qp', 'qm'] });
els.push({ id: 'eqP', type: 'polyline', points: out.eqPlus, dashed: true, color: 'greenDark', width: 1.2, mayTouch: ['axis', ...lines], label: { text: 'V = +1.6 kq/a', anchor: 'mid', position: 'left' } });
els.push({ id: 'eqM', type: 'polyline', points: out.eqMinus, dashed: true, color: 'greenDark', width: 1.2, mayTouch: ['axis', ...lines], label: { text: 'V = −1.6 kq/a', anchor: 'start', position: 'right' } });
els.push({ id: 'eq0', type: 'segment', from: { x: 0, y: -3.0 }, to: { x: 0, y: 3.0 }, dashed: true, color: 'greenDark', width: 1.2, mayTouch: ['axis', ...lines], label: { text: 'V = 0', anchor: 'start', position: 'right' } });
// Potential (units of kq/a) at an anchor, from its coordinates in m (1 world unit = a = 1 m).
const Vat = p => `(1/sqrt((${p}.x/(1 m) + 1)^2 + (${p}.y/(1 m))^2) - 1/sqrt((${p}.x/(1 m) - 1)^2 + (${p}.y/(1 m))^2))`;
const model = {
  version: 1,
  title: 'Electric dipole: field lines and equipotentials',
  caption: 'Streamlines integrated from E; equipotentials of V = kq(1/r₊ − 1/r₋)',
  canvas: { width: 640, height: 600, world: { xMin: -3.1, xMax: 3.1, yMin: -3.35, yMax: 3.3 } },
  vars: { rc: '0.16 m' },
  elements: els,
  checks: [
    { id: 'eqP_constant_V', type: 'equal', left: Vat('eqP.start'), right: Vat('eqP.mid'), tol: 2e-3 },
    { id: 'eqP_value', type: 'equal', left: Vat('eqP.start'), right: 1.6, tol: 2e-3 },
    { id: 'eqM_value', type: 'equal', left: Vat('eqM.mid'), right: -1.6, tol: 2e-3 },
    { id: 'line_starts_on_plus', type: 'equal', left: 'sqrt((up110.start.x + 1 m)^2 + up110.start.y^2)', right: 'rc', tol: '1e-3 m' },
    { id: 'line_ends_on_minus', type: 'equal', left: 'sqrt((up110.end.x - 1 m)^2 + up110.end.y^2)', right: 'rc', tol: '1e-3 m' },
    { id: 'mirror_symmetry', type: 'equal', left: 'up70.mid.y', right: '-dn70.mid.y', tol: '1e-4 m' },
  ],
};
// Compact point lists: one {"x","y"} object per point, several per line.
const json = JSON.stringify(model, null, 2).replace(/\{\s+"x": ([-\d.e]+),\s+"y": ([-\d.e]+)\s+\}/g, '{ "x": $1, "y": $2 }').replace(/(\{ "x": [-\d.e]+, "y": [-\d.e]+ \}),\s+(?=\{ "x")/g, '$1, ');
fs.writeFileSync(new URL('../15-dipole-field-lines.json', import.meta.url), json + '\n');
console.log('wrote 15-dipole-field-lines.json');
