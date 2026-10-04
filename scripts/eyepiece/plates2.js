// More plates: a circuit board, radiolarians on a slide, a bubble-chamber photograph, Euclid's
// construction, a star atlas and an orrery.

// ---------------------------------------------------------------- circuit

function plateCircuit() {
  const W = 2400, H = 2048, c = canvas(W, H), x = c.getContext("2d"), r = RNG(31);
  x.fillStyle = "#ddd2ee"; x.fillRect(0, 0, W, H);
  const G = 24, cols = Math.floor(W / G), rows = Math.floor(H / G), used = new Uint8Array(cols * rows);
  const busy = (i, j, rad) => { for (let v = -rad; v <= rad; v++) for (let u = -rad; u <= rad; u++) { const a = i + u, b = j + v; if (a < 1 || b < 1 || a >= cols - 1 || b >= rows - 1 || used[b * cols + a]) return true; } return false; };
  const mark = (i, j, rad) => { for (let v = -rad; v <= rad; v++) for (let u = -rad; u <= rad; u++) { const a = i + u, b = j + v; if (a >= 0 && b >= 0 && a < cols && b < rows) used[b * cols + a] = 1; } };
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const traces = [];
  for (let b = 0; b < 500; b++) {
    const n = r() < 0.7 ? r.int(2, 7) : 1, rad = Math.ceil(n * 0.4);
    let i = r.int(4, cols - 5), j = r.int(4, rows - 5), d = r.int(0, 3) * 2;
    if (busy(i, j, rad)) continue;
    const pts = [[i, j]];
    for (let s = 0; s < 12; s++) {
      const len = r.int(4, 18); let moved = 0;
      for (let k = 0; k < len; k++) { const ni = i + dirs[d][0], nj = j + dirs[d][1]; if (busy(ni + dirs[d][0] * rad, nj + dirs[d][1] * rad, rad)) break; mark(i, j, rad); i = ni; j = nj; moved++; }
      if (moved) pts.push([i, j]); else if (s > 2) break;
      d = (d + r.pick([1, -1, 1, -1, 2, -2]) + 8) % 8;
    }
    mark(i, j, rad);
    if (pts.length > 2) traces.push({ pts, n });
  }
  const offset = (pts, o) => {
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[k], cc = pts[Math.min(pts.length - 1, k + 1)];
      let n1 = [-(b[1] - a[1]), b[0] - a[0]], n2 = [-(cc[1] - b[1]), cc[0] - b[0]];
      const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1; n1 = [n1[0] / l1, n1[1] / l1]; n2 = [n2[0] / l2, n2[1] / l2];
      if (k === 0) n1 = n2; if (k === pts.length - 1) n2 = n1;
      let m = [n1[0] + n2[0], n1[1] + n2[1]]; const ml = Math.hypot(...m) || 1; m = [m[0] / ml, m[1] / ml];
      const sc = 1 / Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]);
      out.push([(b[0] + m[0] * o * sc) * G + G / 2, (b[1] + m[1] * o * sc) * G + G / 2]);
    }
    return out;
  };
  x.lineJoin = "miter"; x.lineCap = "round";
  const ink = "#5b52b6";
  META.circuit = [];
  for (const t of traces) for (let m = 0; m < t.n; m++) {
    const pts = offset(t.pts, (m - (t.n - 1) / 2) * 0.75);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    META.circuit.push({ pts, len });
    x.strokeStyle = ink; x.lineWidth = 6; x.stroke(polyPath(pts, false));
    for (const e of [pts[0], pts[pts.length - 1]]) { x.beginPath(); x.arc(e[0], e[1], 8, 0, TAU); x.fillStyle = ink; x.fill(); x.beginPath(); x.arc(e[0], e[1], 3.5, 0, TAU); x.fillStyle = "#f2ecf8"; x.fill(); }
  }
  // chips: pin rows
  for (let k = 0; k < 7; k++) {
    const cx = r.range(200, W - 200), cy = r.range(200, H - 200), pins = r.int(6, 14), vertical = r() < 0.5;
    for (let p = 0; p < pins; p++) for (const s of [-1, 1]) {
      const px = vertical ? cx + s * 70 : cx + (p - pins / 2) * 26, py = vertical ? cy + (p - pins / 2) * 26 : cy + s * 70;
      x.fillStyle = ink; x.fillRect(px - 9, py - 6, 18, 12);
    }
  }
  // vias
  for (let k = 0; k < 400; k++) { const vx = r.int(0, cols) * G + G / 2, vy = r.int(0, rows) * G + G / 2; x.beginPath(); x.arc(vx, vy, 5.5, 0, TAU); x.fillStyle = "#3c357f"; x.fill(); }
  // dark dotted header rows like the reference
  for (let k = 0; k < 4; k++) { const y0 = r.range(80, H - 80), x0 = r.range(0, W - 900); for (let p = 0; p < 30; p++) { x.beginPath(); x.arc(x0 + p * 30, y0, 8, 0, TAU); x.fillStyle = "#1c1838"; x.fill(); } }
  PLATES.circuit = printify(c, { soft: 1.3, grain: 0.08, seed: 5 });
}

// ---------------------------------------------------------------- radiolarians

function radiolarian(x, cx, cy, R, kind, r) {
  x.save(); x.translate(cx, cy); x.rotate(r() * TAU);
  const ink = (a) => `rgba(40,34,30,${a})`;
  if (kind === 0) {               // lattice sphere with spines
    x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fillStyle = ink(0.12); x.fill();
    x.save(); x.beginPath(); x.arc(0, 0, R, 0, TAU); x.clip();
    const hs = R / 5;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
      const hx = (i + (j % 2) * 0.5) * hs, hy = j * hs * 0.87, d = Math.hypot(hx, hy) / R;
      if (d > 1) continue;
      const k = Math.sqrt(1 - d * d);
      x.beginPath(); x.ellipse(hx, hy, hs * 0.36 * (0.5 + 0.5 * k), hs * 0.36 * (0.5 + 0.5 * k), Math.atan2(hy, hx), 0, TAU);
      x.fillStyle = "rgba(240,238,236,.7)"; x.fill(); x.strokeStyle = ink(0.75); x.lineWidth = 1.6; x.stroke();
    }
    x.restore();
    x.beginPath(); x.arc(0, 0, R, 0, TAU); x.strokeStyle = ink(0.85); x.lineWidth = 3; x.stroke();
    const sp = r.int(0, 9);
    for (let k = 0; k < sp; k++) { const a = r() * TAU; x.beginPath(); x.moveTo(Math.cos(a) * R, Math.sin(a) * R); x.lineTo(Math.cos(a) * R * 1.9, Math.sin(a) * R * 1.9); x.lineWidth = 2.5; x.strokeStyle = ink(0.7); x.stroke(); }
  } else if (kind === 1) {        // dense spiny ball
    for (let k = 0; k < 700; k++) { const a = r() * TAU, d = Math.sqrt(r()) * R; x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, r.range(1, 3.2), 0, TAU); x.fillStyle = ink(0.5); x.fill(); }
    for (let k = 0; k < 60; k++) { const a = r() * TAU; x.beginPath(); x.moveTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); x.lineTo(Math.cos(a) * R * 1.25, Math.sin(a) * R * 1.25); x.lineWidth = 2; x.strokeStyle = ink(0.75); x.stroke(); }
  } else if (kind === 2) {        // conical shell with pore rows and a horn
    const p = new Path2D(); p.moveTo(0, -R * 1.1); p.bezierCurveTo(R * 0.3, -R * 0.9, R * 0.8, R * 0.2, R * 0.75, R); p.lineTo(-R * 0.75, R); p.bezierCurveTo(-R * 0.8, R * 0.2, -R * 0.3, -R * 0.9, 0, -R * 1.1); p.closePath();
    x.fillStyle = ink(0.16); x.fill(p);
    x.save(); x.clip(p);
    for (let j = 0; j < 9; j++) for (let i = -8; i <= 8; i++) { const py = -R * 0.8 + j * R * 0.22, px = i * R * 0.12 + (j % 2) * R * 0.06; x.beginPath(); x.ellipse(px, py, R * 0.04, R * 0.06, 0, 0, TAU); x.strokeStyle = ink(0.6); x.lineWidth = 1.3; x.stroke(); }
    x.restore();
    x.strokeStyle = ink(0.85); x.lineWidth = 2.6; x.stroke(p);
    x.beginPath(); x.moveTo(0, -R * 1.1); x.lineTo(R * 0.1, -R * 1.7); x.stroke();
    for (let k = -1; k <= 1; k += 2) { x.beginPath(); x.moveTo(k * R * 0.75, R); x.lineTo(k * R * 0.95, R * 1.35); x.stroke(); }
  } else if (kind === 3) {        // concentric disc
    for (let k = 1; k <= 7; k++) { x.beginPath(); x.arc(0, 0, R * k / 7, 0, TAU); x.strokeStyle = ink(0.55); x.lineWidth = 2; x.stroke(); }
    for (let k = 0; k < 28; k++) { const a = k / 28 * TAU; x.beginPath(); x.moveTo(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15); x.lineTo(Math.cos(a) * R, Math.sin(a) * R); x.lineWidth = 1; x.stroke(); }
    x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fillStyle = ink(0.12); x.fill();
  } else {                        // pored ellipsoid
    x.beginPath(); x.ellipse(0, 0, R, R * 0.6, 0, 0, TAU); x.fillStyle = ink(0.2); x.fill(); x.strokeStyle = ink(0.8); x.lineWidth = 2.5; x.stroke();
    for (let k = 0; k < 40; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.85; x.beginPath(); x.arc(Math.cos(a) * d * R, Math.sin(a) * d * R * 0.6, R * 0.06, 0, TAU); x.fillStyle = "rgba(235,232,230,.6)"; x.fill(); }
    x.beginPath(); x.moveTo(-R * 1.5, 0); x.lineTo(R * 1.5, 0); x.lineWidth = 2; x.stroke();
  }
  x.restore();
}
function plateRadiolaria() {
  const W = 2200, H = 2200, c = canvas(W, H), x = c.getContext("2d"), r = RNG(7);
  const g = x.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, "#f1eff2"); g.addColorStop(1, "#d9d6dc");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const items = [];
  for (let k = 0; k < 46; k++) items.push({ cx: r.range(80, W - 80), cy: r.range(80, H - 80), R: r() < 0.15 ? r.range(110, 170) : r.range(30, 80), kind: r.int(0, 4), blur: r() < 0.3 ? r.range(1.5, 5) : 0 });
  items.push({ cx: W * 0.52, cy: H * 0.5, R: 190, kind: 0, blur: 0 });
  META.radiolaria = [];
  for (const it of items) {
    const S = Math.ceil(it.R * 4.4 + 20), sc = canvas(S, S), sx = sc.getContext("2d");
    sx.filter = it.blur ? `blur(${it.blur}px)` : "none";
    radiolarian(sx, S / 2, S / 2, it.R, it.kind, r);
    META.radiolaria.push({ c: sc, x: it.cx, y: it.cy, rot: 0, sp: r.range(0.6, 1.6), ph: r() * TAU, vx: r.range(-40, 40), vy: r.range(-30, 30), spin: r.range(-0.4, 0.4) });
  }
  // dust and debris
  for (let k = 0; k < 140; k++) { x.beginPath(); x.arc(r() * W, r() * H, r.range(0.8, 3), 0, TAU); x.fillStyle = `rgba(60,50,45,${r.range(0.15, 0.5)})`; x.fill(); }
  // out-of-focus dust rings with colour fringes
  for (let k = 0; k < 16; k++) {
    const dx = r() * W, dy = r() * H, rr = r.range(20, 45);
    [["rgba(255,80,60,.22)", 2], ["rgba(60,140,255,.22)", -2], ["rgba(255,220,90,.18)", 0]].forEach(([col, o]) => { x.beginPath(); x.arc(dx + o, dy, rr, 0, TAU); x.lineWidth = 6; x.strokeStyle = col; x.filter = "blur(2px)"; x.stroke(); });
    x.filter = "none";
  }
  PLATES.radiolaria = c;
}

// ---------------------------------------------------------------- bubble chamber

function plateBubble() {
  const W = 2048, H = 2048, c = canvas(W, H), x = c.getContext("2d"), r = RNG(13);
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = 700;
  x.save(); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
  x.fillStyle = "#050505"; x.fillRect(0, 0, W, H);
  const glowLine = (path, w, a) => { x.shadowColor = "rgba(255,255,255,.8)"; x.shadowBlur = 6; x.strokeStyle = `rgba(240,240,236,${a})`; x.lineWidth = w; x.stroke(path); x.shadowBlur = 0; };
  // beam: near-parallel straight tracks
  for (let k = 0; k < 14; k++) { const y0 = cy + r.range(-60, 60), p = new Path2D(); p.moveTo(cx - R, y0); p.lineTo(cx + R, y0 + r.range(-25, 25)); glowLine(p, r.range(0.8, 1.8), r.range(0.25, 0.6)); }
  // spirals of slowing particles and long arcs, kept for drawing live
  const tracks = [];
  for (let k = 0; k < 24; k++) {
    const pts = [], sx = cx + r.range(-R, R) * 0.8, sy = cy + r.range(-R, R) * 0.8, R0 = r.range(40, 260), dir = r.sign(), a0 = r() * TAU, decay = r.range(0.04, 0.16), turns = r.range(1.5, 6);
    for (let t = 0; t < turns * TAU; t += 0.05) { const rr = R0 * Math.exp(-decay * t); pts.push([sx + Math.cos(a0 + dir * t) * rr - Math.cos(a0) * R0, sy + Math.sin(a0 + dir * t) * rr - Math.sin(a0) * R0]); }
    tracks.push({ pts, w: r.range(1.6, 3), a: r.range(0.45, 0.9), delay: r.range(-0.1, 0.25), dur: r.range(0.18, 0.4) });
  }
  for (let k = 0; k < 26; k++) {
    const pts = [], rr = r.range(300, 2200), a = r() * TAU, ox = cx + r.range(-R, R), oy = cy + r.range(-R, R), c0 = [ox + Math.cos(a) * rr, oy + Math.sin(a) * rr];
    for (let u = -0.5; u <= 0.5; u += 0.01) pts.push([c0[0] + Math.cos(a + Math.PI + u) * rr, c0[1] + Math.sin(a + Math.PI + u) * rr]);
    tracks.push({ pts, w: r.range(1.2, 2.4), a: r.range(0.2, 0.5), delay: r.range(-0.2, 0.2), dur: r.range(0.1, 0.25) });
  }
  META.bubble = { cx, cy, R, tracks };
  // a V decay
  const vx = cx + 120, vy = cy + 160; [[-0.9, 300], [0.4, 380]].forEach(([a, l]) => { const p = new Path2D(); p.moveTo(vx, vy); p.quadraticCurveTo(vx + Math.cos(a) * l * 0.5, vy + Math.sin(a) * l * 0.5 - 60, vx + Math.cos(a) * l, vy + Math.sin(a) * l); glowLine(p, 2, 0.9); });
  // bubbles and fiducial crosses
  for (let k = 0; k < 900; k++) { x.beginPath(); x.arc(cx + r.range(-R, R), cy + r.range(-R, R), r.range(0.6, 2), 0, TAU); x.fillStyle = `rgba(255,255,255,${r.range(0.05, 0.35)})`; x.fill(); }
  for (let k = 0; k < 7; k++) { const fx = cx + r.range(-R, R) * 0.7, fy = cy + r.range(-R, R) * 0.7, p = new Path2D(); p.moveTo(fx - 14, fy); p.lineTo(fx + 14, fy); p.moveTo(fx, fy - 14); p.lineTo(fx, fy + 14); glowLine(p, 2, 0.8); }
  for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(cx + r.range(-300, 300), cy + r.range(-200, 400), r.range(8, 14), 0, TAU); x.fillStyle = "rgba(255,255,255,.85)"; x.shadowColor = "#fff"; x.shadowBlur = 20; x.fill(); x.shadowBlur = 0; }
  // haze at the bottom
  const hz = x.createRadialGradient(cx, cy + 300, 10, cx, cy + 300, 400); hz.addColorStop(0, "rgba(255,255,255,.12)"); hz.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = hz; x.fillRect(0, 0, W, H);
  x.restore();
  // irregular bright rim, broken at the top like a cracked window
  for (let a = 0; a < TAU; a += 0.004) {
    const crack = a > 4.1 && a < 5.2, cn = Noise2(4);
    const rr = R + (crack ? -30 - 110 * Math.max(0, cn(a * 6, 0.5) + 0.35 * cn(a * 25, 3)) * Math.sin((a - 4.1) / 1.1 * Math.PI) : r.range(-6, 6));
    const bright = r() < 0.75 ? r.range(0.5, 1) : 0;
    x.beginPath(); x.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r.range(1.5, crack ? 6 : 4.5), 0, TAU);
    x.fillStyle = `rgba(255,255,255,${bright})`; x.fill();
  }
  PLATES.bubble = c;
}

// ---------------------------------------------------------------- Euclid

function plateEuclid() {
  const W = 2200, H = 2200, c = paper(W, H, [0.93, 0.87, 0.74], { seed: 9, age: 1.6, edge: 0.3 }), x = c.getContext("2d"), r = RNG(3);
  const ink = "#2a1f16", cx = 1000, cy = 1200, R = 520;
  x.strokeStyle = ink; x.fillStyle = ink; x.lineCap = "round";
  const line = (a, b, w = 5) => { x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.lineWidth = w; x.stroke(); };
  const P = (a, rr = R) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  x.globalAlpha = 0.88;
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.lineWidth = 7; x.stroke();
  x.beginPath(); x.arc(cx, cy, R + 14, 0, TAU); x.lineWidth = 1.5; x.stroke();
  const hex = [...Array(6)].map((_, i) => P(i * TAU / 6 - Math.PI / 2));
  hex.forEach((p, i) => line(p, hex[(i + 1) % 6], 6));
  const sq = [...Array(4)].map((_, i) => P(i * TAU / 4 + Math.PI / 4));
  sq.forEach((p, i) => line(p, sq[(i + 1) % 4], 6));
  line(P(Math.PI), P(0), 2.5);
  line(hex[0], hex[3], 2); line(hex[1], hex[4], 1.6); line(P(Math.PI), hex[1], 2); line(P(Math.PI), hex[5], 2);
  // equal-length ticks
  const tick = (a, b, n) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2; for (let k = 0; k < n; k++) { const o = (k - (n - 1) / 2) * 9, q = [m[0] + Math.cos(d - Math.PI / 2) * o, m[1] + Math.sin(d - Math.PI / 2) * o]; line([q[0] - Math.cos(d) * 16, q[1] - Math.sin(d) * 16], [q[0] + Math.cos(d) * 16, q[1] + Math.sin(d) * 16], 2.4); } };
  hex.forEach((p, i) => tick(p, hex[(i + 1) % 6], 2));
  sq.forEach((p, i) => tick(p, sq[(i + 1) % 4], 1));
  // compass arcs
  for (const p of [P(Math.PI), P(0)]) { x.beginPath(); x.arc(p[0], p[1], R * 1.02, -0.5, 0.5); x.lineWidth = 1.2; x.globalAlpha = 0.5; x.stroke(); x.globalAlpha = 0.88; }
  x.font = "italic 76px 'Baskerville Old Face'";
  "ABCDEFGH".split("").forEach((l, i) => { const p = P(i * TAU / 8 - Math.PI / 2, R + 60); x.fillText(l, p[0] - 16, p[1] + 18); });
  x.fillText("K", cx + 16, cy - 14);
  x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
  // mirrored Latin text seen through the back of the leaf
  const lines = ["Super datam rectam lineam terminatam", "triangulum aequilaterum constituere.", "Sit data recta linea terminata AB.", "Oportet igitur super rectam lineam AB", "triangulum aequilaterum constituere."];
  x.save(); x.translate(W, 0); x.scale(-1, 1); x.globalAlpha = 0.32; x.font = "44px 'Baskerville Old Face'";
  lines.forEach((t, i) => x.fillText(t, 180, 260 + i * 62));
  lines.slice(2).forEach((t, i) => x.fillText(t, 260, 1960 + i * 62));
  x.restore();
  // a corner table
  x.globalAlpha = 0.7; x.lineWidth = 2;
  for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(2050, 2100, 380 + k * 64, Math.PI, Math.PI * 1.5); x.stroke(); }
  x.font = "52px 'Baskerville Old Face'";
  [...Array(5)].forEach((_, k) => { const a = Math.PI * 1.05 + k * 0.1; x.save(); x.translate(2050 + Math.cos(a) * 600, 2100 + Math.sin(a) * 600); x.rotate(a + Math.PI / 2); x.fillText(String(k + 2), -12, 16); x.restore(); });
  x.globalAlpha = 1;
  PLATES.euclid = printify(c, { soft: 1.3, grain: 0.14, seed: 6 });
}

// ---------------------------------------------------------------- star atlas

function plateStars() {
  const W = 2200, H = 2200, c = paper(W, H, [0.93, 0.89, 0.79], { seed: 12, age: 1.2 }), x = c.getContext("2d"), r = RNG(21);
  const cx = W / 2, cy = H / 2, R = 1000, ink = "#3a2c22";
  x.strokeStyle = ink; x.fillStyle = ink;
  // declination circles and hour lines (polar projection)
  x.globalAlpha = 0.55;
  for (let k = 1; k <= 9; k++) { x.beginPath(); x.arc(cx, cy, (R * k) / 9, 0, TAU); x.lineWidth = k === 9 ? 3 : 1.2; x.stroke(); }
  for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; x.beginPath(); x.moveTo(cx + Math.cos(a) * R / 9, cy + Math.sin(a) * R / 9); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineWidth = k % 6 ? 1 : 2; x.stroke(); }
  // graduated rim
  for (let k = 0; k < 360; k++) { const a = k / 360 * TAU, l = k % 10 ? 12 : 26; x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); x.lineWidth = 1.2; x.stroke(); }
  x.globalAlpha = 0.9;
  // ecliptic in red and the milky way as a stippled band
  x.beginPath(); x.ellipse(cx + 160, cy - 60, 760, 640, 0.4, 0, TAU); x.strokeStyle = "#a8322a"; x.lineWidth = 3; x.stroke();
  for (let k = 0; k < 2600; k++) { const t = r() * TAU, w = r.gauss() * 70; const px = cx + Math.cos(t) * (820 + w) - 200, py = cy + Math.sin(t) * (420 + w) + 100; x.beginPath(); x.arc(px, py, r.range(0.6, 1.8), 0, TAU); x.fillStyle = "rgba(58,44,34,.35)"; x.fill(); }
  x.fillStyle = ink; x.strokeStyle = ink;
  const star = (sx, sy, mag) => { const s = 3 + (5 - mag) * 2.6; x.beginPath(); for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, rr = k % 2 ? s * 0.45 : s; x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); } x.closePath(); x.fill(); };
  // constellation figures
  const figures = [
    { name: "URSA MAJOR", at: [700, 640], s: 1.1, pts: [[0, 0], [110, 20], [200, 70], [290, 100], [300, 210], [430, 230], [440, 110]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
    { name: "CASSIOPEIA", at: [1350, 520], s: 1, pts: [[0, 0], [90, 110], [190, 40], [290, 140], [400, 60]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
    { name: "ORION", at: [1250, 1350], s: 1.15, pts: [[0, 0], [260, -20], [100, 190], [140, 200], [180, 210], [20, 420], [250, 400], [130, -90]], lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [0, 7], [1, 7]] },
    { name: "LYRA", at: [520, 1400], s: 1, pts: [[0, 0], [60, 90], [120, 170], [40, 200], [-20, 120]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
  ];
  for (const f of figures) {
    const pts = f.pts.map(([a, b]) => [f.at[0] + a * f.s, f.at[1] + b * f.s]);
    x.setLineDash([10, 8]); x.lineWidth = 2;
    for (const [a, b] of f.lines) { x.beginPath(); x.moveTo(...pts[a]); x.lineTo(...pts[b]); x.stroke(); }
    x.setLineDash([]);
    pts.forEach((p, i) => star(p[0], p[1], 1 + (i * 7) % 4));
    x.font = "40px 'Baskerville Old Face'"; x.letterSpacing = "6px";
    x.fillText(f.name, pts[0][0] - 20, pts[0][1] - 50);
  }
  for (let k = 0; k < 420; k++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.98; star(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r.range(3.2, 6)); }
  PLATES.stars = printify(c, { soft: 1.2, grain: 0.12, seed: 8 });
}

// ---------------------------------------------------------------- orrery

function plateOrrery() {
  const W = 2400, H = 2048, c = paper(W, H, [0.94, 0.9, 0.8], { seed: 15 }), x = c.getContext("2d"), r = RNG(5);
  const cx = W / 2, cy = H / 2, ink = "#2f241b", tilt = 0.36;
  // zodiac band
  const band = (r0, r1, fill) => { const p = new Path2D(); p.ellipse(cx, cy, r1, r1 * tilt, 0, 0, TAU); p.ellipse(cx, cy, r0, r0 * tilt, 0, 0, TAU, true); wash(x, p, fill, { alpha: 0.6 }); inkLine(x, p, 2, ink); };
  band(1020, 1120, "#d8c08a");
  const signs = "♈♉♊♋♌♍♎♏♐♑♒♓";
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * TAU;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * 1020, cy + Math.sin(a) * 1020 * tilt); x.lineTo(cx + Math.cos(a) * 1120, cy + Math.sin(a) * 1120 * tilt); x.strokeStyle = ink; x.lineWidth = 2; x.stroke();
    const m = a + TAU / 24; x.font = "44px 'Segoe UI Symbol'"; x.fillStyle = k % 3 ? ink : "#9b2e25"; x.textAlign = "center";
    x.fillText(signs[k], cx + Math.cos(m) * 1070, cy + Math.sin(m) * 1070 * tilt + 15);
  }
  // meridian arcs of the armillary
  for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse(cx, cy, 980 * Math.abs(Math.cos(k / 6 * Math.PI)) + 2, 980, 0, 0, TAU); x.strokeStyle = "rgba(47,36,27,.45)"; x.lineWidth = 2; x.stroke(); }
  x.beginPath(); x.ellipse(cx, cy, 980, 980 * 0.12, -0.42, 0, TAU); x.strokeStyle = "#7b3a2a"; x.lineWidth = 4; x.stroke();
  // orbits and planets
  const orbits = [180, 280, 390, 520, 680, 860];
  orbits.forEach((o, i) => {
    x.beginPath(); x.ellipse(cx, cy, o, o * tilt, 0, 0, TAU); x.strokeStyle = i % 2 ? "#3c5f8a" : ink; x.lineWidth = 2.2; x.stroke();
  });
  META.orrery = { cx, cy, tilt, orbits, a0: orbits.map(() => r() * TAU), w: [2.6, 2.0, 1.6, 1.25, 0.8, 0.6], size: [14, 20, 22, 17, 44, 36], col: ["#a89a86", "#d9b56a", "#5f86b4", "#c0583a", "#c9a26e", "#d8c48e"] };
  // the sun with a face of rays
  const sg = x.createRadialGradient(cx, cy, 5, cx, cy, 90); sg.addColorStop(0, "#fff3c4"); sg.addColorStop(0.6, "#f0b43a"); sg.addColorStop(1, "#c4621f");
  for (let k = 0; k < 32; k++) { const a = k / 32 * TAU, l = k % 2 ? 130 : 160; x.beginPath(); x.moveTo(cx + Math.cos(a - 0.08) * 80, cy + Math.sin(a - 0.08) * 80); x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.lineTo(cx + Math.cos(a + 0.08) * 80, cy + Math.sin(a + 0.08) * 80); x.fillStyle = k % 2 ? "#d9822e" : "#ecb54a"; x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke(); }
  x.beginPath(); x.arc(cx, cy, 86, 0, TAU); x.fillStyle = sg; x.fill(); x.lineWidth = 2; x.strokeStyle = ink; x.stroke();
  // central axis
  x.beginPath(); x.moveTo(cx - 140, cy + 1000); x.lineTo(cx + 140, cy - 1000); x.strokeStyle = ink; x.lineWidth = 3; x.stroke();
  PLATES.orrery = printify(c, { soft: 1.2, grain: 0.12, seed: 10 });
}
