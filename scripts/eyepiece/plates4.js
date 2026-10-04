// Still more subjects, so the run never repeats itself: a sunflower's spirals, a dandelion clock,
// honeycomb, an old world map, a page of equations, the periodic table, a printed book, a
// harmonograph drawing itself, light through a prism, turning gears and the Mandelbrot set.

function plateSunflower() {
  const W = 2048, c = paper(W, W, [0.94, 0.92, 0.86], { seed: 61 }), x = c.getContext("2d"), cx = W / 2, cy = W / 2;
  // ray petals
  for (let k = 0; k < 34; k++) {
    const a = k / 34 * TAU + (k % 2) * 0.09, l = 520 + (k % 2) * 60;
    x.save(); x.translate(cx, cy); x.rotate(a);
    const p = new Path2D(); p.moveTo(380, 0); p.bezierCurveTo(430, -70, l - 60, -60, l, 0); p.bezierCurveTo(l - 60, 60, 430, 70, 380, 0);
    const g = x.createLinearGradient(380, 0, l, 0); g.addColorStop(0, "#c98a12"); g.addColorStop(0.5, "#f2c230"); g.addColorStop(1, "#f7da6a");
    wash(x, p, g, { alpha: 0.95, under: UNDER }); inkLine(x, p, 1.6);
    x.restore();
  }
  // phyllotaxis: florets at the golden angle
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1500; i > 0; i--) {
    const r = 10 * Math.sqrt(i), a = i * golden, px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r, s = 4 + r * 0.018;
    x.beginPath(); x.arc(px, py, s, 0, TAU);
    x.fillStyle = r < 120 ? "#7a8a2a" : r < 260 ? "#5a3a14" : "#3a2410"; x.fill();
    x.lineWidth = 1; x.strokeStyle = "rgba(240,210,120,.35)"; x.stroke();
  }
  caption(x, "Helianthus annuus", 620, 1960, 96);
  PLATES.sunflower = printify(c, { seed: 21 });
}

function plateDandelion() {
  const W = 2048, c = canvas(W, W), x = c.getContext("2d"), r = RNG(71), cx = W / 2, cy = W / 2;
  const g = x.createRadialGradient(cx, cy, 50, cx, cy, W * 0.7); g.addColorStop(0, "#26302a"); g.addColorStop(1, "#070908");
  x.fillStyle = g; x.fillRect(0, 0, W, W);
  for (let i = 0; i < 260; i++) {
    const z = r.range(-1, 1), a = r() * TAU, rr = Math.sqrt(1 - z * z), dx = Math.cos(a) * rr, dy = Math.sin(a) * rr, L = 560;
    const ex = cx + dx * L, ey = cy + dy * L * 0.95 - z * 40;
    x.strokeStyle = `rgba(235,235,225,${0.25 + 0.35 * (z + 1) / 2})`; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + dx * 60, cy + dy * 60); x.lineTo(ex, ey); x.stroke();
    // pappus: a little umbrella of hairs
    for (let k = 0; k < 14; k++) { const b = Math.atan2(dy, dx) + (k / 13 - 0.5) * 2.2; x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex + Math.cos(b) * 70, ey + Math.sin(b) * 70); x.lineWidth = 1; x.strokeStyle = `rgba(245,245,238,${0.18 + 0.3 * (z + 1) / 2})`; x.stroke(); }
  }
  x.beginPath(); x.arc(cx, cy, 70, 0, TAU); x.fillStyle = "#6a6a52"; x.fill();
  PLATES.dandelion = c;
}

const HONEY_FS = `
uniform vec2 res;
void main(){
  vec2 p = uv * res / 150.;
  vec2 s = vec2(1., 1.7320508);
  vec2 a = mod(p, s) - s * .5, b = mod(p - s * .5, s) - s * .5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - g;
  float hex = max(abs(g.x), dot(abs(g), normalize(vec2(1., 1.7320508))));
  float wall = smoothstep(.43, .47, hex);
  float filled = step(.35, hash12(floor(id * 7.)));
  vec3 honey = mix(vec3(.85, .5, .08), vec3(1., .78, .3), smoothstep(.45, .0, hex)) * (.85 + .3 * fbm(p * 3.));
  vec3 empty = vec3(.55, .38, .16) * (.6 + .6 * smoothstep(.45, .1, hex));
  vec3 c = mix(empty, honey, filled);
  c += vec3(1., .95, .8) * filled * pow(max(0., 1. - length(g - vec2(-.12, .12)) * 6.), 3.) * .6;
  c = mix(c, vec3(.95, .82, .5), wall);
  o = vec4(c, 1);
}`;

const WORLD_FS = `
uniform vec2 res;
void main(){
  vec2 px = uv * res, p = px / 700.;
  float h = fbm(p * .9 + 2.) + .35 * fbm(p * 3.) + .02;
  float land = smoothstep(0., .01, h);
  vec3 sea = vec3(.7, .82, .85), ground = vec3(.96, .89, .72);
  vec3 c = mix(sea, ground, land);
  // engraved water-lining along the coast, and hatched hills inland
  for (int i = 1; i < 6; i++) c = mix(c, vec3(.35, .42, .5), (1. - land) * smoothstep(.006, .0, abs(h + float(i) * .045)) * (.55 - float(i) * .08));
  c = mix(c, vec3(.3, .22, .15), land * smoothstep(.01, .0, abs(h)) );
  float hills = smoothstep(.25, .35, h) * step(.5, fract((px.x + px.y * .3) / 7.));
  c = mix(c, vec3(.55, .42, .28), hills * .35);
  // tinted borders of countries
  vec3 v = voronoiEdge(p * 1.6);
  c = mix(c, vec3(.75, .35, .3), land * smoothstep(.02, .0, v.x) * .6);
  c = mix(c, c * vec3(1.05, .95, .9), land * hash12(v.yz) * .3);
  // graticule and a rhumb line rose
  vec2 gr = abs(fract(px / 300.) - .5);
  c = mix(c, vec3(.35, .3, .25), .5 * smoothstep(.4975, .4995, max(gr.x, gr.y)));
  vec2 rc = px - res * vec2(.7, .3); float ra = atan(rc.y, rc.x);
  c = mix(c, vec3(.5, .2, .15), .25 * smoothstep(.004, .0, abs(fract(ra * 16. / TAU) - .5) - .495));
  c *= .95 + .05 * vnoise(px / 2.);
  o = vec4(c, 1);
}`;

function plateEquations() {
  const W = 2400, H = 2048, c = paper(W, H, [0.95, 0.94, 0.9], { seed: 72, age: 0.5 }), x = c.getContext("2d");
  x.strokeStyle = "rgba(70,110,170,.18)"; x.lineWidth = 2;
  for (let y = 150; y < H; y += 80) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  x.fillStyle = "#16224a";
  const lines = ["∫₀^∞ e^(−x²) dx = √π / 2", "e^(iπ) + 1 = 0", "F = G m₁m₂ / r²", "a² + b² = c²", "d/dx sin x = cos x", "Σ 1/n² = π² / 6"];
  x.font = "86px 'Segoe Script'";
  lines.forEach((l, i) => x.fillText(l, 160 + (i % 2) * 60, 260 + i * 160));
  // a plotted curve with axes
  const ox = 1500, oy = 1500;
  x.strokeStyle = "#16224a"; x.lineWidth = 4;
  x.beginPath(); x.moveTo(ox - 600, oy); x.lineTo(ox + 760, oy); x.moveTo(ox, oy + 420); x.lineTo(ox, oy - 700); x.stroke();
  x.strokeStyle = "#d9473e"; x.lineWidth = 7; x.beginPath();
  for (let i = 0; i <= 300; i++) { const u = -6 + i / 300 * 13, y = Math.sin(u) * 260 * Math.exp(-u * u / 40) + 30 * u; i ? x.lineTo(ox + u * 105, oy - y) : x.moveTo(ox + u * 105, oy - y); }
  x.stroke();
  x.strokeStyle = "#2f6cc0"; x.lineWidth = 6; x.beginPath();
  for (let i = 0; i <= 300; i++) { const u = -5 + i / 300 * 11, y = u * u * 18 - 300; i ? x.lineTo(ox + u * 105, oy - y) : x.moveTo(ox + u * 105, oy - y); }
  x.stroke();
  x.font = "64px 'Segoe Script'"; x.fillText("f(x)", ox + 420, oy - 520);
  PLATES.equations = c;
}

function platePeriodic() {
  const W = 2600, H = 2048, c = paper(W, H, [0.94, 0.93, 0.88], { seed: 73 }), x = c.getContext("2d");
  const els = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe".split(" ");
  const pos = (n) => { // standard layout for the first five periods
    if (n === 1) return [0, 0]; if (n === 2) return [17, 0];
    if (n <= 10) return [n - 3 < 2 ? n - 3 : n - 3 + 10, 1];
    if (n <= 18) return [n - 11 < 2 ? n - 11 : n - 11 + 10, 2];
    if (n <= 36) return [n - 19, 3]; return [n - 37, 4];
  };
  const cols = ["#e8b8a8", "#f0d6a0", "#cfe0b0", "#b8d0e6", "#d8c8e8"];
  const S = 132;
  els.forEach((sym, i) => {
    const n = i + 1, [cx, cy] = pos(n), px = 120 + cx * (S + 8), py = 300 + cy * (S + 8);
    const g = n <= 2 || [3, 11, 19, 37].includes(n) ? 0 : [4, 12, 20, 38].includes(n) ? 1 : cx >= 12 ? 3 : cx >= 2 && cx <= 11 ? 2 : 4;
    x.fillStyle = cols[g]; x.fillRect(px, py, S, S); x.strokeStyle = "#2a1f16"; x.lineWidth = 2.5; x.strokeRect(px, py, S, S);
    x.fillStyle = "#2a1f16"; x.font = "28px 'Baskerville Old Face'"; x.fillText(String(n), px + 10, py + 32);
    x.font = "bold 64px 'Baskerville Old Face'"; x.textAlign = "center"; x.fillText(sym, px + S / 2, py + 100); x.textAlign = "left";
  });
  x.font = "italic 70px 'Baskerville Old Face'"; x.fillStyle = "#2a1f16"; x.fillText("Tabula elementorum", 120, 180);
  PLATES.periodic = printify(c, { seed: 22 });
}

function plateBook() {
  const W = 2048, H = 2048, c = paper(W, H, [0.93, 0.89, 0.8], { seed: 74, age: 1.6, edge: 0.3 }), x = c.getContext("2d");
  x.fillStyle = "#a8322a"; x.font = "bold 360px 'Baskerville Old Face'"; x.fillText("O", 170, 560);
  x.fillStyle = "#2a1f16"; x.font = "58px 'Baskerville Old Face'";
  const text = "nce upon a time the world was read by candle light, page by page, and every page opened another door. Here the reader learned of stars and seas, of numbers and of names, of how the river finds the ocean and the root the rain. Nothing was too small to be wondered at, nothing too far to be reached by patience and a steady eye. So the student turned the leaf, and the leaf turned the student, and the long evening became a morning.";
  const words = text.split(" ");
  let line = "", y = 300, left = 520;
  for (const w of words) {
    const test = line + w + " ";
    if (x.measureText(test).width > W - left - 170) { x.fillText(line, left, y); line = w + " "; y += 86; if (y > 620) left = 170; }
    else line = test;
  }
  x.fillText(line, left, y);
  x.font = "italic 52px 'Baskerville Old Face'"; x.fillText("— 23 —", W / 2 - 80, H - 150);
  x.strokeStyle = "#a8322a"; x.lineWidth = 3; x.beginPath(); x.moveTo(170, 160); x.lineTo(W - 170, 160); x.stroke();
  PLATES.book = printify(c, { seed: 23, grain: 0.14 });
}

function platePrism() {
  const W = 2048, c = canvas(W, W), x = c.getContext("2d");
  x.fillStyle = "#050507"; x.fillRect(0, 0, W, W);
  const A = [900, 620], B = [620, 1300], C2 = [1180, 1300];
  // incoming white beam
  x.globalCompositeOperation = "lighter";
  x.strokeStyle = "rgba(255,255,255,.85)"; x.lineWidth = 16; x.shadowColor = "#fff"; x.shadowBlur = 30;
  x.beginPath(); x.moveTo(0, 1180); x.lineTo(780, 960); x.stroke();
  // dispersed fan
  const cols = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#0a84ff", "#5e5ce6", "#bf5af2"];
  cols.forEach((col, i) => { x.strokeStyle = col; x.globalAlpha = 0.75; x.lineWidth = 34; x.shadowColor = col; x.shadowBlur = 40; x.beginPath(); x.moveTo(1010, 1010 + i * 4); x.lineTo(W + 40, 1060 + i * 90); x.stroke(); });
  x.globalAlpha = 1; x.shadowBlur = 0; x.globalCompositeOperation = "source-over";
  // the glass
  const p = new Path2D(); p.moveTo(...A); p.lineTo(...B); p.lineTo(...C2); p.closePath();
  const g = x.createLinearGradient(620, 620, 1180, 1300); g.addColorStop(0, "rgba(200,220,255,.25)"); g.addColorStop(1, "rgba(120,140,180,.12)");
  x.fillStyle = g; x.fill(p); x.strokeStyle = "rgba(230,240,255,.8)"; x.lineWidth = 4; x.stroke(p);
  PLATES.prism = c;
}

// ---------------------------------------------------------------- live: gears and a harmonograph

LIVE.gears = (x, lt, t) => {
  const gear = (cx, cy, R, teeth, a, fill) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    x.beginPath();
    for (let i = 0; i < teeth * 4; i++) { const k = i / (teeth * 4) * TAU, rr = i % 4 < 2 ? R : R * 0.88; x.lineTo(Math.cos(k) * rr, Math.sin(k) * rr); }
    x.closePath();
    const g = x.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R); g.addColorStop(0, "#f0d9a0"); g.addColorStop(0.6, fill); g.addColorStop(1, "#5a3e18");
    x.fillStyle = g; x.fill(); x.lineWidth = 3; x.strokeStyle = "#2a1f16"; x.stroke();
    for (let s = 0; s < 5; s++) { x.save(); x.rotate(s / 5 * TAU); x.beginPath(); x.ellipse(R * 0.48, 0, R * 0.2, R * 0.12, 0, 0, TAU); x.fillStyle = "#1c150e"; x.fill(); x.restore(); }
    x.beginPath(); x.arc(0, 0, R * 0.12, 0, TAU); x.fillStyle = "#1c150e"; x.fill();
    x.restore();
  };
  const w = t * 1.6;
  gear(520, 560, 330, 24, w, "#c8962e");
  gear(1010, 830, 200, 15, -w * 24 / 15 + 0.12, "#b88a3a");
  gear(760, 1100, 170, 12, -w * 2 + 0.2, "#d0a040");
  gear(1180, 380, 140, 10, w * 24 / 10 * 0.6, "#a87a2a");
};
LIVE.harmonograph = (x, lt, t) => {
  const W = SCENE, cx = W / 2, cy = W / 2, n = Math.floor(400 + lt * 9000);
  x.lineWidth = 3.2; x.strokeStyle = "rgba(22,34,74,.85)"; x.beginPath();
  for (let i = 0; i < Math.min(n, 9000); i++) {
    const u = i * 0.012, d = Math.exp(-u * 0.012);
    const px = cx + 480 * d * (Math.sin(u * 2.01 + 0.3) + 0.4 * Math.sin(u * 3.0)), py = cy + 480 * d * (Math.sin(u * 3.02) + 0.35 * Math.sin(u * 2.0 + 1.1));
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.stroke();
};

const MANDEL_FS = `
uniform vec2 res; uniform float time, zoom, lt;
void main(){
  vec2 c0 = vec2(-.743643887, .131825904);
  float z = exp(-lt * 1.6) * 3.2 * zoom;
  vec2 c = c0 + (uv - .5) * z * 1.2;
  vec2 q = vec2(0); float it = 0.;
  for (int i = 0; i < 400; i++){ q = vec2(q.x * q.x - q.y * q.y, 2. * q.x * q.y) + c; if (dot(q, q) > 64.) break; it++; }
  float sm = it - log2(log2(dot(q, q))) + 4.;
  vec3 col = it >= 399. ? vec3(.02, .02, .04) : .5 + .5 * cos(3. + sm * .09 + vec3(0., .6, 1.2));
  col = mix(col, col * vec3(1., .9, .7), .3);
  o = vec4(col, 1);
}`;

function morePlates() {
  plateSunflower(); plateDandelion(); plateEquations(); platePeriodic(); plateBook(); platePrism();
  PLATES.honey = bake(HONEY_FS, 2048, 2048);
  PLATES.world = bake(WORLD_FS, 2600, 2048);
  PLATES.paperC = paper(1600, 1600, [0.93, 0.9, 0.82], { seed: 53, age: 1.2 });
}
