// More subjects for the lens, and the "live" painters that animate plates while they are on screen:
// butterflies, snow crystals, tree rings, a music score, a turning DNA helix, a swinging pendulum,
// a galaxy, current running through the circuit, drifting radiolarians, particle tracks being
// drawn and planets moving round the orrery.

const META = {};
const LIVE = {};

// ---------------------------------------------------------------- butterflies

const BUTTERFLY_KINDS = [
  { base: "#e8892c", edge: "#1d140f", spots: "#fff6e0", vein: "#2a1a10", fore: 1, hind: 0.8 },        // monarch
  { base: "#3f7fd6", edge: "#0f1a33", spots: "#c9e3ff", vein: "#132447", fore: 1.05, hind: 0.9, iri: "#8fd0ff" }, // morpho
  { base: "#f0d64a", edge: "#1e1a10", spots: "#f7efc0", vein: "#2b2512", fore: 1, hind: 0.95, tail: true },     // swallowtail
  { base: "#f4f0e6", edge: "#3a3a3a", spots: "#e3a03a", vein: "#6a6a6a", fore: 0.9, hind: 0.75 },              // white
  { base: "#c0402e", edge: "#1a0e0c", spots: "#f3e3d0", vein: "#2a1410", fore: 0.95, hind: 0.85 },             // admiral
];
/** Draws one butterfly centred at (0, 0), wings spread, facing up; open = 0..1 wing opening. */
function butterfly(x, kind, size, open = 1, seed = 1) {
  const K = BUTTERFLY_KINDS[kind], r = RNG(seed);
  x.save(); x.scale(size / 100, size / 100);
  for (const side of [-1, 1]) {
    x.save(); x.scale(side * (0.15 + 0.85 * open), 1);
    // hind wing then fore wing
    const hind = new Path2D(); hind.moveTo(4, 6); hind.bezierCurveTo(30, 4, 62 * K.hind, 22, 58 * K.hind, 52); hind.bezierCurveTo(52 * K.hind, 74, 26, 78, 10, 60);
    if (K.tail) { hind.lineTo(14, 92); hind.lineTo(6, 62); }
    hind.closePath();
    const fore = new Path2D(); fore.moveTo(4, 2); fore.bezierCurveTo(30, -40, 80 * K.fore, -70, 96 * K.fore, -58); fore.bezierCurveTo(100 * K.fore, -36, 70, -6, 50, 8); fore.bezierCurveTo(30, 14, 12, 10, 4, 2); fore.closePath();
    for (const w of [hind, fore]) {
      const g = x.createRadialGradient(8, 0, 4, 20, -10, 100);
      g.addColorStop(0, K.iri || K.base); g.addColorStop(0.55, K.base); g.addColorStop(0.85, K.edge); g.addColorStop(1, K.edge);
      x.fillStyle = g; x.fill(w);
      x.save(); x.clip(w);
      x.strokeStyle = K.vein; x.globalAlpha = 0.55; x.lineWidth = 1.4;
      for (let k = 0; k < 7; k++) { const a = -1.5 + k * 0.42; x.beginPath(); x.moveTo(6, 2); x.quadraticCurveTo(40 * Math.cos(a + 0.2), 40 * Math.sin(a + 0.2), 110 * Math.cos(a), 110 * Math.sin(a)); x.stroke(); }
      x.globalAlpha = 1;
      x.fillStyle = K.spots;
      for (let k = 0; k < 9; k++) { const a = -1.4 + k * 0.33 + r.range(-0.05, 0.05), d = w === fore ? 82 : 52; x.beginPath(); x.arc(Math.cos(a) * d * (w === fore ? 1 : 1.05) + 6, Math.sin(a) * d * (w === fore ? 0.78 : 1) + (w === fore ? -6 : 8), r.range(1.6, 3.4), 0, TAU); x.fill(); }
      x.restore();
      x.strokeStyle = K.edge; x.lineWidth = 1.6; x.stroke(w);
    }
    x.restore();
  }
  // body and antennae
  x.fillStyle = "#1f1712";
  x.beginPath(); x.ellipse(0, 10, 5, 34, 0, 0, TAU); x.fill();
  x.beginPath(); x.arc(0, -26, 6, 0, TAU); x.fill();
  x.strokeStyle = "#1f1712"; x.lineWidth = 1.6;
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0, -30); x.quadraticCurveTo(s * 12, -60, s * 22, -72); x.stroke(); x.beginPath(); x.arc(s * 22, -72, 2.6, 0, TAU); x.fill(); }
  x.restore();
}
function plateButterflies() {
  const W = 2400, H = 2048, c = paper(W, H, [0.945, 0.93, 0.885], { seed: 33 }), x = c.getContext("2d"), r = RNG(19);
  const names = ["Danaus plexippus", "Morpho menelaus", "Papilio machaon", "Pieris brassicae", "Vanessa atalanta"];
  const cells = [[520, 520], [1200, 470], [1880, 540], [760, 1180], [1500, 1150], [2050, 1240], [480, 1720], [1180, 1760], [1880, 1800]];
  cells.forEach(([px, py], i) => {
    const kind = i % 5;
    x.save(); x.translate(px, py); x.rotate(r.range(-0.12, 0.12));
    x.shadowColor = "rgba(40,30,20,.25)"; x.shadowBlur = 18; x.shadowOffsetY = 10;
    butterfly(x, kind, r.range(230, 300), 1, i + 3);
    x.restore();
    // a pin and a label
    x.fillStyle = "#3a3a40"; x.beginPath(); x.arc(px, py - 8, 5, 0, TAU); x.fill();
    caption(x, names[kind], px - 170, py + 250, 44);
  });
  caption(x, "Lepidoptera", 980, 170, 96);
  PLATES.butterflies = printify(c, { soft: 0.9, grain: 0.08, seed: 12 });
}
// a live butterfly crossing the herbal (plate coordinates)
LIVE.herbal = (x, lt) => {
  const k = lt / 2.0, px = lerp(900, 2500, k), py = 980 - 520 * k + 70 * Math.sin(k * 9);
  const flap = Math.abs(Math.cos(lt * 2 * Math.PI * 7.5));
  x.save(); x.translate(px, py); x.rotate(0.9 + 0.2 * Math.sin(lt * 5));
  x.shadowColor = "rgba(40,30,20,.25)"; x.shadowBlur = 20; x.shadowOffsetY = 26;
  butterfly(x, 0, 150, 0.2 + 0.8 * flap, 9);
  x.restore();
};

// ---------------------------------------------------------------- snow crystals

function snowArm(x, len, depth, r) {
  x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -len); x.stroke();
  if (depth <= 0) return;
  const n = 4 + depth;
  for (let i = 1; i < n; i++) {
    const at = (i / n) * len, bl = len * (0.42 - 0.3 * (i / n)) * r.range(0.8, 1.1);
    for (const s of [-1, 1]) { x.save(); x.translate(0, -at); x.rotate(s * Math.PI / 3); x.lineWidth *= 0.7; snowArm(x, bl, depth - 1, r); x.restore(); }
  }
}
function crystal(x, cx, cy, R, seed) {
  const r = RNG(seed), r2 = RNG(seed);
  x.save(); x.translate(cx, cy);
  for (let k = 0; k < 6; k++) {
    x.save(); x.rotate(k * Math.PI / 3);
    const rr = RNG(seed);             // identical arms: six-fold symmetry
    x.lineWidth = R * 0.05; x.lineCap = "round"; x.strokeStyle = "rgba(235,242,255,.95)";
    x.shadowColor = "rgba(160,200,255,.8)"; x.shadowBlur = R * 0.04;
    snowArm(x, R, 2, rr);
    x.restore();
  }
  // central plate with etched hexagons
  for (let k = 3; k >= 1; k--) {
    x.beginPath(); for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6, d = R * 0.12 * k; i ? x.lineTo(Math.cos(a) * d, Math.sin(a) * d) : x.moveTo(Math.cos(a) * d, Math.sin(a) * d); }
    x.fillStyle = `rgba(200,220,255,${0.08 * k})`; x.fill(); x.strokeStyle = "rgba(240,246,255,.8)"; x.lineWidth = 2; x.stroke();
  }
  x.restore();
  void r; void r2;
}
function plateSnow() {
  const W = 2048, H = 2048, c = canvas(W, H), x = c.getContext("2d");
  const g = x.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7); g.addColorStop(0, "#1a2333"); g.addColorStop(1, "#05070b");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  crystal(x, W / 2, H / 2, 640, 4);
  x.globalAlpha = 0.5; crystal(x, 260, 300, 200, 9); crystal(x, 1820, 1700, 260, 14); x.globalAlpha = 1;
  PLATES.snow = c;
}
LIVE.snow = (x, lt) => {
  // drifting specks of frost catching the light
  const r = RNG(5);
  for (let i = 0; i < 80; i++) { const px = r() * 2048 + lt * 60 * r.range(-1, 1), py = r() * 2048 + lt * 90; x.beginPath(); x.arc(px, py % 2048, r.range(1.5, 4), 0, TAU); x.fillStyle = `rgba(220,235,255,${r.range(0.15, 0.6)})`; x.fill(); }
};

// ---------------------------------------------------------------- tree rings

const RINGS_FS = `
uniform vec2 res;
void main(){
  vec2 px = uv * res, p = (px - res * vec2(.42, .55)) / res.y;
  float r = length(p * vec2(1., 1.08)) + .015 * fbm(p * 6.) + .006 * fbm(p * 30.);
  float th = atan(p.y, p.x);
  // annual rings: uneven widths, dark latewood
  float yr = r * 70. + 2.2 * fbm(vec2(r * 3., 1.));
  float f = fract(yr);
  float late = smoothstep(.55, .95, f) * (1. - smoothstep(.95, 1., f));
  vec3 early = vec3(.86, .7, .5), lateC = vec3(.55, .36, .2);
  vec3 c = mix(early, lateC, late * .85);
  c *= .92 + .08 * fbm(vec2(th * 40., r * 8.));                        // rays
  c = mix(c, lateC * .8, smoothstep(.02, .0, abs(fract(th * 12. / TAU + .2 * fbm(p * 3.)) - .5) - .48) * .25);
  // heart and bark
  c = mix(vec3(.45, .28, .15), c, smoothstep(.01, .03, r));
  float bark = smoothstep(.46, .48, r);
  c = mix(c, vec3(.3, .2, .14) * (.7 + .5 * fbm(vec2(th * 30., r * 60.))), bark);
  c = mix(c, vec3(.12, .1, .09), smoothstep(.56, .58, r));
  // a crack
  float crack = abs(th - .6 - .1 * fbm(p * 8.)) ;
  c = mix(c, vec3(.18, .1, .06), smoothstep(.012, .0, crack) * smoothstep(.05, .2, r) * smoothstep(.45, .3, r));
  c *= .95 + .05 * vnoise(px / 1.6);
  o = vec4(c, 1);
}`;

// ---------------------------------------------------------------- a music score

function plateMusic() {
  const W = 4200, H = 2048, c = paper(W, H, [0.94, 0.915, 0.86], { seed: 41, age: 1.2 }), x = c.getContext("2d"), r = RNG(8);
  const ink = "#241c16";
  x.strokeStyle = ink; x.fillStyle = ink;
  const staffs = [380, 900, 1420];
  for (const y0 of staffs) {
    for (let l = 0; l < 5; l++) { x.beginPath(); x.moveTo(140, y0 + l * 34); x.lineTo(W - 140, y0 + l * 34); x.lineWidth = 2.6; x.stroke(); }
    x.font = "260px 'Segoe UI Symbol'"; x.fillText("𝄞", 150, y0 + 172);
    x.font = "bold 120px 'Baskerville Old Face'"; x.fillText("3", 330, y0 + 68); x.fillText("4", 330, y0 + 136);
    let px = 470, bar = 0;
    while (px < W - 260) {
      const group = r.int(1, 3);
      const notes = [];
      for (let g = 0; g < group; g++) notes.push({ x: px + g * 70, step: r.int(-2, 9) });
      const beamed = group > 1;
      for (const n of notes) {
        const ny = y0 + 136 - n.step * 17;
        x.save(); x.translate(n.x, ny); x.rotate(-0.35); x.beginPath(); x.ellipse(0, 0, 21, 14, 0, 0, TAU); x.fill(); x.restore();
        x.lineWidth = 3.4; x.beginPath(); x.moveTo(n.x + 19, ny - 4); x.lineTo(n.x + 19, y0 - 30 + (beamed ? 0 : 20)); x.stroke();
        // ledger lines
        for (let s = n.step; s < -1; s++) if (s % 2 === 0) { x.beginPath(); x.moveTo(n.x - 32, y0 + 136 - s * 17); x.lineTo(n.x + 32, y0 + 136 - s * 17); x.stroke(); }
        if (n.step > 9) for (let s = 10; s <= n.step; s += 2) { x.beginPath(); x.moveTo(n.x - 32, y0 + 136 - s * 17); x.lineTo(n.x + 32, y0 + 136 - s * 17); x.stroke(); }
      }
      if (beamed) { x.lineWidth = 12; x.beginPath(); x.moveTo(notes[0].x + 19, y0 - 30); x.lineTo(notes[notes.length - 1].x + 19, y0 - 30); x.stroke(); }
      else { x.lineWidth = 3; x.beginPath(); x.moveTo(notes[0].x + 19, y0 - 10); x.quadraticCurveTo(notes[0].x + 50, y0 + 20, notes[0].x + 44, y0 + 50); x.stroke(); }
      px += group * 70 + 90;
      if (++bar % 3 === 0) { x.lineWidth = 3; x.beginPath(); x.moveTo(px - 50, y0); x.lineTo(px - 50, y0 + 136); x.stroke(); }
    }
    // a slur across the line
    x.lineWidth = 3; x.beginPath(); x.moveTo(600, y0 - 70); x.bezierCurveTo(1200, y0 - 180, 1900, y0 - 180, 2400, y0 - 70); x.stroke();
  }
  x.font = "italic 70px 'Baskerville Old Face'"; x.fillText("Andante con moto", 160, 230);
  x.font = "60px 'Baskerville Old Face'"; x.fillText("p", 520, 640); x.fillText("cresc.", 1500, 1160); x.fillText("f", 2900, 1680);
  PLATES.music = printify(c, { soft: 1.1, grain: 0.1, seed: 13 });
}

// ---------------------------------------------------------------- live painters on paper

/** A DNA double helix turning, drawn like an engraved textbook figure. */
LIVE.dna = (x, lt, t) => {
  const W = SCENE, cx = W / 2, top = -120, bottom = W + 120, amp = 230, turns = 2.4, phase = t * 2.4;
  const pairs = ["#d9473e", "#2f6cc0", "#e6b63a", "#3c8a5a"];
  const pts = (off) => { const out = []; for (let i = 0; i <= 160; i++) { const k = i / 160, a = k * turns * TAU + phase + off; out.push([cx + Math.sin(a) * amp, lerp(top, bottom, k), Math.cos(a)]); } return out; };
  const A = pts(0), B = pts(Math.PI * 0.8);
  // rungs behind first, then strands by depth
  const rungs = [];
  for (let i = 4; i < 160; i += 6) rungs.push([A[i], B[i], pairs[(i / 6 | 0) % 4], (A[i][2] + B[i][2]) / 2]);
  rungs.sort((a, b) => a[3] - b[3]);
  const strand = (S, front) => {
    for (let i = 1; i < S.length; i++) { const z = (S[i][2] + 1) / 2; if (front ? z < 0.5 : z >= 0.5) continue; x.beginPath(); x.moveTo(S[i - 1][0], S[i - 1][1]); x.lineTo(S[i][0], S[i][1]); x.lineWidth = 16 + 10 * z; x.strokeStyle = "#16224a"; x.globalAlpha = 0.45 + 0.55 * z; x.stroke(); x.lineWidth = 8 + 6 * z; x.strokeStyle = "#e9e3d6"; x.stroke(); }
    x.globalAlpha = 1;
  };
  x.lineCap = "round";
  strand(A, false); strand(B, false);
  for (const [a, b, col, z] of rungs) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; x.globalAlpha = 0.55 + 0.45 * (z + 1) / 2; x.lineWidth = 10; x.strokeStyle = col; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(m[0], m[1]); x.stroke(); x.strokeStyle = pairs[(pairs.indexOf(col) + 2) % 4]; x.beginPath(); x.moveTo(m[0], m[1]); x.lineTo(b[0], b[1]); x.stroke(); }
  x.globalAlpha = 1;
  strand(A, true); strand(B, true);
  x.font = "italic 50px 'Baskerville Old Face'"; x.fillStyle = "#2a1f16"; x.fillText("acidum deoxyribonucleicum", 120, W - 110);
};
/** Mowr's own kind of visual: a pendulum swinging, with its trace drawn out beside it. */
LIVE.pendulum = (x, lt, t) => {
  const W = SCENE, px0 = W * 0.4, py0 = 250, L = 470, th0 = 0.55, w = 4.2;
  // graph paper
  x.strokeStyle = "rgba(60,110,170,.18)"; x.lineWidth = 1;
  for (let g = 0; g < W; g += 36) { x.beginPath(); x.moveTo(g, 0); x.lineTo(g, W); x.stroke(); x.beginPath(); x.moveTo(0, g); x.lineTo(W, g); x.stroke(); }
  const th = th0 * Math.cos(w * t), bx = px0 + Math.sin(th) * L, by = py0 + Math.cos(th) * L;
  // swept arc and the plotted wave
  x.strokeStyle = "rgba(22,34,74,.35)"; x.setLineDash([10, 10]); x.lineWidth = 3; x.beginPath(); x.arc(px0, py0, L, Math.PI / 2 - th0, Math.PI / 2 + th0); x.stroke(); x.setLineDash([]);
  x.strokeStyle = "#d9473e"; x.lineWidth = 6; x.beginPath();
  for (let i = 0; i <= 200; i++) { const k = i / 200, tt = t - k * 1.6, yy = 960 + Math.sin(th0 * Math.cos(w * tt)) * L * 0.42; const xx = px0 + 60 + k * (W - px0 - 260); i ? x.lineTo(xx, yy) : x.moveTo(xx, yy); }
  x.stroke();
  x.strokeStyle = "#16224a"; x.lineWidth = 2; x.beginPath(); x.moveTo(px0 + 30, 960); x.lineTo(W - 160, 960); x.stroke();
  x.lineWidth = 5; x.beginPath(); x.moveTo(px0, py0); x.lineTo(bx, by); x.stroke();
  x.fillStyle = "#16224a"; x.fillRect(px0 - 120, py0 - 18, 240, 18);
  const g = x.createRadialGradient(bx - 18, by - 18, 4, bx, by, 54); g.addColorStop(0, "#f6efe0"); g.addColorStop(0.5, "#d9473e"); g.addColorStop(1, "#6e1d18");
  x.beginPath(); x.arc(bx, by, 54, 0, TAU); x.fillStyle = g; x.fill(); x.lineWidth = 3; x.stroke();
  x.font = "64px MowafySerif"; x.fillStyle = "#16224a"; x.fillText("θ(t) = θ₀ cos ωt", 200, W - 170);
};
LIVE.lattice = (x, lt, t) => paintLattice(x.canvas, t);

// ---------------------------------------------------------------- galaxy (live shader)

const GALAXY_FS = `
uniform vec2 res; uniform float time, zoom;
void main(){
  vec2 p = (uv - .5) * 1.2 * zoom;
  p = mat2(1, 0, 0, 1.6) * p;                       // seen at a tilt
  float r = length(p), a = atan(p.y, p.x) + time * .25;
  float arms = .5 + .5 * cos(2. * (a - 3.2 * log(r + .02)) );
  arms = pow(arms, 3.) * smoothstep(.75, .1, r);
  float dust = fbm(vec2(a * 3., log(r + .02) * 9.) + 3.);
  float core = exp(-r * 14.) * 1.4 + exp(-r * 4.) * .3;
  vec3 c = vec3(.75, .82, 1.) * arms * (.6 + .6 * dust) + vec3(1., .86, .62) * core;
  c *= 1. - .5 * smoothstep(.0, .6, -dust) * arms;
  vec2 g = uv * res / 3.;
  float star = step(.996, hash12(floor(g))) * (.5 + .5 * sin(time * 6. + hash12(floor(g) + 7.) * 40.));
  c += vec3(star);
  c += vec3(.9, .95, 1.) * step(.9992, hash12(floor(uv * res / 2.) + 3.)) * 1.5;
  o = vec4(c, 1);
}`;

// ---------------------------------------------------------------- live layers over baked plates

LIVE.circuit = (x, lt) => {
  // current: bright pulses racing along the traces
  const T = META.circuit, r = RNG(17);
  x.save(); x.globalCompositeOperation = "lighter";
  for (let k = 0; k < 70; k++) {
    const tr = T[r.int(0, T.length - 1)], speed = r.range(0.6, 1.4), off = r();
    const len = tr.len, pos = ((off + lt * speed * 900 / len) % 1) * len;
    let acc = 0;
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1], b = tr.pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= pos) { const u = (pos - acc) / d, px = lerp(a[0], b[0], u), py = lerp(a[1], b[1], u); const g = x.createRadialGradient(px, py, 0, px, py, 34); g.addColorStop(0, "rgba(255,250,235,.95)"); g.addColorStop(0.3, "rgba(150,170,255,.55)"); g.addColorStop(1, "rgba(120,110,255,0)"); x.fillStyle = g; x.fillRect(px - 34, py - 34, 68, 68); break; }
      acc += d;
    }
  }
  x.restore();
};
LIVE.radiolaria = (x, lt) => {
  for (const s of META.radiolaria) {
    const dx = Math.sin(lt * s.sp + s.ph) * 26 + lt * s.vx, dy = Math.cos(lt * s.sp * 0.8 + s.ph) * 20 + lt * s.vy;
    x.save(); x.translate(s.x + dx, s.y + dy); x.rotate(s.rot + lt * s.spin);
    x.drawImage(s.c, -s.c.width / 2, -s.c.height / 2);
    x.restore();
  }
};
LIVE.bubble = (x, lt) => {
  const B = META.bubble;
  x.save(); x.beginPath(); x.arc(B.cx, B.cy, B.R, 0, TAU); x.clip();
  x.lineCap = "round";
  for (const tr of B.tracks) {
    const p = clamp((lt - tr.delay) / tr.dur);
    if (p <= 0) continue;
    const n = Math.max(2, Math.floor(tr.pts.length * p));
    x.beginPath(); for (let i = 0; i < n; i++) i ? x.lineTo(...tr.pts[i]) : x.moveTo(...tr.pts[i]);
    x.shadowColor = "rgba(255,255,255,.8)"; x.shadowBlur = 6; x.strokeStyle = `rgba(240,240,236,${tr.a})`; x.lineWidth = tr.w; x.stroke();
    if (p < 1) { const h = tr.pts[n - 1]; x.beginPath(); x.arc(h[0], h[1], 5, 0, TAU); x.fillStyle = "rgba(255,255,255,.9)"; x.fill(); }
  }
  x.restore();
};
LIVE.orrery = (x, lt, t) => {
  const O = META.orrery;
  O.orbits.forEach((o, i) => {
    const a = O.a0[i] + t * O.w[i], px = O.cx + Math.cos(a) * o, py = O.cy + Math.sin(a) * o * O.tilt, pr = O.size[i];
    const g = x.createRadialGradient(px - pr * 0.4, py - pr * 0.4, 1, px, py, pr);
    g.addColorStop(0, "#f6efe0"); g.addColorStop(0.6, O.col[i]); g.addColorStop(1, "#2a2018");
    x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fillStyle = g; x.fill(); x.lineWidth = 1.5; x.strokeStyle = "#2f241b"; x.stroke();
    if (i === 5) { x.beginPath(); x.ellipse(px, py, pr * 2, pr * 0.6, -0.3, 0, TAU); x.lineWidth = 3; x.stroke(); }
  });
};
LIVE.stars = (x, lt, t) => {
  // a few stars flare as the atlas turns
  const r = RNG(3);
  for (let i = 0; i < 40; i++) { const px = r.range(200, 2000), py = r.range(200, 2000), f = Math.max(0, Math.sin(t * r.range(3, 7) + i)); if (f < 0.6) continue; const g = x.createRadialGradient(px, py, 0, px, py, 30); g.addColorStop(0, `rgba(255,220,150,${(f - 0.6) * 1.5})`); g.addColorStop(1, "rgba(255,220,150,0)"); x.fillStyle = g; x.fillRect(px - 30, py - 30, 60, 60); }
};

function newPlates() {
  plateButterflies(); plateSnow(); plateMusic();
  PLATES.rings = bake(RINGS_FS, 2048, 2048);
  PLATES.paperA = paper(1600, 1600, [0.945, 0.925, 0.87], { seed: 51 });
  PLATES.paperB = paper(1600, 1600, [0.95, 0.94, 0.9], { seed: 52, age: 0.4 });
}
