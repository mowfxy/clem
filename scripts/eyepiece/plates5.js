// A fourth shelf of subjects: anatomy of a fish, a feather, a scallop, chess, a compass rose, Saturn,
// a slide rule, Japanese script, a geode, coral, a clock, magnetic field lines, an atom
// and a blueprint.

function plateFish() {
  const W = 2600, H = 1600, c = paper(W, H, [0.94, 0.92, 0.86], { seed: 81 }), x = c.getContext("2d"), ink = "#2b2219";
  const spine = bez([300, 820], [900, 700], [1700, 760], [2300, 820], 60);
  x.strokeStyle = ink; x.lineCap = "round";
  // ribs and spines
  for (let i = 6; i < 56; i++) {
    const [px, py] = spine[i], k = i / 60, up = 200 + 260 * Math.sin(Math.PI * k), dn = 160 + 300 * Math.sin(Math.PI * Math.min(1, k * 1.3));
    x.lineWidth = 4; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px - 30, py - up * 0.5, px - 70, py - up); x.stroke();
    if (k < 0.7) { x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px - 10, py + dn * 0.6, px - 70, py + dn); x.lineWidth = 3.5; x.stroke(); }
    x.beginPath(); x.ellipse(px, py, 16, 22, 0, 0, TAU); x.fillStyle = "#e9dfc8"; x.fill(); x.lineWidth = 3; x.stroke();
  }
  // skull and tail fan
  const head = new Path2D(); head.moveTo(300, 820); head.bezierCurveTo(160, 600, 40, 700, 40, 830); head.bezierCurveTo(60, 980, 200, 1060, 330, 960); head.closePath();
  wash(x, head, "#e2d4b8", { alpha: 0.8, under: UNDER }); inkLine(x, head, 4);
  x.beginPath(); x.arc(150, 790, 46, 0, TAU); x.lineWidth = 4; x.stroke();
  for (let k = -6; k <= 6; k++) { x.beginPath(); x.moveTo(2300, 820); x.quadraticCurveTo(2420, 820 + k * 40, 2540, 820 + k * 90); x.lineWidth = 2.5; x.stroke(); }
  caption(x, "Sceletus piscis", 900, 1480, 100);
  PLATES.fish = printify(c, { seed: 31 });
}

function plateFeather() {
  const W = 2048, c = paper(W, W, [0.945, 0.93, 0.89], { seed: 82 }), x = c.getContext("2d"), r = RNG(8);
  const rach = bez([300, 1900], [600, 1300], [1200, 700], [1800, 160], 120);
  for (let i = 4; i < 118; i++) {
    const [px, py] = rach[i], [qx, qy] = rach[i + 1], a = Math.atan2(qy - py, qx - px), k = i / 120, L = 330 * Math.sin(Math.PI * Math.pow(k, 0.7)) + 40;
    for (const s of [-1, 1]) {
      const b = a + s * (0.9 - 0.25 * k), ex = px + Math.cos(b) * L, ey = py + Math.sin(b) * L;
      x.strokeStyle = k < 0.2 ? `rgba(120,110,95,${0.35})` : s > 0 ? "rgba(70,88,120,.55)" : "rgba(50,62,92,.6)";
      x.lineWidth = 2.2; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(b + s * 0.25) * L * 0.6, py + Math.sin(b + s * 0.25) * L * 0.6, ex + r.range(-6, 6), ey + r.range(-6, 6)); x.stroke();
    }
  }
  // eye-spot near the tip, like a peacock's
  const [tx, ty] = rach[96];
  for (const [rr, col] of [[150, "#2a6a7a"], [110, "#c9a23a"], [80, "#2f8a6a"], [48, "#1f2e6a"]]) { x.beginPath(); x.ellipse(tx, ty, rr * 1.2, rr, -0.8, 0, TAU); x.fillStyle = col; x.globalAlpha = 0.55; x.fill(); }
  x.globalAlpha = 1;
  stem(x, rach, 14, 3, { color: "#d8ccb2", dark: "#8a7a5a" });
  PLATES.feather = printify(c, { seed: 32 });
}

function plateScallop() {
  const W = 2048, c = paper(W, W, [0.94, 0.925, 0.88], { seed: 83 }), x = c.getContext("2d"), cx = 1024, cy = 1500;
  for (let k = 0; k < 19; k++) {
    const a0 = Math.PI * (1.08 + k * 0.044), a1 = a0 + 0.044, R = 980;
    const p = new Path2D(); p.moveTo(cx, cy); p.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    p.quadraticCurveTo(cx + Math.cos((a0 + a1) / 2) * R * 1.06, cy + Math.sin((a0 + a1) / 2) * R * 1.06, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); p.closePath();
    const g = x.createLinearGradient(cx, cy, cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    g.addColorStop(0, "#e9c2a8"); g.addColorStop(0.6, k % 2 ? "#e07a5f" : "#ec9a74"); g.addColorStop(1, "#f6dcc4");
    wash(x, p, g, { alpha: 0.95, under: UNDER });
    hatch(x, p, [cx - R, cy - R, cx + R, cy], { angle: a0 + 1.57, spacing: 3.4, maxW: 1.4, seed: k, alpha: 0.4, shade: () => (k % 2 ? 0.6 : 0.25) });
    inkLine(x, p, 2);
  }
  // growth lines
  for (let rr = 140; rr < 980; rr += 70) { x.beginPath(); x.arc(cx, cy, rr, Math.PI * 1.08, Math.PI * 1.92); x.strokeStyle = "rgba(90,40,30,.3)"; x.lineWidth = 2; x.stroke(); }
  const hinge = new Path2D(); hinge.moveTo(cx - 260, cy + 40); hinge.lineTo(cx + 260, cy + 40); hinge.lineTo(cx + 120, cy - 70); hinge.lineTo(cx - 120, cy - 70); hinge.closePath();
  wash(x, hinge, "#d99a7c", { under: UNDER }); inkLine(x, hinge, 2);
  caption(x, "Pecten maximus", 640, 1830, 96);
  PLATES.scallop = printify(c, { seed: 33 });
}

function plateChess() {
  const W = 2048, c = canvas(W, W), x = c.getContext("2d"), S = 256;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = (i + j) % 2 ? "#6b4a2e" : "#e9d9b6"; x.fillRect(i * S, j * S, S, S); }
  const back = "♜♞♝♛♚♝♞♜", pawn = "♟";
  x.font = "200px 'Segoe UI Symbol'"; x.textAlign = "center"; x.textBaseline = "middle";
  const put = (ch, i, j, white) => { x.fillStyle = white ? "#fbf6ea" : "#1b1712"; x.strokeStyle = white ? "#3a2c1c" : "#c9b48a"; x.lineWidth = 3; x.fillText(ch, i * S + S / 2, j * S + S / 2 + 10); x.strokeText(ch, i * S + S / 2, j * S + S / 2 + 10); };
  for (let i = 0; i < 8; i++) { put(back[i], i, 0, false); put(pawn, i, 1, false); }
  [[4, 3], [2, 2]].forEach(([i, j]) => put(pawn, i, j + 1, true));
  for (let i = 0; i < 8; i++) { if (i !== 4 && i !== 2) put(pawn, i, 6, true); put(back[i], i, 7, true); }
  const g = x.createRadialGradient(1024, 900, 200, 1024, 1024, 1500); g.addColorStop(0, "rgba(255,240,200,.15)"); g.addColorStop(1, "rgba(20,10,0,.45)");
  x.fillStyle = g; x.fillRect(0, 0, W, W);
  PLATES.chess = printify(c, { seed: 34, grain: 0.08 });
}

function plateCompass() {
  const W = 2048, c = paper(W, W, [0.94, 0.9, 0.8], { seed: 84, age: 1.4 }), x = c.getContext("2d"), cx = 1024, cy = 1024;
  for (let k = 0; k < 32; k++) { const a = k / 32 * TAU; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * 1400, cy + Math.sin(a) * 1400); x.strokeStyle = k % 4 ? "rgba(60,90,120,.25)" : "rgba(160,50,40,.45)"; x.lineWidth = 2; x.stroke(); }
  [820, 760, 700].forEach((r, i) => { x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.strokeStyle = "#2a1f16"; x.lineWidth = i === 0 ? 6 : 2; x.stroke(); });
  for (let k = 0; k < 360; k += 5) { const a = k * Math.PI / 180, l = k % 45 ? 18 : 46; x.beginPath(); x.moveTo(cx + Math.cos(a) * 760, cy + Math.sin(a) * 760); x.lineTo(cx + Math.cos(a) * (760 - l), cy + Math.sin(a) * (760 - l)); x.lineWidth = 2; x.stroke(); }
  const star = (n, R, r0, rot, c1, c2) => {
    for (let k = 0; k < n; k++) {
      const a = rot + k / n * TAU, l = cx + Math.cos(a) * R, t = cy + Math.sin(a) * R;
      for (const s of [-1, 1]) { const b = a + s * Math.PI / n; const p = new Path2D(); p.moveTo(cx, cy); p.lineTo(l, t); p.lineTo(cx + Math.cos(b) * r0, cy + Math.sin(b) * r0); p.closePath(); x.fillStyle = s > 0 ? c1 : c2; x.fill(p); x.strokeStyle = "#2a1f16"; x.lineWidth = 2; x.stroke(p); }
    }
  };
  star(8, 520, 120, Math.PI / 8 - Math.PI / 2, "#e6d3a8", "#9a7a4a");
  star(4, 740, 150, -Math.PI / 2, "#f2e6cc", "#a8322a");
  x.font = "bold 110px 'Baskerville Old Face'"; x.fillStyle = "#2a1f16"; x.textAlign = "center";
  [["N", 0, -880], ["E", 900, 40], ["S", 0, 960], ["W", -900, 40]].forEach(([l, dx, dy]) => x.fillText(l, cx + dx, cy + dy));
  x.beginPath(); x.arc(cx, cy, 30, 0, TAU); x.fillStyle = "#a8322a"; x.fill();
  PLATES.compass = printify(c, { seed: 35 });
}

const SATURN_FS = `
uniform vec2 res; uniform float time, zoom;
void main(){
  vec2 p = (uv - .5) * 1.2 * zoom;
  vec3 c = vec3(0.);
  c += vec3(1.) * step(.9985, hash12(floor(uv * res / 2.)));
  float t = .3; mat2 R = mat2(cos(t), -sin(t), sin(t), cos(t)); vec2 q = R * p;
  float ring = length(vec2(q.x, q.y / .28));
  float body = length(p) / .2;
  // rings behind the planet
  float rb = smoothstep(.29, .3, ring) * smoothstep(.56, .55, ring) * (1. - smoothstep(.405, .41, ring) * smoothstep(.43, .425, ring));
  vec3 ringC = mix(vec3(.75, .66, .5), vec3(.95, .88, .7), .5 + .5 * sin(ring * 220.)) * (.8 + .2 * fbm(vec2(ring * 60., 0.)));
  if (q.y > 0.) c = mix(c, ringC, rb * .95);
  if (body < 1.){
    float mu = sqrt(1. - body * body);
    vec3 bands = mix(vec3(.85, .72, .5), vec3(.96, .88, .7), .5 + .5 * sin(p.y * 90. + fbm(p * 20.) * 2.));
    vec3 s = bands * (.25 + .75 * pow(mu, .6)) * (.6 + .4 * clamp(.5 - p.x * 4., 0., 1.) + .3);
    c = mix(c, s, smoothstep(1., .99, body));
  }
  if (q.y <= 0.) c = mix(c, ringC, rb * .95);
  o = vec4(c, 1);
}`;

function plateSlideRule() {
  const W = 3200, H = 1400, c = canvas(W, H), x = c.getContext("2d");
  x.fillStyle = "#2a2622"; x.fillRect(0, 0, W, H);
  const bars = [[260, 360, "#efe6d0"], [640, 340, "#f6efdc"], [1000, 360, "#efe6d0"]];
  for (const [y, h, col] of bars) { x.fillStyle = col; x.fillRect(80, y, W - 160, h); x.strokeStyle = "#3a3026"; x.lineWidth = 3; x.strokeRect(80, y, W - 160, h); }
  x.fillStyle = "#1e1a14"; x.strokeStyle = "#1e1a14"; x.textAlign = "center";
  const scale = (y0, len, up) => {
    for (let v = 1; v <= 10; v += 0.05) {
      const px = 160 + Math.log10(v) * len, major = Math.abs(v - Math.round(v)) < 0.001, mid = Math.abs(v * 2 - Math.round(v * 2)) < 0.001;
      const l = major ? 70 : mid ? 46 : 26;
      x.lineWidth = major ? 3 : 1.6; x.beginPath(); x.moveTo(px, y0); x.lineTo(px, y0 + (up ? -l : l)); x.stroke();
      if (major) { x.font = "48px 'Baskerville Old Face'"; x.fillText(String(Math.round(v)), px, y0 + (up ? -86 : 120)); }
    }
  };
  scale(620, 2800, true); scale(640, 2800, false); scale(1000, 2800, true);
  x.font = "italic 56px 'Baskerville Old Face'"; x.textAlign = "left"; x.fillText("C", 110, 700); x.fillText("D", 110, 1060);
  // cursor
  x.fillStyle = "rgba(200,220,230,.22)"; x.fillRect(1600, 180, 220, 1260); x.strokeStyle = "#b02a22"; x.lineWidth = 3; x.beginPath(); x.moveTo(1710, 180); x.lineTo(1710, 1440); x.stroke();
  PLATES.sliderule = printify(c, { seed: 36, grain: 0.06 });
}

function plateKanji() {
  const W = 2048, c = paper(W, W, [0.96, 0.94, 0.89], { seed: 86, age: 0.6 }), x = c.getContext("2d");
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = "1100px 'Yu Mincho', 'MS Mincho', 'Yu Gothic', serif"; x.fillStyle = "#141210";
  x.fillText("学", 1024, 980);
  // a red seal
  x.fillStyle = "#b8322a"; x.fillRect(1560, 1560, 260, 260);
  x.font = "bold 150px 'Yu Mincho', 'MS Mincho', serif"; x.fillStyle = "#f6e8d8"; x.fillText("知", 1690, 1695);
  x.font = "90px 'Yu Mincho', 'MS Mincho', serif"; x.fillStyle = "#141210";
  ["ま", "な", "ぶ"].forEach((k, i) => x.fillText(k, 330, 600 + i * 130));
  PLATES.kanji = printify(c, { seed: 38, soft: 1.3 });
}

const GEODE_FS = `
uniform vec2 res;
void main(){
  vec2 p = (uv - .5) * 2.;
  float r = length(p * vec2(1., 1.15)) + .06 * fbm(p * 3.);
  vec3 c;
  if (r > .95) c = vec3(.45, .4, .36) * (.7 + .4 * fbm(p * 8.));
  else if (r > .62){ float b = r * 60. + 3. * fbm(p * 4.); c = mix(vec3(.82, .8, .86), vec3(.55, .45, .7), .5 + .5 * sin(b)); c *= .85 + .2 * fbm(p * 30.); }
  else {
    vec4 v = voronoi(p * 9. + .4 * fbm(p * 4.));
    float facet = .5 + .5 * sin(hash12(v.zw) * 6.28 + atan(p.y, p.x) * 3.);
    c = mix(vec3(.32, .12, .48), vec3(.82, .62, .95), facet) * (.55 + .5 * smoothstep(.6, .0, r));
    c += vec3(1.) * pow(max(0., 1. - v.x * 3.), 8.) * .6;
    c = mix(c, vec3(.2, .08, .3), smoothstep(.04, .0, v.y - v.x) * .5);
  }
  o = vec4(c, 1);
}`;

function plateCoral() {
  const W = 2048, c = paper(W, W, [0.95, 0.94, 0.9], { seed: 87 }), x = c.getContext("2d"), r = RNG(91);
  const grow = (px, py, a, len, w, d) => {
    const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
    const line = bez([px, py], [px + Math.cos(a - 0.2) * len * 0.4, py + Math.sin(a - 0.2) * len * 0.4], [ex - Math.cos(a + 0.2) * len * 0.3, ey - Math.sin(a + 0.2) * len * 0.3], [ex, ey], 10);
    const o = ribbon(line, w, w * 0.7), p = polyPath(o);
    const g = x.createLinearGradient(px, py, ex, ey); g.addColorStop(0, "#b8322a"); g.addColorStop(1, "#ee7a5a");
    wash(x, p, g, { alpha: 0.95, under: UNDER }); inkLine(x, p, 1.4, "#4a1410");
    if (d < 6) { const n = d < 2 ? 3 : 2; for (let k = 0; k < n; k++) grow(ex, ey, a + r.range(-0.7, 0.7), len * r.range(0.6, 0.8), w * 0.72, d + 1); }
    else { x.beginPath(); x.arc(ex, ey, w * 0.8, 0, TAU); x.fillStyle = "#f6c2a8"; x.fill(); }
  };
  grow(1024, 1950, -Math.PI / 2, 420, 60, 0);
  caption(x, "Corallium rubrum", 120, 160, 90);
  PLATES.coral = printify(c, { seed: 39 });
}

// ---------------------------------------------------------------- live: a clock, a magnet, an atom, a blueprint

LIVE.clock = (x, lt, t) => {
  const W = SCENE, cx = W / 2, cy = W / 2, R = 520;
  const g = x.createRadialGradient(cx - 120, cy - 160, 40, cx, cy, R); g.addColorStop(0, "#fbf5e6"); g.addColorStop(1, "#d8c8a4");
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fillStyle = g; x.fill(); x.lineWidth = 18; x.strokeStyle = "#8a6a2a"; x.stroke();
  x.fillStyle = "#1e1a14"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "92px 'Baskerville Old Face'";
  ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"].forEach((n, i) => { const a = i / 12 * TAU - Math.PI / 2; x.fillText(n, cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78); });
  for (let k = 0; k < 60; k++) { const a = k / 60 * TAU; x.beginPath(); x.moveTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94); x.lineTo(cx + Math.cos(a) * R * (k % 5 ? 0.9 : 0.86), cy + Math.sin(a) * R * (k % 5 ? 0.9 : 0.86)); x.lineWidth = k % 5 ? 2 : 5; x.strokeStyle = "#1e1a14"; x.stroke(); }
  const hand = (a, l, w, col) => { x.save(); x.translate(cx, cy); x.rotate(a); x.beginPath(); x.moveTo(-w, 30); x.lineTo(0, -l); x.lineTo(w, 30); x.closePath(); x.fillStyle = col; x.fill(); x.restore(); };
  const sec = Math.floor(t * 4) / 4;          // the second hand jumps on the beat
  hand(1.2 + t * 0.05, R * 0.5, 16, "#16224a"); hand(4.4 + t * 0.6, R * 0.72, 11, "#16224a"); hand(sec * TAU / 6, R * 0.82, 4, "#b8322a");
  x.beginPath(); x.arc(cx, cy, 20, 0, TAU); x.fillStyle = "#b8322a"; x.fill();
};
LIVE.magnet = (x, lt, t) => {
  const W = SCENE, cx = W / 2, cy = W / 2, r = RNG(4);
  // iron filings: short strokes aligned with a dipole's field
  const qN = [cx, cy - 170], qS = [cx, cy + 170];
  for (let i = 0; i < 5200; i++) {
    const px = r() * W, py = r() * W;
    const f = (q, s) => { const dx = px - q[0], dy = py - q[1], d = Math.max(60, Math.hypot(dx, dy)); return [s * dx / (d * d * d), s * dy / (d * d * d)]; };
    const a = f(qN, 1), b = f(qS, -1), fx = a[0] + b[0], fy = a[1] + b[1], m = Math.hypot(fx, fy) || 1, l = 9 + r() * 9;
    x.beginPath(); x.moveTo(px - fx / m * l, py - fy / m * l); x.lineTo(px + fx / m * l, py + fy / m * l); x.strokeStyle = "rgba(30,30,34,.7)"; x.lineWidth = 2; x.stroke();
  }
  x.save(); x.translate(cx, cy); x.rotate(0.02 * Math.sin(t * 3));
  x.fillStyle = "#b8322a"; x.fillRect(-90, -260, 180, 260); x.fillStyle = "#2f5aa8"; x.fillRect(-90, 0, 180, 260);
  x.fillStyle = "#fff"; x.font = "bold 110px 'Baskerville Old Face'"; x.textAlign = "center"; x.fillText("N", 0, -100); x.fillText("S", 0, 170);
  x.restore();
};
LIVE.atom = (x, lt, t) => {
  const W = SCENE, cx = W / 2, cy = W / 2;
  x.lineWidth = 4; x.strokeStyle = "rgba(22,34,74,.7)";
  const orbits = [[0, 480, 150], [1.05, 480, 150], [2.1, 480, 150]];
  for (const [rot, a, b] of orbits) { x.save(); x.translate(cx, cy); x.rotate(rot); x.beginPath(); x.ellipse(0, 0, a, b, 0, 0, TAU); x.stroke(); x.restore(); }
  for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, rr = k ? 46 : 0; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; const g = x.createRadialGradient(px - 14, py - 14, 2, px, py, 44); g.addColorStop(0, "#fff"); g.addColorStop(0.5, k % 2 ? "#d9473e" : "#2f6cc0"); g.addColorStop(1, "#1a1a2a"); x.beginPath(); x.arc(px, py, 44, 0, TAU); x.fillStyle = g; x.fill(); }
  orbits.forEach(([rot, a, b], i) => { const u = t * (3 + i) + i * 2; const ex = Math.cos(u) * a, ey = Math.sin(u) * b; const px = cx + ex * Math.cos(rot) - ey * Math.sin(rot), py = cy + ex * Math.sin(rot) + ey * Math.cos(rot); x.beginPath(); x.arc(px, py, 22, 0, TAU); x.fillStyle = "#e6b63a"; x.fill(); x.lineWidth = 3; x.strokeStyle = "#16224a"; x.stroke(); });
};
LIVE.blueprint = (x, lt, t) => {
  const W = SCENE;
  x.fillStyle = "#1d4f8f"; x.fillRect(0, 0, W, W);
  x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 1;
  for (let g = 0; g < W; g += 40) { x.beginPath(); x.moveTo(g, 0); x.lineTo(g, W); x.stroke(); x.beginPath(); x.moveTo(0, g); x.lineTo(W, g); x.stroke(); }
  x.strokeStyle = "rgba(240,248,255,.9)"; x.lineWidth = 4;
  // a truss bridge, drawn as it is being drafted
  const p = clamp(lt / 0.3 + 0.35), y0 = 820, y1 = 520, n = 8, x0 = 120, w = (W - 240) / n;
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + (W - 240) * p, y0); x.stroke();
  x.beginPath(); x.moveTo(x0 + w, y1); x.lineTo(x0 + w + (W - 240 - 2 * w) * p, y1); x.stroke();
  for (let i = 0; i <= n * p; i++) { const px = x0 + i * w; x.beginPath(); x.moveTo(px, y0); x.lineTo(i === 0 || i === n ? px + (i ? -w : w) : px, i === 0 || i === n ? y1 : y1); x.stroke(); if (i < n) { x.beginPath(); x.moveTo(px, i % 2 ? y1 : y0); x.lineTo(px + w, i % 2 ? y0 : y1); x.stroke(); } }
  x.setLineDash([16, 10]); x.lineWidth = 2; x.beginPath(); x.moveTo(x0, y0 + 120); x.lineTo(W - x0, y0 + 120); x.stroke(); x.setLineDash([]);
  x.fillStyle = "rgba(240,248,255,.9)"; x.font = "44px 'Segoe UI'"; x.fillText("SPAN 84 m", W / 2 - 110, y0 + 180);
  x.beginPath(); x.arc(W / 2, 280, 120, 0, TAU); x.stroke();
  for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; x.beginPath(); x.moveTo(W / 2 + Math.cos(a) * 120, 280 + Math.sin(a) * 120); x.lineTo(W / 2 + Math.cos(a) * 30, 280 + Math.sin(a) * 30); x.stroke(); }
};

function evenMorePlates() {
  plateFish(); plateFeather(); plateScallop(); plateChess(); plateCompass(); plateSlideRule(); plateKanji(); plateCoral();
  PLATES.geode = bake(GEODE_FS, 2048, 2048);
  PLATES.blank = canvas(16, 16);
}
