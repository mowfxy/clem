// The film's sound, synthesised from nothing (no samples), in E: room air and the pen while it
// draws, a low rumble that grows as the lens opens, a sustained string section that swells
// chord by chord, clockwork ticking that quickens with the cuts, a hard stop at the moon, then a
// bright held chord with a high glass tone that thins to nothing.
// Writes a 48 kHz stereo WAV.
import { writeFile } from "node:fs/promises";

const SR = 48000, TAU = Math.PI * 2;
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const N = { E1: 28, Fs1: 30, A1: 33, B1: 35, D2: 38, E2: 40, Fs2: 42, Gs2: 44, A2: 45, B2: 47, Cs3: 49, D3: 50, E3: 52, Fs3: 54, Gs3: 56, A3: 57, B3: 59, Cs4: 61, D4: 62, E4: 64, Fs4: 66, Gs4: 68, A4: 69, B4: 71, Cs5: 73, E5: 76, Fs5: 78, Gs5: 80, A5: 81, B5: 83, E6: 88, B6: 95, B7: 107 };

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rand() * 2 - 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const TABLE = 4096, sawTables = new Map();
function sawTable(f) {
  const key = Math.min(200, Math.max(1, Math.floor(15000 / f)));
  if (sawTables.has(key)) return sawTables.get(key);
  const t = new Float32Array(TABLE);
  for (let h = 1; h <= key; h++) { const a = (h % 2 ? 1 : -1) / h; for (let i = 0; i < TABLE; i++) t[i] += a * Math.sin(TAU * h * i / TABLE); }
  for (let i = 0; i < TABLE; i++) t[i] *= 0.55;
  sawTables.set(key, t);
  return t;
}
function biquad(type, f, q) {
  let b0, b1, b2, a0, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (nf, nq = q) => {
    const w = TAU * Math.min(nf, SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * nq);
    a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
  };
  set(f, q);
  const fn = (x) => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  fn.set = set;
  return fn;
}

export async function score({ duration, cues, file }) {
  const L = Math.ceil((duration + 0.2) * SR);
  const dry = [new Float32Array(L), new Float32Array(L)], wet = [new Float32Array(L), new Float32Array(L)];
  const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
  function voice(t, len, fn, { gain = 1, p = 0, send = 0.25 } = {}) {
    const [gl, gr] = pan(p), s0 = Math.round(t * SR), n = Math.round(len * SR);
    for (let k = 0; k < n; k++) {
      const i = s0 + k; if (i < 0 || i >= L) continue;
      const v = fn(k / SR, i) * gain;
      dry[0][i] += v * gl; dry[1][i] += v * gr;
      if (send) { wet[0][i] += v * gl * send; wet[1][i] += v * gr * send; }
    }
  }
  const at = (kind) => cues.find((c) => c.kind === kind).t;
  const all = (kind) => cues.filter((c) => c.kind === kind);

  // ------------------------------------------------------------ instruments

  /** A string section on one note: detuned bowed saws, slow vibrato, a shaped dynamic. */
  function section(t, len, note, g, { dyn = () => 1, cut = 2600, cutDyn = 0, att = 0.6, rel = 0.8, p = 0, send = 0.5, voices = 6 } = {}) {
    const f = NOTE(note), tab = sawTable(f * 1.03), lp = biquad("lp", cut, 0.55), lp2 = biquad("lp", cut, 0.55);
    const ph = Array.from({ length: voices }, () => rand()), det = Array.from({ length: voices }, (_, k) => Math.pow(2, ((k / Math.max(1, voices - 1)) - 0.5) * 0.16 / 12));
    const vr = Array.from({ length: voices }, () => 4.6 + rand() * 1.4), vp = Array.from({ length: voices }, () => rand() * TAU);
    voice(t, len + rel, (x) => {
      let s = 0;
      for (let k = 0; k < voices; k++) {
        const v = 1 + 0.003 * Math.sin(TAU * vr[k] * x + vp[k]);
        ph[k] += f * det[k] * v / SR; ph[k] -= Math.floor(ph[k]); s += tab[(ph[k] * TABLE) | 0];
      }
      const d = dyn(x);
      if (((x * SR) | 0) % 64 === 0) { const c = cut * (1 + cutDyn * d); lp.set(c); lp2.set(c); }
      const env = clamp(x / att) * clamp((len + rel - x) / rel);
      return lp2(lp(s / voices + noise() * 0.01)) * env * d;
    }, { gain: g, p, send });
  }
  function chord(t, len, notes, g, opts = {}) { notes.forEach((n, i) => section(t, len, n, g / notes.length, { ...opts, p: notes.length > 1 ? (i / (notes.length - 1)) * 1.3 - 0.65 : 0 })); }
  /** Low granular rumble: filtered noise in uneven grains, like a distant roll of drums. */
  function rumble(t, len, g, dyn = () => 1, { cut = 140, rate = 18 } = {}) {
    const lp = biquad("lp", cut, 0.7), lp2 = biquad("lp", cut, 0.7); let grain = 0, next = 0;
    voice(t, len, (x) => { if (x >= next) { grain = 0.35 + rand() * 0.65; next = x + (0.5 + rand()) / rate; } const env = clamp(x / 0.5) * clamp((len - x) / 0.3); return lp2(lp(noise())) * grain * env * dyn(x) * 4; }, { gain: g, send: 0.25 });
  }
  function boom(t, g, len = 2.4) {
    const lp = biquad("lp", 160, 0.7);
    voice(t, len, (x) => { const f = 30 + 36 * Math.exp(-x * 5); return Math.sin(TAU * f * x + 3 * Math.exp(-x * 9)) * Math.exp(-x * 1.5) + lp(noise()) * Math.exp(-x * 6) * 1.3; }, { gain: g, send: 0.35 });
  }
  function crash(t, g) {
    const hp = biquad("hp", 2500, 0.6), bp = biquad("bp", 5200, 0.8);
    voice(t, 2.8, (x) => (hp(noise()) * 0.6 + bp(noise()) * 0.6) * (Math.exp(-x * 2.2) + 0.5 * Math.exp(-x * 14)), { gain: g, send: 0.7 });
  }
  /** A heavy brass mechanism locking into place: inharmonic ring over a short knock. */
  function clank(t, g) {
    const parts = [[180, 1, 9], [417, 0.7, 12], [733, 0.5, 16], [1210, 0.35, 22], [1870, 0.2, 30]], bp = biquad("bp", 900, 2);
    voice(t, 1.2, (x) => parts.reduce((s, [f, a, d]) => s + a * Math.sin(TAU * f * x) * Math.exp(-x * d), 0) + bp(noise()) * Math.exp(-x * 80) * 2, { gain: g, p: 0.1, send: 0.45 });
  }
  function timp(t, note, g, p = 0) {
    const f = NOTE(note), lp = biquad("lp", 700, 0.7);
    voice(t, 1.4, (x) => { const fr = f * (1 + 0.04 * Math.exp(-x * 20)); return Math.sin(TAU * fr * x) * Math.exp(-x * 3) + 0.3 * Math.sin(TAU * fr * 1.5 * x) * Math.exp(-x * 6) + lp(noise()) * Math.exp(-x * 40) * 0.7; }, { gain: g, p, send: 0.4 });
  }
  /** Clockwork: an escapement's tick and tock, woody and metallic. */
  function tick(t, g, hi = true, p = 0) {
    const bp = biquad("bp", hi ? 3100 : 1900, 9), bp2 = biquad("bp", hi ? 6400 : 4200, 6);
    voice(t, 0.07, (x) => (bp(noise()) * 3 + bp2(noise()) * 1.2) * Math.exp(-x * 150) + Math.sin(TAU * (hi ? 1250 : 900) * x) * Math.exp(-x * 120) * 0.35, { gain: g, p, send: 0.18 });
  }
  function swish(t, len, g, { up = true, f0 = 300, f1 = 6000, p = 0, q = 0.9 } = {}) {
    const bp = biquad("bp", f0, q);
    voice(t, len, (x) => { const k = x / len; if (((x * SR) | 0) % 64 === 0) bp.set(up ? f0 * Math.pow(f1 / f0, k) : f1 * Math.pow(f0 / f1, k), q); return bp(noise()) * Math.sin(Math.PI * Math.pow(k, up ? 1.4 : 0.6)) * 3; }, { gain: g, p, send: 0.4 });
  }
  function paper(t, len, g, p = 0) {
    const hp = biquad("hp", 1200, 0.7), bp = biquad("bp", 3500, 0.6); let grain = 0;
    voice(t, len, (x) => { if (((x * SR) | 0) % 180 === 0) grain = rand(); return (hp(noise()) * 0.5 + bp(noise()) * grain) * Math.sin(Math.PI * x / len) * 1.6; }, { gain: g, p, send: 0.2 });
  }
  function glass(t, len, f, g, p = 0, beat = 0.6) {
    voice(t, len, (x) => (Math.sin(TAU * f * x) + 0.6 * Math.sin(TAU * (f + beat) * x) + 0.15 * Math.sin(TAU * f * 2.76 * x)) * clamp(x / 1.2) * clamp((len - x) / 1.5), { gain: g, p, send: 0.85 });
  }
  function piano(t, note, g, p = 0) {
    const f = NOTE(note), parts = [[1, 1, 1.1], [2.003, 0.45, 2], [3.01, 0.2, 3.4], [4.02, 0.1, 5]];
    voice(t, 4.5, (x) => parts.reduce((s, [m, a, d]) => s + a * Math.sin(TAU * f * m * x) * Math.exp(-x * d), 0) * Math.min(1, x / 0.004), { gain: g, p, send: 0.7 });
  }
  function air(t, len, g) {
    const lp = biquad("lp", 900, 0.5), hp = biquad("hp", 120, 0.5);
    voice(t, len, (x) => hp(lp(noise())) * clamp(x / 0.6) * clamp((len - x) / 0.8), { gain: g, send: 0.2 });
  }
  function pen(t, len, g, { p = 0, writing = false } = {}) {
    const bp = biquad("bp", 4200, 0.9), bp2 = biquad("bp", 1400, 1.4); let grain = 0;
    const rate = writing ? 9 : 4.5;
    voice(t, len + 0.04, (x) => {
      if (((x * SR) | 0) % 240 === 0) grain = 0.4 + rand() * 0.6;
      const gest = 0.55 + 0.45 * Math.sin(TAU * rate * x + Math.sin(TAU * 1.7 * x) * 2), n = noise();
      return (bp(n) * 2.2 + bp2(n) * 0.5) * grain * gest * clamp(x / 0.02) * clamp((len + 0.04 - x) / 0.05);
    }, { gain: g, p, send: 0.12 });
  }

  // ------------------------------------------------------------ the arrangement

  const swing = at("swing"), hit = at("hit"), hit2 = at("hit2"), pull = at("pull"), out = at("sky");
  const title = at("title"), title2 = at("title2"), url = at("url");

  // 1. the page: air, the pen, a held E that wavers like breath
  air(0, swing + 0.5, 0.06);
  for (const c of all("pen")) if (c.t < 3) pen(c.t, c.dur, 0.045, { p: rand() * 0.4 - 0.2, writing: c.text });
  section(0, swing + 0.6, N.E4, 0.07, { att: 0.9, cut: 2400, send: 0.7, dyn: (x) => 0.75 + 0.25 * Math.sin(TAU * 0.6 * x) });
  section(0.4, swing + 0.2, N.E5, 0.035, { att: 1.4, cut: 3200, send: 0.8, p: 0.3 });
  rumble(1.1, hit - 1.1, 0.16, (x) => sstep(0, 2.6, x), { cut: 110 });

  for (const c of all("iris")) { tick(c.t, 0.09, true, 0); tick(c.t + 0.03, 0.05, false, 0.2); boom(c.t, 0.05, 0.6); glass(c.t, 1.2, 1850 + rand() * 300, 0.006, 0, 0); }
  // 2. into the lens
  boom(swing, 0.22, 1.6);
  swish(swing - 0.1, hit - swing + 0.1, 0.07, { f0: 200, f1: 5000 });
  chord(swing, hit - swing, [N.E2, N.B2, N.E3, N.B3, N.E4], 0.22, { att: 0.4, rel: 0.3, cut: 900, cutDyn: 1.5, dyn: (x) => 0.4 + 0.6 * sstep(0, hit - swing, x) });

  // 3. the run: strings swell chord by chord over rumble and quickening clockwork
  // the lens locks onto the first subject: a deep thunk, a metal clank, a short low stab
  boom(hit, 0.6, 2.2); clank(hit, 0.12);
  chord(hit, 0.35, [N.E1 + 12, N.B1 + 12, N.E2 + 12], 0.35, { att: 0.01, rel: 0.6, cut: 700, send: 0.5 });
  // six bars, A → E/G# → F#m → D → C#m → B, each a little fuller, the B leaning into the E climax
  const chords = [
    [N.A2, N.E3, N.Cs4, N.E4, N.B4], [N.Gs2, N.E3, N.B3, N.E4, N.Fs4, N.B4], [N.Fs2, N.Cs3, N.A3, N.E4, N.A4],
    [N.D3, N.A3, N.Cs4, N.Fs4, N.A4], [N.Cs3, N.Gs3, N.Cs4, N.E4, N.Gs4, N.B4], [N.B2, N.Fs3, N.B3, N.Ds4 || 63, N.Fs4, N.B4],
  ];
  const bars = chords.length, bar = (hit2 - hit) / bars;
  const prog = chords.map((notes, i) => [hit + i * bar, i === bars - 1 ? hit2 : hit + (i + 1) * bar, notes]);
  prog.forEach(([t0, t1, notes], i) => {
    const k = i / (bars - 1), len = t1 - t0;
    chord(t0, len, notes, 0.62 + 0.38 * k, { att: 0.35, rel: 0.5, cut: 1500 + 900 * k, cutDyn: 0.8, dyn: (x) => 0.55 + 0.45 * sstep(0, len, x) });
    section(t0, len, notes[0] - 12, 0.2 + 0.08 * k, { att: 0.2, rel: 0.4, cut: 380, voices: 3 });
  });
  section(hit, hit2 - hit, N.E5, 0.04, { att: 2, rel: 0.4, cut: 4000, send: 0.8, dyn: (x) => 0.4 + 0.6 * sstep(0, hit2 - hit, x) });
  rumble(hit, at("moon") + 0.2 - hit, 0.22, (x) => 0.45 + 0.55 * sstep(0, at("moon") - hit, x), { cut: 150, rate: 22 });
  glass(hit + 4.5, hit2 - hit - 4.3, NOTE(N.E6) * 4, 0.006, 0.5, 1.3);
  glass(hit + 6.5, hit2 - hit - 6.3, NOTE(N.B6) * 4, 0.004, -0.5, 0.9);
  // clockwork on the beat: every cut gets a tick, and the gaps are filled to keep the grid running
  for (const c of all("cut")) {
    const k = clamp((c.t - hit) / (pull - hit));
    tick(c.t, 0.07 + 0.05 * k, true, rand() * 0.5 - 0.25);
    if (c.gap > 0.3 && c.gap < 1) tick(c.t + c.gap / 2, 0.04 + 0.03 * k, false, 0.25);
    if (c.gap > 0.2 && c.gap < 1 && c.t > 5.8) tick(c.t + c.gap / 2, 0.035, false, -0.3);
  }
  // a pulse underneath, on every beat from the second bar, on every half beat in the fourth
  for (let t = hit + 2; t < hit2 - 0.01; t += t < hit + 8 ? 0.5 : 0.25) timp(t, Math.round((t - hit) / 0.5) % 2 ? N.B1 : N.E2, 0.1 + 0.08 * clamp((t - hit - 2) / (hit2 - hit - 2)), 0);
  // 4. climax: full E major, timpani rolling, everything leans into the moon
  boom(hit2, 0.55, 2.6); crash(hit2, 0.14);
  const moon = at("moon"), climax = moon + 0.04 - hit2;
  chord(hit2, climax, [N.E2, N.B2, N.E3, N.Gs3, N.B3, N.E4, N.Fs4, N.Gs4, N.B4, N.E5], 0.95, { att: 0.12, rel: 0.12, cut: 3200, cutDyn: 0.7, dyn: (x) => 0.7 + 0.3 * sstep(0, climax, x) });
  section(hit2, climax, N.E1 + 12, 0.18, { att: 0.05, rel: 0.1, cut: 300, voices: 3 });
  for (let s = 0, i = 0; hit2 + s < moon - 0.02; i++) { timp(hit2 + s, i % 3 ? N.B1 : N.E2, 0.12 + 0.1 * (s / climax), i % 2 ? 0.3 : -0.3); s += Math.max(0.055, 0.22 - s * 0.07); }
  // the moon: one last full hit, then the music drops away and the moon just hangs there
  boom(moon, 0.7, 3.2); clank(moon, 0.1); timp(moon, N.E2, 0.3, 0);
  chord(moon, 0.5, [N.E2, N.B2, N.E3, N.Gs3, N.B3, N.E4, N.B4], 0.7, { att: 0.01, rel: 1.4, cut: 3000, send: 0.9 });
  section(moon + 0.15, pull - moon + 0.4, N.E1 + 12, 0.16, { att: 0.6, rel: 0.4, cut: 220, voices: 3, send: 0.6 });
  section(moon + 0.3, pull - moon + 0.3, N.B1 + 12, 0.06, { att: 0.8, rel: 0.4, cut: 300, voices: 3, send: 0.6 });
  glass(moon + 0.2, pull - moon + 0.9, NOTE(N.E6) * 2, 0.012, 0.3, 0.4);
  glass(moon + 0.5, pull - moon + 0.6, NOTE(N.B6) * 2, 0.007, -0.3, 0.3);
  air(moon + 0.3, pull - moon + 0.4, 0.04);
  // and a rising breath carries us back out of the lens
  swish(pull - 0.55, 1.05, 0.13, { f0: 120, f1: 8000 });
  section(pull - 0.5, 0.55, N.E3, 0.1, { att: 0.5, rel: 0.05, cut: 1500, voices: 4 });

  // 5. out of the lens: a bright held chord and a glass tone, thinning to nothing
  chord(out, 4.2, [N.A2, N.E3, N.Gs3, N.B3, N.Cs4, N.E5], 0.95, { att: 0.08, rel: 3.2, cut: 1900, send: 0.8, dyn: (x) => 1 - 0.35 * sstep(0, 4, x) });
  chord(out + 3.9, 3.6, [N.Fs2, N.Cs3, N.A3, N.B3, N.E4, N.Gs4], 0.28, { att: 1.6, rel: 3, cut: 1500, send: 0.8 });
  chord(out + 7.4, duration - out - 7.4, [N.E2, N.B2, N.Gs3, N.B3, N.Fs4, N.E5], 0.09, { att: 2.4, rel: 1.2, cut: 1300, send: 0.85, dyn: (x) => 1 - 0.5 * sstep(1, 5, x) });
  glass(out, 9.5, NOTE(N.B7), 0.012, 0.25, 0.7);
  glass(out + 0.2, 8, NOTE(N.E6) * 2, 0.006, -0.25, 0.5);
  boom(out, 0.1, 2);
  piano(title + 0.1, N.E5, 0.05, -0.2); piano(title + 0.3, N.B5, 0.035, 0.2);
  piano(title2 + 0.1, N.Gs4, 0.04, -0.2); piano(title2 + 0.32, N.E5, 0.035, 0.2);
  piano(url + 0.05, N.B4, 0.035, 0); piano(url + 0.3, N.E5, 0.03, 0.2);
  for (const c of all("pen")) if (c.t > 15) pen(c.t, c.dur, c.text ? 0.025 : 0.035, { p: rand() * 0.4 - 0.2, writing: c.text });
  air(out + 2, duration - out - 2, 0.035);

  // ------------------------------------------------------------ reverb and master

  const outB = [new Float32Array(L), new Float32Array(L)];
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round(n * SR / 44100 * 1.3)), allp = [556, 441, 341, 225].map((n) => Math.round(n * SR / 44100));
  for (let ch = 0; ch < 2; ch++) {
    const spread = ch ? 23 : 0, input = wet[ch], acc = new Float32Array(L);
    for (const len0 of combs) {
      const len = len0 + spread, buf = new Float32Array(len); let idx = 0, store = 0;
      for (let i = 0; i < L; i++) { const o = buf[idx]; store = o * 0.7 + store * 0.3; buf[idx] = input[i] * 0.015 + store * 0.91; acc[i] += o; if (++idx >= len) idx = 0; }
    }
    for (const len0 of allp) {
      const len = len0 + spread, buf = new Float32Array(len); let idx = 0;
      for (let i = 0; i < L; i++) { const b = buf[idx], o = -acc[i] + b; buf[idx] = acc[i] + b * 0.5; acc[i] = o; if (++idx >= len) idx = 0; }
    }
    for (let i = 0; i < L; i++) outB[ch][i] = dry[ch][i] + acc[i] * 1.6;
  }
  const fade0 = Math.round((duration - 0.5) * SR);
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < L; i++) {
    let v = outB[ch][i];
    if (i > fade0) v *= Math.max(0, 1 - (i - fade0) / (0.5 * SR));
    v = Math.tanh(v * 1.5) / 1.5;
    outB[ch][i] = v; peak = Math.max(peak, Math.abs(v));
  }
  const gain = 0.93 / (peak || 1);
  const pcm = Buffer.alloc(44 + L * 4);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + L * 4, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(L * 4, 40);
  for (let i = 0; i < L; i++) for (let ch = 0; ch < 2; ch++) pcm.writeInt16LE(Math.round(clamp(outB[ch][i] * gain, -1, 1) * 32767), 44 + i * 4 + ch * 2);
  await writeFile(file, pcm);
}
