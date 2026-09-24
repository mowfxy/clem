// The film's score and sound design, synthesised from scratch (no samples): an airy D♭ major pad,
// then a bright 86 BPM mallet ostinato over sub bass and light drums, breakdowns under the title
// cards, and UI sounds cued from the edit. Writes a 48 kHz stereo WAV.
import { writeFile } from "node:fs/promises";

const SR = 48000;
const BPM = 86, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4;

// D♭ major pentatonic, with C for colour.
const F = { Gb1: 46.25, Bb1: 58.27, Db2: 69.3, Gb2: 92.5, Ab2: 103.83, Bb3: 233.08, C4: 261.63, Db4: 277.18, Eb4: 311.13, F4: 349.23, Gb4: 369.99, Ab4: 415.3, Bb4: 466.16, C5: 523.25, Db5: 554.37, Eb5: 622.25, F5: 698.46, Gb5: 739.99, Ab5: 830.61, Bb5: 932.33, C6: 1046.5, Db6: 1108.73, Eb6: 1244.51, F6: 1396.91, Ab6: 1661.22 };
const CHORDS = [
  { root: F.Db2, pad: [F.Db4, F.F4, F.Ab4, F.C5, F.Eb5], arp: [F.C6, F.Ab5, F.F5, F.Ab5, F.Db6, F.Ab5, F.F5, F.Bb5] },
  { root: F.Bb1 * 2, pad: [F.Bb3, F.Db4, F.F4, F.Ab4, F.C5], arp: [F.Bb5, F.F5, F.Db5, F.F5, F.C6, F.F5, F.Db5, F.Ab5] },
  { root: F.Gb2, pad: [F.Bb3, F.Db4, F.Gb4, F.Bb4, F.F5], arp: [F.Bb5, F.Gb5, F.Db5, F.Gb5, F.Db6, F.Gb5, F.Db5, F.Bb5] },
  { root: F.Ab2, pad: [F.C4, F.Eb4, F.Ab4, F.Bb4, F.Eb5], arp: [F.C6, F.Ab5, F.Eb5, F.Ab5, F.Eb6, F.Ab5, F.Eb5, F.Bb5] },
];

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export async function score({ duration, cues, plan, file }) {
  const N = Math.ceil((duration + 1.5) * SR);
  const dry = [new Float32Array(N), new Float32Array(N)], wet = [new Float32Array(N), new Float32Array(N)], echo = [new Float32Array(N), new Float32Array(N)];
  const put = (bus, i, l, r) => { if (i >= 0 && i < N) { bus[0][i] += l; bus[1][i] += r; } };
  const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

  function voice(t, len, fn, { gain = 1, p = 0, send = 0.25, delay = 0 } = {}) {
    const [gl, gr] = pan(p), start = Math.round(t * SR), n = Math.round(len * SR);
    for (let k = 0; k < n; k++) {
      const v = fn(k / SR) * gain;
      put(dry, start + k, v * gl, v * gr);
      if (send) put(wet, start + k, v * gl * send, v * gr * send);
      if (delay) put(echo, start + k, v * gl * delay, v * gr * delay);
    }
  }
  const noise = () => rand() * 2 - 1;
  /** Mallet: warm fundamental, bright short overtones, soft attack. */
  const mallet = (t, f, g, p) => voice(t, 0.9, (x) => Math.min(1, x / 0.004) * (Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 5.5) + 0.45 * Math.sin(2 * Math.PI * f * 4 * x) * Math.exp(-x * 26) + 0.18 * Math.sin(2 * Math.PI * f * 2.01 * x) * Math.exp(-x * 11)), { gain: g, p, send: 0.22, delay: 0.3 });
  /** FM bell for sparkles and the logo. */
  const bell = (t, f, g, p, len = 2.2) => voice(t, len, (x) => Math.min(1, x / 0.002) * Math.exp(-x * 2.6) * Math.sin(2 * Math.PI * f * x + 2.2 * Math.exp(-x * 4) * Math.sin(2 * Math.PI * f * 3.5 * x)), { gain: g, p, send: 0.45, delay: 0.2 });
  function pad(t0, t1, freqs, g) {
    const len = t1 - t0 + 1.6;
    freqs.forEach((f, i) => voice(t0, len, (x) => {
      const env = Math.min(1, x / 1.1) * Math.min(1, Math.max(0, (len - x) / 1.4));
      const lfo = 1 + 0.18 * Math.sin(2 * Math.PI * (0.18 + i * 0.03) * x + i);
      let s = 0; for (const d of [-0.12, 0, 0.13]) { const ff = f * Math.pow(2, d / 12); s += Math.sin(2 * Math.PI * ff * x) + 0.22 * Math.sin(4 * Math.PI * ff * x) + 0.07 * Math.sin(6 * Math.PI * ff * x); }
      return (s / 3) * env * lfo;
    }, { gain: g / freqs.length, p: (i / (freqs.length - 1)) * 1.2 - 0.6, send: 0.6 }));
  }
  const kick = (t, g) => voice(t, 0.45, (x) => { const f = 45 + 95 * Math.exp(-x * 28); return Math.sin(2 * Math.PI * f * x - 4 * Math.exp(-x * 28)) * Math.exp(-x * 7.5) + 0.25 * noise() * Math.exp(-x * 220); }, { gain: g, send: 0.05 });
  function snap(t, g) {
    let b1 = 0, b2 = 0; // two-pole bandpass around 1.9 kHz
    const w = 2 * Math.PI * 1900 / SR, q = 0.9, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
    let x1 = 0, x2 = 0;
    voice(t, 0.3, (x) => { const inp = noise() * (Math.exp(-x * 32) + 0.4 * Math.exp(-x * 90) * (x > 0.012 ? 1 : 0)); const y = (a * inp - a * x2 + 2 * c * b1 - (1 - a) * b2) / a0; x2 = x1; x1 = inp; b2 = b1; b1 = y; return y * 2.2 + 0.3 * Math.sin(2 * Math.PI * 210 * x) * Math.exp(-x * 40); }, { gain: g, send: 0.3, p: 0.05 });
  }
  function hat(t, g, p = 0.25) { let prev = 0; voice(t, 0.08, (x) => { const n = noise(), y = n - prev; prev = n; return y * Math.exp(-x * 70); }, { gain: g, p, send: 0.1 }); }
  const sub = (t, len, f, g) => voice(t, len + 0.1, (x) => Math.sin(2 * Math.PI * f * x) * Math.min(1, x / 0.02) * Math.min(1, Math.max(0, (len + 0.1 - x) / 0.12)) * (1 - 0.25 * Math.exp(-x * 6)), { gain: g, send: 0 });
  function whoosh(t, g, len = 0.7, up = true) {
    let lp = 0, lp2 = 0;
    voice(t, len, (x) => { const k = x / len, cut = up ? 0.02 + 0.25 * k : 0.27 - 0.25 * k; lp += cut * (noise() - lp); lp2 += cut * (lp - lp2); return (lp - lp2 * 0.6) * Math.sin(Math.PI * k) * 1.8; }, { gain: g, send: 0.4, p: up ? -0.3 : 0.3 });
  }

  // ---- music ----
  const block = (id) => plan.find((b) => b.id === id);
  const intro = block("intro"), end = plan.find((b) => b.id === "end");
  const main0 = intro.start + intro.dur, main1 = end.start;
  const breaks = plan.filter((b) => b.kind === "title" && b.id !== "intro" && b.id !== "end");
  const inBreak = (t) => breaks.some((b) => t >= b.start + 0.05 && t < b.start + b.dur - 0.05);

  // Intro: the pad breathes in, bells answer the chips.
  pad(0, main0, CHORDS[0].pad, 0.34);
  [F.Ab5, F.C6, F.Db6, F.Eb6, F.F6].forEach((f, i) => bell(0.35 + i * 0.55, f, 0.07, i % 2 ? 0.4 : -0.4, 2.8));
  whoosh(main0 - 0.9, 0.18, 0.9, true);

  // Main groove, on a bar grid starting where the footage starts.
  for (let bar = 0, t = main0; t < main1 - 0.01; bar++, t += BAR) {
    const ch = CHORDS[bar % 4];
    pad(t, Math.min(t + BAR, main1), ch.pad, 0.2);
    for (let s = 0; s < 16; s++) {
      const ts = t + s * S16; if (ts >= main1) break;
      const br = inBreak(ts);
      const f = ch.arp[s % 8], accent = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.78 : 0.6;
      mallet(ts, f, (br ? 0.05 : 0.085) * accent, s % 2 ? 0.35 : -0.35);
      if (!br) {
        if (s % 2 === 0) hat(ts + (s % 4 === 2 ? 0.012 : 0), s % 4 === 2 ? 0.05 : 0.03);
        if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) kick(ts, 0.62);
        if (s === 4 || s === 12) snap(ts, 0.2);
        if (s % 4 === 0) sub(ts, S16 * 3.4, ch.root, 0.3);
      }
    }
    // A bell phrase every other bar for a top line.
    if (bar % 2 === 1) [F.Db6, F.C6, F.Ab5].forEach((f, i) => bell(t + BEAT * (2 + i * 0.5), f, 0.035, 0.5 - i * 0.5, 1.6));
  }
  for (const b of breaks) whoosh(b.start + b.dur - 0.85, 0.2, 0.85, true);

  // Ending: the groove stops, the chord opens, the logo lands.
  pad(main1, duration + 1, [F.Db4, F.Ab4, F.C5, F.Eb5, F.F5], 0.36);
  sub(main1, 2.4, F.Db2, 0.28);
  kick(main1, 0.5);

  // ---- sound design ----
  for (const c of cues) {
    const t = c.t;
    if (c.kind === "click") { hat(t, 0.08, 0); voice(t, 0.05, (x) => Math.sin(2 * Math.PI * 2400 * x) * Math.exp(-x * 120), { gain: 0.05, send: 0.05 }); }
    else if (c.kind === "type") hat(t, 0.028, (rand() - 0.5) * 0.4);
    else if (c.kind === "tick") mallet(t, F.Db6, 0.07, 0);
    else if (c.kind === "pop") { voice(t, 0.14, (x) => Math.sin(2 * Math.PI * (320 + 700 * Math.exp(-x * 40)) * x) * Math.exp(-x * 30), { gain: 0.16, send: 0.2 }); bell(t + 0.02, [F.C6, F.Eb6, F.F6][Math.floor(rand() * 3)], 0.04, 0, 1.2); }
    else if (c.kind === "whoosh") whoosh(t - 0.25, 0.22, 0.6, false);
    else if (c.kind === "whoosh-soft") whoosh(t - 0.1, 0.1, 0.5, true);
    else if (c.kind === "confirm") { mallet(t, F.Ab5, 0.1, -0.2); mallet(t + 0.11, F.Db6, 0.12, 0.2); }
    else if (c.kind === "sweep") [F.Ab5, F.Bb5, F.C6, F.Db6, F.Eb6, F.F6].forEach((f, i) => bell(t + i * 0.06, f, 0.03, i / 3 - 0.8, 1.4));
    else if (c.kind === "burst") { voice(t, 0.2, (x) => Math.sin(2 * Math.PI * (260 + 900 * Math.exp(-x * 30)) * x) * Math.exp(-x * 18), { gain: 0.22, send: 0.3 }); for (let i = 0; i < 9; i++) bell(t + 0.03 + i * 0.035, [F.Db6, F.Eb6, F.F6, F.Ab6, F.C6][i % 5], 0.035, (rand() - 0.5) * 1.6, 1.3); whoosh(t, 0.12, 0.8, false); }
    else if (c.kind === "lift") { voice(t, 0.3, (x) => Math.sin(2 * Math.PI * (500 + 500 * x / 0.3) * x) * Math.exp(-x * 9), { gain: 0.08, send: 0.3 }); }
    else if (c.kind === "logo") { kick(t, 0.55); voice(t, 2.5, (x) => Math.sin(2 * Math.PI * 49 * x) * Math.exp(-x * 1.6), { gain: 0.35, send: 0.1 }); [F.Db5, F.Ab5, F.C6, F.F6].forEach((f, i) => bell(t + i * 0.015, f, 0.06, i / 2 - 0.75, 3.4)); }
  }

  // ---- effects: ping-pong dotted-eighth echo, then a Freeverb-style room ----
  const dly = Math.round(BEAT * 0.75 * SR);
  for (let i = dly; i < N; i++) { echo[0][i] += echo[1][i - dly] * 0.38; echo[1][i] += echo[0][i - dly] * 0.38; }
  for (let i = 0; i < N; i++) { dry[0][i] += echo[0][i] * 0.55; dry[1][i] += echo[1][i] * 0.55; wet[0][i] += echo[0][i] * 0.15; wet[1][i] += echo[1][i] * 0.15; }
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round(n * SR / 44100)), allp = [556, 441, 341, 225].map((n) => Math.round(n * SR / 44100));
  for (let ch = 0; ch < 2; ch++) {
    const input = wet[ch], out = new Float32Array(N), spread = ch ? 23 : 0;
    for (const len0 of combs) {
      const len = len0 + spread, buf = new Float32Array(len); let idx = 0, store = 0;
      for (let i = 0; i < N; i++) { const y = buf[idx]; store = y * 0.72 + store * 0.28; buf[idx] = input[i] * 0.015 + store * 0.86; idx = (idx + 1) % len; out[i] += y; }
    }
    for (const len0 of allp) {
      const len = len0 + spread, buf = new Float32Array(len); let idx = 0;
      for (let i = 0; i < N; i++) { const b = buf[idx], y = -out[i] + b; buf[idx] = out[i] + b * 0.5; idx = (idx + 1) % len; out[i] = y; }
    }
    for (let i = 0; i < N; i++) dry[ch][i] += out[i] * 0.9;
  }

  // ---- master: gentle saturation, fade, normalise ----
  let peak = 0;
  const fadeFrom = Math.round((duration - 1.2) * SR), stop = Math.round((duration + 0.4) * SR);
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < N; i++) {
    let v = Math.tanh(dry[ch][i] * 1.25);
    if (i > fadeFrom) v *= Math.max(0, 1 - (i - fadeFrom) / (stop - fadeFrom));
    dry[ch][i] = v; peak = Math.max(peak, Math.abs(v));
  }
  // Peak-normalise, then sit about 4 dB lower so the mix breathes like the reference (≈ −17 dB mean).
  const g = 0.6 / (peak || 1);
  const pcm = Buffer.alloc(44 + N * 4);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, dry[0][i] * g)) * 32767), 44 + i * 4); pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, dry[1][i] * g)) * 32767), 46 + i * 4); }
  await writeFile(file, pcm);
}
