/**
 * The toolkit proof set (examples/toolkit/proof/): 30 engineering diagrams
 * built only from toolkit parts. For each one:
 *  - it composes with zero collisions, nothing out of bounds, a clean style
 *    contract and SVG oracle, deterministically;
 *  - it declares at least two checks of its own and they pass;
 *  - the physics is recomputed here in plain JavaScript (closed forms,
 *    linear solves, ODE integration, simulation) and compared with the
 *    model's values, never by re-evaluating the model's own formula text
 *    against itself;
 *  - one deliberately wrong piece of physics is injected and a declared
 *    check must catch it (E_CHECK_FAILED), so the checks test something.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkToolkitStyle, compose, toolkitEvalQuantity, toolkitVariableScope } from "../../src/toolkit/index.js";
import type { ComposeModel, ComposeResult, ElementSpec } from "../../src/toolkit/index.js";
import { svgOracle } from "./parts_helpers.js";

const DIR = new URL("../../../../examples/toolkit/proof/", import.meta.url);
const FILES = readdirSync(DIR).filter(f => f.endsWith(".json")).sort();
const load = (name: string): ComposeModel => JSON.parse(readFileSync(new URL(name, DIR), "utf8"));
const file = (prefix: string) => FILES.find(f => f.startsWith(prefix))!;
type Ok = Extract<ComposeResult, { ok: true }>;
const run = (m: ComposeModel): Ok => { const r = compose(m); assert.ok(r.ok, JSON.stringify(!r.ok && r.errors)); return r as Ok; };
/** SI value of an expression in the model's own variable scope. */
const val = (m: ComposeModel, expr: string) => toolkitEvalQuantity(expr, toolkitVariableScope(m.vars ?? {}), "test", ["test"]).value;
const near = (a: number, b: number, rel = 1e-6, abs = 1e-9) => assert.ok(Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b)), `${a} != ${b}`);
const el = (m: ComposeModel, id: string) => m.elements.find(e => e.id === id)! as ElementSpec & Record<string, unknown>;
const withVars = (m: ComposeModel, vars: Record<string, string>) => ({ ...m, vars: { ...m.vars, ...vars } });
const checkActual = (r: Ok, id: string) => r.report.checks.find(c => c.id === id)!.actual as number;
const deg = Math.PI / 180;

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!; }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}
/** RK4 for x'' = f(t, x, v); returns samples. */
function rk4(f: (t: number, x: number, v: number) => number, x0: number, v0: number, dt: number, T: number) {
  const out: { t: number; x: number }[] = [{ t: 0, x: x0 }]; let x = x0, v = v0;
  for (let t = 0; t < T; t += dt) {
    const k1x = v, k1v = f(t, x, v), k2x = v + dt / 2 * k1v, k2v = f(t + dt / 2, x + dt / 2 * k1x, v + dt / 2 * k1v);
    const k3x = v + dt / 2 * k2v, k3v = f(t + dt / 2, x + dt / 2 * k2x, v + dt / 2 * k2v), k4x = v + dt * k3v, k4v = f(t + dt, x + dt * k3x, v + dt * k3v);
    x += dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); v += dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
    out.push({ t: t + dt, x });
  }
  return out;
}
const simpson = (f: (x: number) => number, a: number, b: number, n = 2000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * f(a + k * h); return s * h / 3; };

interface Proof { verify(m: ComposeModel, r: Ok): void; mutate(m: ComposeModel): ComposeModel }
const PROOFS: Record<string, Proof> = {
  "01": {
    verify: (m, r) => {
      const P = 12e3, L = 6, a = 2, b = L - a;
      near(val(m, "RA"), P * b / L); near(val(m, "RB"), P * a / L);
      near(checkActual(r, "areaV_equals_M"), (P * b / L) * a / 1e3, 1e-9); // area under V on [0, a] in kN·m
    },
    mutate: m => withVars(m, { RA: "P*a/L" }),
  },
  "02": {
    verify: (m, r) => {
      // Independent method of joints: 2j equilibrium equations for the joints in the report.
      const J = (r.report.elements.find(e => e.id === "tr")!.points as { joints: { x: number; y: number }[] }).joints;
      const mem = el(m, "tr").members as [number, number][];
      // Unknowns: 7 member forces (tension +), RAx, RAy, RCy.
      const A: number[][] = [], b: number[] = [];
      for (let j = 0; j < J.length; j++) for (const ax of ["x", "y"] as const) {
        const row = new Array(mem.length + 3).fill(0);
        mem.forEach(([p, q], k) => { if (p !== j && q !== j) return; const o = p === j ? q : p; const L = Math.hypot(J[o]!.x - J[j]!.x, J[o]!.y - J[j]!.y); row[k] = (J[o]![ax] - J[j]![ax]) / L; });
        if (j === 0) row[mem.length + (ax === "x" ? 0 : 1)] = 1;
        if (j === 2 && ax === "y") row[mem.length + 2] = 1;
        A.push(row); b.push(j === 1 && ax === "y" ? 20e3 : 0);
      }
      const F = solve(A, b);
      const byPair = (p: number, q: number) => F[mem.findIndex(([u, w]) => (u === p && w === q) || (u === q && w === p))]!;
      near(val(m, "FAB"), byPair(0, 1)); near(val(m, "FAD"), byPair(0, 3)); near(val(m, "FDB"), byPair(3, 1));
      near(val(m, "FBE"), byPair(1, 4)); near(val(m, "FBC"), byPair(1, 2)); near(val(m, "FDE"), byPair(3, 4));
      near(F[mem.length + 1]!, 10e3); near(F[mem.length + 2]!, 10e3);
    },
    mutate: m => withVars(m, { FBE: "1.1*(P - FDB*sin(60 deg))/sin(60 deg)" }),
  },
  "03": {
    verify: m => { const W = 200, th = 60 * deg; near(val(m, "Nw"), W / 2 * Math.cos(th) / Math.sin(th)); assert.ok(W / (2 * Math.tan(th)) / W < 0.35); },
    mutate: m => withVars(m, { Nw: "W/tan(theta)" }),
  },
  "04": {
    verify: m => { const W = 5 * 9.81; near(val(m, "N"), W * Math.cos(25 * deg)); near(val(m, "f"), W * Math.sin(25 * deg)); assert.ok(Math.tan(25 * deg) <= 0.6); },
    mutate: m => withVars(m, { f: "m*g*cos(theta)" }),
  },
  "05": {
    verify: m => {
      // Solve the two Newton equations as a linear system in (a, T).
      const [a, T] = solve([[3, -1], [5, 1]], [-3 * 9.81, 5 * 9.81]);
      near(val(m, "a"), a!); near(val(m, "T"), T!);
    },
    mutate: m => withVars(m, { T: "m1*g" }),
  },
  "06": {
    verify: (m, r) => {
      const s = rk4((_t, x, v) => -4 * v - 100 * x, 1, 0, 1e-5, 0.6);
      const min = s.reduce((p, q) => q.x < p.x ? q : p);
      near(min.t, val(m, "tp"), 1e-4); near(min.x, checkActual(r, "overshoot_formula"), 1e-6);
    },
    mutate: m => withVars(m, { OS: "exp(-zeta*pi)" }),
  },
  "07": {
    verify: m => {
      const [sx, sy, t] = [80, -40, 30], tr = sx + sy, det = sx * sy - t * t, disc = Math.sqrt(tr * tr / 4 - det);
      near(val(m, "s1"), tr / 2 + disc); near(val(m, "s2"), tr / 2 - disc);
      // Principal direction: eigenvector of the larger eigenvalue.
      near(val(m, "thp"), Math.atan2(tr / 2 + disc - sx, t), 1e-9);
    },
    mutate: m => withVars(m, { R: "sqrt(((sx - sy)/2)^2 + txy)" }),
  },
  "08": {
    verify: m => {
      const E = 200e3, Y = 250, U = 400, F = 320, ey = Y / E, eu = 0.15, ef = 0.25;
      const sig = (e: number) => e <= ey ? E * e : e <= eu ? Y + (U - Y) * (1 - (1 - (e - ey) / (eu - ey)) ** 2) : U - (U - F) * ((e - eu) / (ef - eu)) ** 2;
      const area = simpson(sig, 0, ey) + simpson(sig, ey, eu) + simpson(sig, eu, ef);
      near(val(m, "toughness"), area, 1e-9); near(val(m, "ey"), 0.00125);
    },
    mutate: m => withVars(m, { toughness: "U*ef" }),
  },
  "09": {
    verify: (m, r) => {
      const nR = 8.314, TH = 500, TC = 300, g = 1.4, V1 = 10, V2 = 20, V3 = V2 * (TH / TC) ** (1 / (g - 1)), V4 = V1 * (TH / TC) ** (1 / (g - 1));
      const P1 = nR * TH / V1, P2 = nR * TH / V2;
      const W = simpson(V => nR * TH / V, V1, V2) + simpson(V => P2 * (V2 / V) ** g, V2, V3) - simpson(V => nR * TC / V, V4, V3) - simpson(V => P1 * (V1 / V) ** g, V1, V4);
      near(val(m, "Wnet"), W, 1e-8);
      near(checkActual(r, "carnot_efficiency"), 1 - TC / TH, 2e-3);
    },
    mutate: m => withVars(m, { Wnet: "nR*(TH - TC)*ln(V3/V1)" }),
  },
  "10": {
    verify: m => { near(val(m, "W"), 350); near(val(m, "QC"), 650); assert.ok(350 / 1000 <= 1 - 300 / 600); },
    mutate: m => withVars(m, { QC: "QH - W + 10 J" }),
  },
  "11": {
    verify: (m, r) => {
      const Q = 0.012, D = 0.08, v = Q / (Math.PI * D * D / 4), Hp = (5.4 - 1.2) + 1.35;
      near(val(m, "v"), v); near(val(m, "Hp"), Hp); near(val(m, "Pw"), 1000 * 9.81 * Q * Hp);
      near(checkActual(r, "surfaces_at_design_elevations"), 4.2, 1e-9);
    },
    mutate: m => withVars(m, { Hp: "z2 - z1" }),
  },
  "12": {
    verify: (m, r) => {
      const Q = 0.04, A1 = Math.PI * 0.2 ** 2 / 4, A2 = Math.PI * 0.1 ** 2 / 4, v1 = Q / A1, v2 = Q / A2;
      near(val(m, "dh"), (v2 * v2 - v1 * v1) / (2 * 9.81)); near(checkActual(r, "bernoulli_heads"), (v2 * v2 - v1 * v1) / (2 * 9.81), 1e-9);
    },
    mutate: m => withVars(m, { h2: "h1 - dh/2" }),
  },
  "13": {
    verify: m => { near(val(m, "t2"), Math.asin(1.5 * Math.sin(30 * deg))); near(val(m, "tc"), Math.asin(1 / 1.5)); assert.ok(50 * deg > Math.asin(1 / 1.5)); },
    mutate: m => withVars(m, { t2: "asin(n2*sin(t1)/n1)" }),
  },
  "14": {
    verify: m => {
      const L = 1.2, n = 3, v = 48;
      near(val(m, "lam"), 2 * L / n); near(val(m, "f"), n * v / (2 * L));
      for (let k = 0; k <= n; k++) near(Math.sin(n * Math.PI * (k * L / n) / L), 0, 0, 1e-12);
    },
    mutate: m => withVars(m, { lam: "L/n" }),
  },
  "15": {
    verify: m => {
      // Field lines of a dipole satisfy cos θ₊ − cos θ₋ = const (θ measured from +x at each charge).
      const inv = (p: { x: number; y: number }) => (p.x + 1) / Math.hypot(p.x + 1, p.y) - (p.x - 1) / Math.hypot(p.x - 1, p.y);
      for (const id of ["up35", "up70", "up110", "dn35", "dn70", "dn110"]) {
        const pts = el(m, id).points as { x: number; y: number }[], c = inv(pts[0]!);
        for (const p of pts.slice(0, -1)) assert.ok(Math.abs(inv(p) - c) < 2e-3, `${id}: invariant ${inv(p)} vs ${c}`);
      }
      const V = (p: { x: number; y: number }) => 1 / Math.hypot(p.x + 1, p.y) - 1 / Math.hypot(p.x - 1, p.y);
      for (const [id, v0] of [["eqP", 1.6], ["eqM", -1.6]] as const) for (const p of el(m, id).points as { x: number; y: number }[]) assert.ok(Math.abs(V(p) - v0) < 2e-3, `${id}: V ${V(p)}`);
    },
    mutate: m => withVars(m, { rc: "0.2 m" }),
  },
  "16": {
    verify: m => { near(val(m, "B1"), 2e-7 * 10 / 0.012); near(val(m, "B2"), 2e-7 * 10 / 0.024); },
    mutate: m => withVars(m, { B2: "mu0*I/(2*pi*r1)" }),
  },
  "17": {
    verify: m => {
      const [R1, R2, R3, R4, Rg, Vs] = [100, 200, 150, 250, 50, 10];
      // Mesh analysis (independent of the model's nodal formulas): meshes ABD (ia), BCD (ib) and the source loop ADC (ic).
      const [ia, ib, ic] = solve([[R1 + Rg + R3, -Rg, -R3], [-Rg, R2 + R4 + Rg, -R4], [-R3, -R4, R3 + R4]], [0, 0, Vs]);
      near(val(m, "I1"), ia!); near(val(m, "I2"), ib!); near(val(m, "Ig"), ia! - ib!, 1e-6);
      near(val(m, "I3"), ic! - ia!); near(val(m, "I4"), ic! - ib!); near(val(m, "Is"), ic!);
    },
    mutate: m => withVars(m, { VD: "VB" }),
  },
  "18": {
    verify: m => { near(val(m, "vout"), -47e3 / 10e3 * 0.5); near(val(m, "iin"), 0.5 / 10e3); },
    mutate: m => withVars(m, { vout: "Rf/Rin*vin" }),
  },
  "19": {
    verify: m => { const re = 2 * 10, im = 2 * (15 - 8); near(val(m, "Vm"), Math.hypot(re, im)); near(val(m, "phi"), Math.atan2(im, re)); },
    mutate: m => withVars(m, { phi: "atan2(XL + XC, R)" }),
  },
  "20": {
    verify: m => {
      const ph = (a: number) => [230 * Math.cos(a * deg), 230 * Math.sin(a * deg)];
      const [a, b] = [ph(0), ph(-120)], ab = [a[0]! - b[0]!, a[1]! - b[1]!];
      near(val(m, "VLm"), Math.hypot(ab[0]!, ab[1]!)); near(Math.atan2(ab[1]!, ab[0]!), 30 * deg);
    },
    mutate: m => ({ ...m, elements: m.elements.map(e => e.id === "Vb" ? { ...e, angle: -100 } : e) }),
  },
  "21": {
    verify: m => {
      const G = (w: number) => 100 / Math.hypot(100 - w * w, 2 * 0.2 * 10 * w);
      let best = 0, bw = 0; for (let w = 5; w < 15; w += 1e-4) if (G(w) > best) { best = G(w); bw = w; }
      near(val(m, "wr"), bw, 1e-4); near(20 * Math.log10(val(m, "Mr")), 20 * Math.log10(best), 1e-6);
    },
    mutate: m => withVars(m, { wr: "wn" }),
  },
  "22": {
    verify: m => {
      const s = rk4((_t, y, v) => 16 * (1 - y) - 2 * 0.3 * 4 * v, 0, 0, 1e-5, 2);
      const pk = s.reduce((p, q) => q.x > p.x ? q : p);
      near(val(m, "tp"), pk.t, 1e-4); near(1 + val(m, "Mp"), pk.x, 1e-6);
    },
    mutate: m => withVars(m, { tp: "pi/wn" }),
  },
  "23": {
    verify: m => {
      // Every plotted locus point satisfies the angle condition ∠G = 180° (mod 360°) with K > 0.
      for (const id of ["b1", "b2", "b3"]) for (const [x, y] of el(m, id).data as [number, number][]) {
        if (Math.hypot(x, y) < 1e-3 || Math.hypot(x + 2, y) < 1e-3 || Math.hypot(x + 4, y) < 1e-3) continue;
        const ang = Math.atan2(y, x) + Math.atan2(y, x + 2) + Math.atan2(y, x + 4);
        const r = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        assert.ok(Math.abs(r - Math.PI) < 2e-3 || y === 0, `${id} (${x}, ${y}) angle ${r}`);
      }
      // Routh: s^3 + 6 s^2 + 8 s + K has a jω-axis pair when 6*8 = K, at ω² = 8.
      near(val(m, "Kc"), 48); near(val(m, "wc"), Math.sqrt(8));
      // Breakaway: real root of d/ds[s(s+2)(s+4)] between 0 and -2.
      near(val(m, "sb"), (-12 + Math.sqrt(144 - 96)) / 6);
    },
    mutate: m => withVars(m, { sb: "-1" }),
  },
  "24": {
    verify: m => { const K = 4; near(val(m, "wn"), Math.sqrt(K)); near(val(m, "zeta"), 1 / (2 * Math.sqrt(K))); },
    mutate: m => withVars(m, { zeta: "1/wn" }),
  },
  "25": {
    verify: m => {
      // Simulate the drawn machine and compare with "two or more consecutive 1s".
      const out = (s: string) => el(m, s).text!.toString().split("/")[1]!.trim();
      const next = new Map<string, string>();
      for (const e of m.elements) {
        if (e.type === "transition") next.set(`${e.from}:${e.label}`, e.to as string);
        if (e.type === "selfLoop") next.set(`${e.state}:${e.label}`, e.state as string);
      }
      for (const s of ["A", "B", "C"]) for (const i of ["0", "1"]) assert.ok(next.has(`${s}:${i}`), `missing ${s} on ${i}`);
      for (const input of ["0110111", "1111", "1010", "0011001110"]) {
        let s = "A", run = 0;
        for (const c of input) { s = next.get(`${s}:${c}`)!; run = c === "1" ? run + 1 : 0; assert.equal(out(s), run >= 2 ? "1" : "0", `input ${input}`); }
      }
    },
    mutate: m => ({ ...m, elements: m.elements.map(e => e.id === "B" ? { ...e, at: { x: "1.2 m + 0.95*dx", y: 0 } } : e) }),
  },
  "26": {
    verify: m => {
      const ones = new Set([0, 2, 5, 7, 8, 10, 13, 15]);
      for (let k = 0; k < 16; k++) {
        assert.equal(el(m, `m${k}`).text, ones.has(k) ? "1" : "0", `cell m${k}`);
        const B = (k >> 2) & 1, D = k & 1;
        assert.equal(((!B && !D) || (B && D)) ? 1 : 0, ones.has(k) ? 1 : 0, `B'D' + BD at m${k}`);
      }
    },
    mutate: m => ({ ...m, checks: m.checks!.map(c => c.id === "map_matches_minterms" ? { ...c, rows: (c as { rows: number[][] }).rows.map(([x, y]) => [x!, x === 3 ? 1 : y!]) } : c) }),
  },
  "27": {
    verify: m => {
      const conn = (from: string, to: string) => m.elements.some(e => e.type === "connector" && String(JSON.stringify(e.from)).includes(from) && String(JSON.stringify(e.to)).includes(to));
      for (const [a, b] of [["PC", "IM"], ["IM", "RF"], ["RF", "ALU"], ["ALU", "DM"], ["DM", "MX"], ["MX", "RF"], ["PC", "ADD"], ["ADD", "PC"], ["IM", "SX"], ["SX", "ALU"]]) assert.ok(conn(a!, b!), `${a} -> ${b}`);
    },
    mutate: m => ({ ...m, elements: m.elements.map(e => e.id === "DM" ? { ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== "place")), at: { x: 11.95, y: 0.5 } } as ElementSpec : e) }),
  },
  "28": {
    verify: m => {
      // Run the algorithm the boxes describe for n = 5 and walk the drawn graph from Start to End.
      let n = 5, f = 1; while (n > 1) { f *= n; n -= 1; }
      near(val(m, "fact"), f);
      const edges = m.elements.filter(e => e.type === "connector").map(e => [String(e.from).split(".")[0], String(e.to).split(".")[0], (e.label as { text?: string } | undefined)?.text] as const);
      const out = (id: string) => edges.filter(e => e[0] === id);
      assert.deepEqual(out("dec").map(e => e[2]).sort(), ["no", "yes"]);
      const seen = new Set<string>(); const stack = ["start"];
      while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); for (const e of out(id)) stack.push(e[1]!); }
      assert.ok(seen.has("end") && seen.has("body"));
      assert.ok(out("body").some(e => e[1] === "dec"), "loop back to the decision");
    },
    mutate: m => withVars(m, { fact: "5*4*3" }),
  },
  "29": {
    verify: m => {
      const h = 6.62607015e-34, c = 299792458, eV = 1.602176634e-19, E = (n: number) => -13.6 * eV / (n * n);
      near(val(m, "lamHa"), h * c / (E(3) - E(2))); near(val(m, "lamHb"), h * c / (E(4) - E(2)));
      assert.ok(Math.abs(h * c / (E(3) - E(2)) - 656.1e-9) < 0.5e-9);
    },
    mutate: m => ({ ...m, elements: m.elements.map(e => e.id === "Ha" ? { ...e, from: { ref: "L4.start", dx: 3.6 } } : e) }),
  },
  "30": {
    verify: m => {
      const b = 0.6, g = 1 / Math.sqrt(1 - b * b), x = 2, t = 3;
      near(val(m, "xp"), g * (x - b * t)); near(val(m, "tp"), g * (t - b * x));
      near(t * t - x * x, val(m, "tp") ** 2 - val(m, "xp") ** 2, 1e-12);
    },
    mutate: m => withVars(m, { xp: "gam*(xE + beta*tE)" }),
  },
};

test("proof set: 30 diagrams are present, one per requested topic", () => {
  assert.equal(FILES.length, 30, FILES.join(", "));
  assert.deepEqual(Object.keys(PROOFS).sort(), FILES.map(f => f.slice(0, 2)));
});

for (const f of FILES) {
  const key = f.slice(0, 2);
  test(`proof set: ${f} composes cleanly, passes its declared checks and is deterministic`, () => {
    const m = load(f);
    const r = run(m);
    const declared = r.report.checks.filter(c => !String(c.id).startsWith("scale:"));
    assert.ok(declared.length >= 2, `${f}: at least two declared checks`);
    assert.ok(r.report.checks.every(c => c.pass));
    assert.deepEqual({ collisions: r.report.gate!.collisions, outOfBounds: r.report.gate!.outOfBounds, nonFinite: r.report.gate!.nonFinite }, { collisions: 0, outOfBounds: 0, nonFinite: 0 });
    assert.deepEqual(checkToolkitStyle(r.svg, { title: m.title, caption: r.report.caption }), []);
    assert.deepEqual(svgOracle(r.svg, m.canvas.width, m.canvas.height), []);
    assert.equal(run(load(f)).svg, r.svg);
  });
  test(`proof set: ${f} physics agrees with an independent computation`, () => {
    const m = load(f);
    PROOFS[key]!.verify(m, run(m));
  });
  test(`proof set: ${f} declared checks reject a wrong-physics variant`, () => {
    const r = compose(PROOFS[key]!.mutate(load(f)));
    assert.equal(r.ok, false, "the mutated model must not render");
    if (!r.ok) assert.ok(r.errors.some(e => e.code === "E_CHECK_FAILED"), JSON.stringify(r.errors.map(e => `${e.code}: ${e.message}`)));
  });
}
