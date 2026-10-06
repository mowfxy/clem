// The film: a shutter opens on the notebook page, the pen finishes the flower, its centre opens onto a
// gathering run of plates (everything you could study) in windows that change shape on the cut, the moon
// in the round lens, and back out to the page for the title.

const DURATION = 32;

// ---------------------------------------------------------------- live shaders

const PLATE_FS = `
uniform sampler2D tex; uniform vec2 tsize, cen; uniform float span, rot; uniform vec3 bg;
void main(){
  vec2 p = uv - .5; float c = cos(rot), s = sin(rot); p = mat2(c, -s, s, c) * p;
  vec2 px = cen + vec2(p.x, -p.y) * span;
  vec2 t = vec2(px.x / tsize.x, 1. - px.y / tsize.y);
  vec3 col = texture(tex, t).rgb;
  vec2 e = min(t, 1. - t);
  col = mix(bg, col, smoothstep(-.002, .004, min(e.x, e.y)));
  o = vec4(col, 1);
}`;

const RIPPLE_FS = `
uniform vec2 res; uniform float time, zoom;
float H(vec2 p){
  vec2 s1 = vec2(-.2, .02), s2 = vec2(.2, -.02);
  float r1 = length(p - s1), r2 = length(p - s2);
  return sin(r1 * 150. - time * 14.) / (1. + r1 * 5.) + sin(r2 * 150. - time * 14.) / (1. + r2 * 5.);
}
void main(){
  vec2 p = (uv - .5) * 1.2 * zoom;
  float h = H(p);
  float e = .0012, gx = H(p + vec2(e, 0)) - h, gy = H(p + vec2(0, e)) - h;
  float caust = clamp(.5 - (gx + gy) * 4., 0., 1.);
  vec3 c = mix(vec3(.05, .06, .07), vec3(.86, .9, .93), smoothstep(-.9, 1.1, h) * .7 + caust * .3);
  c *= 1. - .6 * smoothstep(.35, .8, length(p));
  c += vec3(.9) * (1. - smoothstep(.006, .012, length(p - vec2(-.2, .02))));
  c += vec3(.9) * (1. - smoothstep(.006, .012, length(p - vec2(.2, -.02))));
  c *= .92 + .08 * vnoise(uv * res / 1.5);
  o = vec4(c, 1);
}`;

const SUN_FS = `
uniform vec2 res; uniform float time, zoom;
void main(){
  vec2 p = (uv - .5) * 1.2 * zoom;
  float r = length(p), R = .2;
  vec3 c = vec3(1., .42, .1) * (exp(-max(0., r - R) * 9.) * .9 + exp(-max(0., r - R) * 3.) * .25);
  if (r < R){
    float mu = sqrt(1. - r * r / (R * R));
    float g = fbm(p * 60. + time * .3) * .5 + fbm(p * 18. - time * .2) * .5;
    vec3 disc = mix(vec3(1., .45, .08), vec3(1., .9, .62), pow(mu, .7));
    disc *= (.55 + .45 * pow(mu, .45)) * (1. + .12 * g);
    c = mix(c, disc * 1.25, 1. - smoothstep(R - .004, R, r));
  }
  o = vec4(c, 1);
}`;

const COMPOSITE_FS = `
uniform sampler2D scene, over;
uniform vec2 ap, shift, innerC, box, shut; uniform float rc, R, eye, blur, spin, ca, tube, flash, fade, time, distort, grain, vign, innerFade, pageAmt, innerR, pageBlur, punch;
vec3 S(vec2 v){ return texture(scene, .5 + (v - .5) / 1.2).rgb; }
vec2 rotA(vec2 v, vec2 c, float a){ float co = cos(a), si = sin(a); v -= c; return c + mat2(co, -si, si, co) * v; }
float tubeL(float s, float th){
  float x = s - 1.;
  float L = .75 * exp(-pow((x - .02) / .01, 2.)) + .32 * exp(-pow((x - .085) / .03, 2.));
  float f = 2.3 + 6. * tube;
  L += .22 * (.5 + .5 * cos(x * TAU * f)) * exp(-x * (1.3 - .6 * tube));
  L *= .45 + .55 * max(0., cos(th - 2.3)) + .1;
  return L * smoothstep(1., 1.006, s);
}
void main(){
  vec2 v = uv;
  // the aperture is a rounded box: a circle when rc = box = R, a card, a slit or the whole frame otherwise.
  // r is 1 on its edge and grows outward in rings that follow the shape.
  vec2 d = (v - ap) / R, bq = abs(v - ap) - box + rc;
  float r = 1. + (length(max(bq, 0.)) + min(max(bq.x, bq.y), 0.) - rc) / R, th = atan(d.y, d.x);
  float k = distort * eye;
  vec2 vd = ap + (v - ap) * (1. + k * (r * r - 1.) * .5) / (1. + punch);
  vec3 acc = vec3(0);
  const int N = 24;
  for (int i = 0; i < N; i++){
    float fi = (float(i) + .5) / float(N);
    float a = float(i) * 2.39996;
    vec2 off = vec2(cos(a), sin(a)) * sqrt(fi) * blur / 1080.;
    vec2 q = rotA(vd, ap, spin * (fi - .5)) + shift * (fi - .5) + off;
    vec2 cad = (q - ap) * ca * (.3 + r * r);
    acc += vec3(S(q + cad).r, S(q).g, S(q - cad).b);
  }
  vec3 col = acc / float(N);
  // a round lens darkens softly toward its rim; a card or slit only gets a thin inner shadow
  float rnd = rc / R, rim = mix(.9, .6, rnd);
  col *= mix(1., 1. - (mix(.35, .5, rnd) + punch * 3.) * smoothstep(rim - punch * 2., 1.02, r), eye);
  col += vec3(1., .97, .92) * mix(.03, .07, rnd) * eye * smoothstep(mix(.97, .92, rnd), 1., r) * (1. - smoothstep(.99, 1.02, r));
  vec3 page = texture(over, v, pageBlur).rgb;
  float inC = innerR > 0. ? 1. - smoothstep(innerR - .0015, innerR + .0015, length(v - innerC)) : 0.;
  col = mix(col, page, innerFade * (1. - inC));
  col += vec3(1., .97, .9) * .08 * inC * smoothstep(innerR * .8, innerR, length(v - innerC));
  // the shutter: four engraved navy blades that slide back to a widening window
  if (shut.y < .6){
    vec2 a = abs(v - .5) - shut;
    float bx = smoothstep(-.0012, .0012, a.x), by = smoothstep(-.0012, .0012, a.y);
    float hy = abs(fract(v.y * 1080. / 5.5 + .2 * vnoise(v * 40.)) - .5) * 2.;
    float hx = abs(fract(v.x * 1080. / 5.5 + .2 * vnoise(v * 40. + 7.)) - .5) * 2.;
    vec3 bc = vec3(.055, .07, .13);
    vec3 cy = bc * (.72 + .45 * smoothstep(.35, .7, hy)) + vec3(.45, .5, .64) * .55 * exp(-max(a.y, 0.) * 1080. / 2.5);
    vec3 cx = bc * (.8 + .45 * smoothstep(.35, .7, hx)) + vec3(.45, .5, .64) * .55 * exp(-max(a.x, 0.) * 1080. / 2.5);
    cy *= .8 + .3 * smoothstep(.6, .05, a.y); cx *= .8 + .3 * smoothstep(.6, .05, a.x);
    col = mix(col, cy, by);
    col = mix(col * (1. - .5 * exp(-max(-a.x, 0.) * 1080. / 8.) * bx), cx, bx);
  }
  // the barrel: navy, engraved with fine turned rings whose weight follows the light
  float px = r * R * 1080.;
  float wob = .25 * vnoise(vec2(th * 18., px * .02));
  float ln = abs(fract(px / 5.2 + wob) - .5) * 2.;
  float L = clamp(tubeL(r, th) * (.75 + .5 * vnoise(vec2(th * 30., px * .01))), 0., 1.);
  float ink = 1. - smoothstep(1. - L * .45 - .1, 1. - L * .45 + .1, ln);
  vec3 tubeC = mix(vec3(.012, .018, .048), vec3(.42, .45, .58), ink * .4);
  vec3 outside = mix(tubeC, page, pageAmt);
  float edge = 1. + (vnoise(vec2(th * 40., 0.)) - .5) * .01;
  float inside = mix(1., step(r, edge), eye);
  vec3 c = mix(outside, col, inside);
  vec2 vq = v - .5; c *= 1. - vign * dot(vq, vq) * 1.6;
  c = c + flash * (1. - c) * .55;
  vec2 fc = gl_FragCoord.xy;
  float g = hash12(fc + fract(time * 13.7) * 541.) - .5;
  float lum = dot(c, vec3(.3, .59, .11));
  c += g * grain * (.35 + .65 * sqrt(lum));
  c *= 1. - fade;
  o = vec4(c, 1);
}`;

// ---------------------------------------------------------------- the lattice (drawn every frame)

let LATTICE_PAPER = null;
function paintLattice(c, t) {
  const x = c.getContext("2d"), W = c.width;
  x.drawImage(LATTICE_PAPER, 0, 0);
  const atoms = [], bonds = [], n = 3, sp = 170, a = t * 0.9 + 0.5, b = 0.55 + 0.1 * Math.sin(t);
  const P = (i, j, k) => {
    let X = (i - 1) * sp, Y = (j - 1) * sp, Z = (k - 1) * sp;
    [X, Z] = [X * Math.cos(a) - Z * Math.sin(a), X * Math.sin(a) + Z * Math.cos(a)];
    [Y, Z] = [Y * Math.cos(b) - Z * Math.sin(b), Y * Math.sin(b) + Z * Math.cos(b)];
    const f = 1400 / (1400 + Z);
    return [W / 2 + X * f, W / 2 + Y * f, Z, f];
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    atoms.push({ p: P(i, j, k), na: (i + j + k) % 2 === 0 });
    for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) if (i + di < n && j + dj < n && k + dk < n) bonds.push([P(i, j, k), P(i + di, j + dj, k + dk)]);
  }
  x.lineCap = "round";
  bonds.sort((u, v) => v[0][2] + v[1][2] - u[0][2] - u[1][2]);
  for (const [p, q] of bonds) { x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.strokeStyle = "#3a2c22"; x.lineWidth = 9 * p[3]; x.stroke(); x.strokeStyle = "#c9b79a"; x.lineWidth = 5 * p[3]; x.stroke(); }
  atoms.sort((u, v) => v.p[2] - u.p[2]);
  for (const A of atoms) {
    const [px, py, , f] = A.p, R = (A.na ? 22 : 34) * f;
    const g = x.createRadialGradient(px - R * 0.35, py - R * 0.4, R * 0.05, px, py, R);
    if (A.na) { g.addColorStop(0, "#f3e6f4"); g.addColorStop(0.5, "#9b6fae"); g.addColorStop(1, "#3c2448"); }
    else { g.addColorStop(0, "#eef6dc"); g.addColorStop(0.5, "#7fae5a"); g.addColorStop(1, "#24401c"); }
    x.beginPath(); x.arc(px, py, R, 0, TAU); x.fillStyle = g; x.fill(); x.lineWidth = 2; x.strokeStyle = "#2a1f16"; x.stroke();
  }
  x.font = "italic 46px 'Baskerville Old Face'"; x.fillStyle = "#2a1f16"; x.fillText("Chlorure de sodium", 220, W - 220);
}

// ---------------------------------------------------------------- moving between plates

// Two plates meet in the lens without a cut: they slide past each other, zoom through, turn like a
// turret, one sheet lands on another, or the focus racks from one to the next. Motion blur comes
// from sampling the move across a short shutter.
const TRANS_FS = `
uniform sampler2D A, B; uniform float mode, p, ang, shutter; uniform vec2 dir, zc;
bool inside(vec2 u){ return u.x >= 0. && u.y >= 0. && u.x <= 1. && u.y <= 1.; }
vec3 TA(vec2 u, float b){ return texture(A, clamp(u, 0., 1.), b).rgb; }
vec3 TB(vec2 u, float b){ return texture(B, clamp(u, 0., 1.), b).rgb; }
vec2 rot(vec2 u, float a){ float c = cos(a), s = sin(a); u -= .5; return .5 + mat2(c, -s, s, c) * u; }
float ease(float t){ return t < .5 ? 4. * t * t * t : 1. - pow(-2. * t + 2., 3.) / 2.; }
vec3 frameAt(vec2 u, float e){
  if (mode < .5){ vec2 ua = u + dir * e; if (inside(ua)) return TA(ua, 0.); return TB(u - dir * (1. - e), 0.); }
  if (mode < 1.5){
    float za = exp(e * log(7.)); vec2 ua = zc + (u - zc) / za;
    float zb = exp((1. - e) * log(2.2)); vec2 ub = .5 + (u - .5) / zb;
    return mix(TA(ua, 0.), TB(ub, 0.), smoothstep(.38, .68, e));
  }
  if (mode < 2.5){ return mix(TA(rot(u, -e * ang), 0.), TB(rot(u, (1. - e) * ang), 0.), smoothstep(.42, .58, e)); }
  if (mode < 3.5){
    vec2 ub = u - dir * (1. - e);
    if (inside(ub)) return TB(ub, 0.) * (.92 + .08 * e);
    vec2 d = ub - clamp(ub, 0., 1.);
    float sh = exp(-length(d) * 28.) * .45 * step(.001, e);
    return TA(u + dir * e * .22, 0.) * (1. - .2 * e) * (1. - sh);
  }
  return mix(TA(u, e * 5.), TB(u, (1. - e) * 5.), smoothstep(.3, .7, e));
}
void main(){
  if (p <= 0.){ o = vec4(TA(uv, 0.), 1); return; }
  if (mode > 3.5){ o = vec4(frameAt(uv, ease(p)), 1); return; }
  vec3 acc = vec3(0);
  const int N = 14;
  for (int j = 0; j < N; j++){ float q = clamp(p + (float(j) / float(N - 1) - .5) * shutter, 0., 1.); acc += frameAt(uv, ease(q)); }
  o = vec4(acc / float(N), 1);
}`;
const MODES = { slide: 0, zoom: 1, spin: 2, sheet: 3, rack: 4 };

// ---------------------------------------------------------------- the edit

// Hard cuts on the beat (120 BPM from the hit): halves, then quarters, then eighths into the moon.
// Every shot keeps moving while it is on screen, so nothing sits still like a slide.
const C = (cx, cy, span, rot = 0) => [cx, cy, span, rot];
const sh = (src, from, to, extra = {}) => ({ src, from, to, ...extra });
const live = (name, extra = {}) => ({ gl: name, ...extra });
const full = (name, base, extra = {}) => ({ full: name, src: base, ...extra });
const BLACK = { bg: [0, 0, 0] };

const DIVE0 = 2.9, HIT = 4.4, HIT2 = 16.4, MOON = 18.4, PULL = 20.1, OUTOF = 20.65, CLOSE_END = 22.4, IRIS = [0.45, 0.8, 1.15];
// The run: two half beats from the hit, quarter beats for five bars, eighths into the moon.
const RUN = [
  sh("butterflies", C(1200, 470, 1000, 0.1), C(1240, 520, 760, -0.05)),
  sh("fern", C(1300, 1400, 1500, 0.3), C(1100, 1000, 1150, 0.1)),
  sh("nautilus", C(1150, 1080, 1200, 0), C(1150, 1080, 950, -0.4)),
  sh("snow", C(1024, 1024, 1500, 0), C(1024, 1024, 1250, 0.2), { live: "snow", ...BLACK }),
  sh("feather", C(1100, 900, 1500, 0.1), C(1250, 800, 1200, 0.15)),
  sh("sunflower", C(1024, 1024, 1500, 0), C(1024, 1024, 1150, 0.25)),
  sh("leaf", C(1024, 1024, 1700, 0.1), C(1024, 1024, 1200, 0.18)),
  live("cells"),
  sh("scallop", C(1024, 1100, 1700, 0), C(1024, 1150, 1400, 0.05)),
  sh("dandelion", C(1024, 1024, 1700, 0), C(1024, 1024, 1350, 0.1), BLACK),
  sh("honey", C(1024, 1024, 1500, 0), C(1150, 980, 1250, 0.05)),
  sh("coral", C(1024, 1100, 1700, 0), C(1024, 900, 1400, 0)),
  sh("rings", C(860, 1120, 1500, 0), C(900, 1100, 1250, 0.12)),
  sh("fish", C(900, 820, 1400, 0), C(1500, 820, 1300, 0)),
  sh("herbal", C(820, 1050, 900, 0.05), C(830, 980, 780, 0.08)),
  sh("geode", C(1024, 1024, 1700, 0), C(1024, 1024, 1350, 0.2)),
  sh("geology", C(900, 1000, 1500, 0), C(1250, 1000, 1400, 0)),
  sh("world", C(1100, 1000, 1700, 0), C(1400, 950, 1500, 0)),
  sh("compass", C(1024, 1024, 1900, 0), C(1024, 1024, 1500, 0.3)),
  sh("topo", C(1300, 900, 1400, 0.3), C(1150, 1050, 1250, 0.3)),
  full("blueprint", "blank"),
  sh("circuit", C(1100, 950, 2000, 0), C(1250, 1050, 1700, 0), { live: "circuit" }),
  full("gears", "paperC"),
  full("clock", "paperC"),
  sh("radiolaria", C(1100, 1100, 1700, 0), C(1100, 1100, 1350, 0.1), { live: "radiolaria" }),
  sh("equations", C(800, 700, 1400, -0.04), C(1100, 800, 1300, -0.02)),
  sh("sliderule", C(900, 700, 1300, 0), C(1700, 700, 1300, 0)),
  sh("periodic", C(900, 820, 1300, 0), C(1450, 860, 1200, 0)),
  full("atom", "paperA"),
  full("magnet", "paperB"),
  sh("book", C(900, 600, 1300, 0.03), C(1000, 700, 1100, 0.01)),
  sh("coral", C(1150, 700, 900, 0.1), C(1180, 650, 760, 0.15)),
  sh("kanji", C(1024, 1000, 1700, 0), C(1024, 1000, 1350, 0)),
  sh("music", C(900, 900, 1500, 0), C(1600, 900, 1500, 0)),
  sh("chess", C(1024, 1700, 1500, 0.15), C(1024, 1750, 1250, 0.25)),
  full("dna", "paperA"),
  full("pendulum", "paperB"),
  full("harmonograph", "paperA"),
  live("ripple"),
  sh("prism", C(1024, 1024, 1900, 0), C(1150, 1024, 1650, 0), BLACK),
  sh("honey", C(700, 1300, 900, 0.5), C(760, 1250, 760, 0.55)),
  live("mandel", { zoom: 1 }),
  sh("euclid", C(1050, 1150, 1800, 0.3), C(1050, 1150, 1650, 0.2)),
  sh("bubble", C(1024, 1024, 1900, 0), C(1024, 1024, 1700, 0.1), { live: "bubble", ...BLACK }),
  sh("stars", C(1100, 1100, 1900, 0), C(1100, 1100, 1750, -0.1), { live: "stars" }),
  live("saturn"),
  // climax: eighths
  live("sun"),
  sh("orrery", C(1200, 1024, 2000, 0), C(1200, 1024, 1850, 0), { live: "orrery" }),
  live("galaxy"),
  full("lattice", "paperA"),
  sh("herbal", C(850, 900, 900, 0), C(850, 850, 800, 0)),
  sh("butterflies", C(1500, 1150, 800, 0), C(1500, 1150, 700, 0.05)),
  live("mandel", { zoom: 0.02 }),
  sh("stars", C(1300, 1500, 900, 0), C(1300, 1500, 800, 0)),
  full("gears", "paperC"),
  sh("world", C(700, 1400, 1100, 0), C(850, 1350, 950, 0)),
  sh("chess", C(900, 260, 800, 0), C(900, 260, 700, 0.1)),
  sh("compass", C(1024, 1024, 900, 0.5), C(1024, 1024, 800, 0.7)),
  sh("geode", C(1024, 1024, 900, 0), C(1024, 1024, 760, 0.2)),
  live("cells"),
  sh("feather", C(1500, 520, 800, 0.2), C(1520, 500, 700, 0.25)),
  sh("snow", C(1024, 1024, 900, 0.3), C(1024, 1024, 800, 0.4), BLACK),
];
// The window changes shape with the music: the whole frame, a tall card, a wide plate, a slit, a
// rounded square, now and then the round lens. It only ever changes on a cut.
const FRAMES = {
  full: { box: [0.62, 0.62], rc: 0.02 },
  tall: { box: [0.3, 0.45], rc: 0.012 },
  wide: { box: [0.46, 0.3], rc: 0.012 },
  slit: { box: [0.47, 0.19], rc: 0.01 },
  square: { box: [0.4, 0.4], rc: 0.07 },
  round: { box: [0.47, 0.47], rc: 0.47 },
};
// one frame per bar of quarter shots (four cuts), then one per pair of eighths
const BARS = ["tall", "full", "wide", "round", "full", "square", "slit", "full", "tall", "round", "full"];
const CLIMAX = ["full", "tall", "full", "wide", "full", "square", "full", "round"];
const SEG = [{ src: "herbal", live: "herbal", from: C(1350, 900, 2000, -0.04), to: C(1720, 540, 900, 0.02), start: DIVE0, end: HIT, dive: true, frame: "full" }];
{
  let t = HIT, q = 0, e = 0;
  RUN.forEach((s) => {
    if (t >= MOON - 0.01) return;
    const d = t < HIT + 0.99 ? 0.5 : t < HIT2 - 0.01 ? 0.25 : 0.125;
    const frame = d === 0.5 ? "full" : d === 0.25 ? BARS[Math.floor(q++ / 4) % BARS.length] : CLIMAX[Math.floor(e++ / 2) % CLIMAX.length];
    SEG.push({ ...s, start: t, end: Math.min(t + d, MOON), frame });
    t += d;
  });
  t = MOON;
  SEG.push({ src: "moon", from: C(1024, 1024, 2350, -0.06), to: C(1024, 1024, 1900, 0.06), start: t, end: CLOSE_END, R: 0.36, close: true, bg: [0, 0, 0] });
}
const CUES = [];
for (const s of SEG) if (s.start > HIT - 0.01 && s.start < MOON + 0.1) CUES.push({ t: s.start, kind: "cut", gap: s.end - s.start });
CUES.push({ t: DIVE0, kind: "swing" }, { t: HIT, kind: "hit" }, { t: HIT2, kind: "hit2" }, { t: MOON, kind: "moon" }, { t: PULL, kind: "pull" }, { t: OUTOF, kind: "sky" },
  { t: 22.25, kind: "title" }, { t: 25.0, kind: "title2" }, { t: 29.2, kind: "url" });
for (const t of IRIS) CUES.push({ t, kind: "iris" });

// where the page camera looks: [t, [cx, cy, span]]
const KEYS = [
  [0, [FLOWER.x + 40, FLOWER.y + 10, 1500]], [DIVE0, [FLOWER.x + 10, FLOWER.y, 1300]],
  [OUTOF, [FLOWER.x, FLOWER.y, 34 / 0.07]], [22.3, [1762, 1060, 1750]], [23.2, [1762, 1040, 1650]],
  [24.6, [1762, 960, 1900]], [26.3, [1762, 980, 1850]], [28.4, [1762, 1100, 2200]], [30.2, [1762, 1110, 2180]], [99, [1762, 1110, 2120]],
];
function pageCam(t) {
  if (t > DIVE0 && t < OUTOF - 0.5) {
    const k = clamp((t - DIVE0) / (HIT - 0.1 - DIVE0)), e = Math.pow(k, 1.7);
    const span = Math.exp(lerp(Math.log(1300), Math.log(34 / 0.75), e));
    return [lerp(FLOWER.x + 10, FLOWER.x, smooth(0, 0.4, k)), FLOWER.y, span];
  }
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const [t0, a] = KEYS[i], [t1, b] = KEYS[i + 1], u = clamp((t - t0) / (t1 - t0)), k = sineInOut(u);
  const z = i === 2 ? easeOut(u) : k;
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), Math.exp(lerp(Math.log(a[2]), Math.log(b[2]), z))];
}

// ---------------------------------------------------------------- per frame

let sceneT, overC, overTex, PROG = {};
const SLOTS = [];
function segCam(s, t) {
  const k = clamp((t - s.start) / (s.end - s.start));
  return s.from ? s.from.map((v, i) => lerp(v, s.to[i], k)) : null;
}
/** Renders one shot into a slot and returns its texture. */
function paintSeg(s, t, slot, camOverride) {
  const lt = t - s.start, k = clamp(lt / (s.end - s.start));
  if (s.gl) {
    run(PROG[s.gl], slot.target, { res: [SCENE, SCENE], time: t, lt, zoom: s.zoom !== undefined ? s.zoom : lerp(1.1, 0.92, k) });
    return slot.target.tex;
  }
  const x = slot.canvas.getContext("2d"), bg = s.bg || [0.93, 0.91, 0.86];
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = `rgb(${bg.map((v) => Math.round(v * 255)).join(",")})`; x.fillRect(0, 0, SCENE, SCENE);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  if (s.full) {
    x.drawImage(PLATES[s.src], 0, 0, SCENE, SCENE);
    // a slow push even on the full-frame painters
    const z = 1 + 0.08 * k;
    x.translate(SCENE / 2, SCENE / 2); x.scale(z, z); x.translate(-SCENE / 2, -SCENE / 2);
    LIVE[s.full](x, lt, t);
  } else {
    const cam = camOverride || segCam(s, t), sc = SCENE / cam[2];
    x.translate(SCENE / 2, SCENE / 2); x.rotate(cam[3]); x.scale(sc, sc); x.translate(-cam[0], -cam[1]);
    x.drawImage(PLATES[s.src], 0, 0);
    if (s.live) LIVE[s.live](x, t - SEG.find((q) => q.src === s.src && q.live === s.live).start, t);
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  upload(slot.canvas, slot.tex);
  return slot.tex;
}

function frameU(name) {
  const f = FRAMES[name];
  return { box: f.box, rc: f.rc, R: Math.min(f.box[0], f.box[1]) };
}
function renderAt(t) {
  const U = { eye: 1, R: 0.47, ap: [0.5, 0.5], blur: 0, spin: 0, shift: [0, 0], ca: 0.012, tube: 0, flash: 0, fade: 0, time: t, distort: 0.14, grain: 0.07, vign: 0.25, innerFade: 0, pageAmt: 0, innerR: 0, innerC: [0.5, 0.5], shut: [1, 1], box: null, rc: 0, pageBlur: 0, punch: 0 };
  const cam = pageCam(t);
  const fv = [0.5 + (FLOWER.x - cam[0]) / cam[2], 0.5 - (FLOWER.y - cam[1]) / cam[2]];
  if (t < HIT || t > PULL) {
    drawPage(overC.getContext("2d"), t, cam, { fill: smooth(21.5, 22.7, t) });
    upload(overC, overTex);
  }
  if (t < DIVE0) {
    // the opening: four shutter blades closed in the dark click back three times to a widening
    // window on the page, then slide away while the focus racks onto it
    let o = 0;
    for (const it of IRIS) o += 0.085 * easeOut(clamp((t - it) / 0.09));
    o += (0.62 - 0.255) * sineInOut(clamp((t - 1.3) / 0.65));
    Object.assign(U, { innerFade: 1, shut: [o * 1.42, o], pageBlur: 5 * (1 - smooth(1.15, 2.2, t)), ...frameU("full") });
    U.fade = 1 - smooth(0, 0.35, t);
    for (const it of IRIS) if (t >= it) U.flash += 0.06 * Math.exp(-(t - it) * 20);
    const w = RNG(Math.floor(t * 24) + 1);
    U.ap = [0.5 + w.range(-0.0007, 0.0007), 0.5 + w.range(-0.0007, 0.0007)];
    run(PROG.comp, null, { scene: { tex: sceneT.tex }, over: { tex: overTex }, ...U });
    return;
  }
  if (t >= CLOSE_END) {
    Object.assign(U, { ...frameU("full"), eye: 0, innerFade: 1, ca: 0.003, distort: 0, vign: 0.3, grain: 0.05 });
    U.fade = t < 1 ? 1 - smooth(0, 0.4, t) : smooth(DURATION - 0.5, DURATION - 0.02, t);
    run(PROG.comp, null, { scene: { tex: sceneT.tex }, over: { tex: overTex }, ...U });
    return;
  }
  let i = SEG.findIndex((s) => t < s.end); if (i < 0) i = SEG.length - 1;
  const s = SEG[i];
  Object.assign(U, frameU(s.frame || "full"));
  let moonCam = null;
  if (s.close) {
    const pp = smooth(PULL, OUTOF, t);
    U.R = t < OUTOF ? lerp(0.36, 0.07, easeIn(pp)) : 34 / cam[2];
    Object.assign(U, { box: [U.R, U.R], rc: U.R });
    if (t >= OUTOF) U.ap = fv;
    U.tube = pp;
    U.pageAmt = smooth(PULL + 0.25, OUTOF + 0.1, t);
    U.innerFade = smooth(21.2, 22.1, t);
    U.blur = pp * (1 - smooth(OUTOF, OUTOF + 0.4, t)) * 5;
    U.ca *= 1 - smooth(OUTOF, OUTOF + 0.75, t);
    moonCam = segCam(s, t);
    moonCam[2] = Math.max(moonCam[2], 1086 / Math.max(U.R, 0.01));
    moonCam[0] = 1024 - (U.ap[0] - 0.5) / 1.2 * moonCam[2]; moonCam[1] = 1024 + (U.ap[1] - 0.5) / 1.2 * moonCam[2];
  }
  const tex = paintSeg(s, t, SLOTS[0], moonCam);
  run(PROG.trans, sceneT, { A: { tex }, B: { tex }, mode: 0, p: 0, ang: 1, shutter: 0, dir: [1, 0], zc: [0.5, 0.5] });
  if (s.dive) {
    // inside the lens, the flower's centre opens as a second lens and grows until it fills the first
    U.innerFade = 1; U.innerC = fv; U.innerR = Math.min(0.75, 34 / cam[2]);
    U.blur = 2 * smooth(3.6, 4.0, t) * (1 - smooth(4.1, 4.4, t));
  }
  // the hits land as a punch of the lens, not a flash: a quick push in that settles back
  for (const h of [HIT, HIT2]) if (t >= h) { const d = t - h; U.punch += 0.07 * Math.exp(-d * 9) * Math.cos(d * 22); U.ca += 0.02 * Math.exp(-d * 12); }
  // every cut lands with a small kick of exposure, on the beat
  if (!s.dive && !(s.close && t > OUTOF)) {
    const w = RNG(Math.floor(t * 24) + 1);
    U.ap = [U.ap[0] + w.range(-0.0007, 0.0007), U.ap[1] + w.range(-0.0007, 0.0007)];
    const b = 1 + 0.004 * Math.sin(t * 7);
    U.R *= b; U.box = U.box.map((v) => v * b); U.rc *= b;
  }
  run(PROG.comp, null, { scene: { tex: sceneT.tex }, over: { tex: overTex }, ...U });
}

window.STAGE = {
  plates: PLATES, duration: DURATION, cues: CUES,
  async build() {
    MOTTLE = bake(MOTTLE_FS, 3400, 2600);
    plateHerbal(); plateFern(); plateNautilus(); shaderPlates(); plateCircuit(); plateRadiolaria(); plateBubble(); plateEuclid(); plateStars(); plateOrrery();
    newPlates(); morePlates(); evenMorePlates();
    buildPage();
    for (const k of PAGE.sketches) CUES.push({ t: k.t0, kind: "pen", dur: k.t1 - k.t0, text: k.kind !== "line" });
    LATTICE_PAPER = paper(SCENE, SCENE, [0.94, 0.91, 0.84], { seed: 30 });
    sceneT = target(SCENE, SCENE, true);
    overC = canvas(OUT, OUT); overTex = upload(overC);
    for (let k = 0; k < 2; k++) { const c = canvas(SCENE, SCENE); SLOTS.push({ canvas: c, tex: upload(c), target: target(SCENE, SCENE, true) }); }
    PROG = { trans: program(TRANS_FS), ripple: program(RIPPLE_FS), sun: program(SUN_FS), galaxy: program(GALAXY_FS), cells: program(CELLS_LIVE_FS), mandel: program(MANDEL_FS), saturn: program(SATURN_FS), comp: program(COMPOSITE_FS) };
  },
  renderAt,
};
