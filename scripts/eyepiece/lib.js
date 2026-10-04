// Shared helpers for the eyepiece film: maths, seeded randomness, 2D canvases and a small WebGL2 layer.
// Runs in the browser as a classic script (render.mjs inlines every file into one page).

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = (t) => Math.pow(clamp(t), 3);
const sineInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));

function RNG(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (a) => a[Math.floor(r() * a.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  return r;
}

/** Smooth 2D value noise in [-1, 1] for hand-drawn wobble. */
function Noise2(seed) {
  const r = RNG(seed), P = new Float32Array(512);
  for (let i = 0; i < 512; i++) P[i] = r() * 2 - 1;
  const h = (x, y) => P[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  };
}

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

// ---------------------------------------------------------------- WebGL2

const OUT = 1080;               // delivered frame
const SCENE = 1296;             // scene buffer: 1.2× overscan so the lens can distort past the edge
const view = canvas(OUT, OUT);
document.body.appendChild(view);
const gl = view.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
gl.getExtension("EXT_color_buffer_float");
gl.getExtension("OES_texture_float_linear");
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }`;

const GLSL_LIB = `
#define TAU 6.28318530718
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 ga = hash22(i) * 2. - 1., gb = hash22(i + vec2(1, 0)) * 2. - 1., gc = hash22(i + vec2(0, 1)) * 2. - 1., gd = hash22(i + vec2(1, 1)) * 2. - 1.;
  float a = dot(ga, f), b = dot(gb, f - vec2(1, 0)), c = dot(gc, f - vec2(0, 1)), d = dot(gd, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4; }
float fbm(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++){ s += a * gnoise(p); p = m * p + 3.1; a *= .5; } return s; }
float fbm4(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 4; i++){ s += a * gnoise(p); p = m * p + 3.1; a *= .5; } return s; }
// Voronoi: x = F1, y = F2, zw = id of the nearest cell
vec4 voronoi(vec2 p){ vec2 n = floor(p), f = fract(p); float d1 = 8., d2 = 8.; vec2 id = vec2(0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 g = vec2(i, j), o = hash22(n + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = n + g; } else if (d < d2) d2 = d; }
  return vec4(sqrt(d1), sqrt(d2), id); }
// Distance to the border between cells (exact, two-pass)
vec3 voronoiEdge(vec2 x){ vec2 n = floor(x), f = fract(x), mg, mr; float md = 8.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 g = vec2(i, j), o = hash22(n + g), r = g + o - f; float d = dot(r, r); if (d < md){ md = d; mr = r; mg = g; } }
  md = 8.;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){ vec2 g = mg + vec2(i, j), o = hash22(n + g), r = g + o - f;
    if (dot(mr - r, mr - r) > .00001) md = min(md, dot(.5 * (mr + r), normalize(r - mr))); }
  return vec3(md, n + mg); }
vec3 srgb(vec3 c){ return pow(c, vec3(1. / 2.2)); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const lines = src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
    throw Error("shader: " + gl.getShaderInfoLog(s) + "\n" + lines.slice(0, 200000));
  }
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nin vec2 uv; out vec4 o;\n" + GLSL_LIB + fs));
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error("link: " + gl.getProgramInfoLog(p));
  return { p, loc: {} };
}
function target(w, h, float = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  texParams(false);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fb, tex, w, h };
}
function texParams(mip) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
/** Uploads a 2D canvas (top row at v = 1) as a mipmapped texture; pass `tex` to refresh one. */
function upload(c, tex) {
  const fresh = !tex;
  tex = tex || gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (fresh) {
    texParams(true);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }
  return tex;
}
/** Runs a fragment program into `tgt` (or the view when null). Uniform values: number, array, or {tex}. */
function run(prog, tgt, uni = {}) {
  gl.useProgram(prog.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null);
  gl.viewport(0, 0, tgt ? tgt.w : OUT, tgt ? tgt.h : OUT);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  let unit = 0;
  for (const [k, v] of Object.entries(uni)) {
    let l = prog.loc[k];
    if (l === undefined) l = prog.loc[k] = gl.getUniformLocation(prog.p, k);
    if (l === null) continue;
    if (typeof v === "number") gl.uniform1f(l, v);
    else if (Array.isArray(v)) gl["uniform" + v.length + "fv"](l, v);
    else if (v && v.tex !== undefined) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(l, unit++); }
  }
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
/** Renders a generator shader once and returns it as a 2D canvas (for painting on top of). */
function bake(fs, w, h, uni = {}) {
  const prog = program(fs), t = target(w, h, false);
  run(prog, t, { res: [w, h], ...uni });
  const px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const c = canvas(w, h), ctx = c.getContext("2d"), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
  return c;
}

// ---------------------------------------------------------------- engraving and watercolour in 2D

const INK = "#2b2219";

/** Engraved hatching clipped to `path`: parallel lines whose width follows shade(x, y) in [0, 1]. */
function hatch(ctx, path, box, { angle = 0.6, spacing = 6, maxW = 3.2, shade, color = INK, alpha = 0.9, wobble = 0.7, seed = 1 }) {
  const n = Noise2(seed), L = 10, levels = Array.from({ length: L + 1 }, () => new Path2D());
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, R = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + 4;
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx, seg = 3;
  for (let d = -R; d <= R; d += spacing) {
    let prev = null, prevQ = 0;
    for (let s = -R; s <= R; s += seg) {
      const w0 = n(s * 0.02, d * 0.05) * wobble;
      const x = cx + dx * s + nx * (d + w0), y = cy + dy * s + ny * (d + w0);
      const v = shade(x, y), q = Math.round(clamp(v) * L);
      if (prev && q > 0 && prevQ > 0) { levels[q].moveTo(prev[0], prev[1]); levels[q].lineTo(x, y); }
      prev = [x, y]; prevQ = q;
    }
  }
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineCap = "butt";
  for (let q = 1; q <= L; q++) { ctx.lineWidth = (q / L) * maxW; ctx.stroke(levels[q]); }
  ctx.restore();
}

let MOTTLE = null;
const WASH_RNG = RNG(99);
/** Hand-applied colour wash: multiplied fill, mottled pigment and pooled edges. */
function wash(ctx, path, fill, { alpha = 0.85, edge = 0.55, mottle = 0.35, edgeW = 2.4, under = null } = {}) {
  if (under) { ctx.save(); ctx.fillStyle = under; ctx.fill(path); ctx.restore(); }
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (mottle && MOTTLE) {
    ctx.clip(path);
    ctx.globalAlpha = mottle;
    ctx.drawImage(MOTTLE, (WASH_RNG() * -400) | 0, (WASH_RNG() * -400) | 0, MOTTLE.width, MOTTLE.height);
  }
  ctx.restore();
  if (edge) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha * edge;
    ctx.strokeStyle = fill; ctx.lineWidth = edgeW;
    ctx.stroke(path);
    ctx.restore();
  }
}
function inkLine(ctx, path, w = 1.6, color = INK, alpha = 0.92) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.stroke(path);
  ctx.restore();
}
function boxOf(pts, pad = 4) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a - pad, b - pad, c + pad, d + pad];
}
function polyPath(pts, close = true) {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  if (close) p.closePath();
  return p;
}
/** Samples a cubic Bézier. */
function bez(p0, p1, p2, p3, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
/** A tapering ribbon along a centre line: returns the outline polygon. */
function ribbon(line, w0, w1, wfn) {
  const L = [], R = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const k = i / (line.length - 1), w = (wfn ? wfn(k) : lerp(w0, w1, k)) / 2;
    L.push([line[i][0] - ty * w, line[i][1] + tx * w]);
    R.push([line[i][0] + ty * w, line[i][1] - tx * w]);
  }
  return L.concat(R.reverse());
}
/** Light from the upper left: 0 lit … 1 shadowed, for a shape centred at (cx, cy) with radius r. */
function roundShade(cx, cy, r, { lx = -0.6, ly = -0.75, soft = 1, bias = 0 } = {}) {
  return (x, y) => {
    const u = (x - cx) / r, v = (y - cy) / r;
    return clamp((0.5 + 0.55 * (u * -lx + v * -ly) * soft) * 1.25 - 0.35 + bias);
  };
}

const UNDER = "#f1ebde";
// Lithographic print pass for a painted plate: softened edges, ink spread, pigment granulation,
// slight colour misregistration and the paper's grain showing through every layer.
const PRINT_FS = `
uniform sampler2D img; uniform vec2 res; uniform float seed, soft, grain;
vec3 at(vec2 p){ return texture(img, p / res).rgb; }
void main(){
  vec2 px = uv * res;
  vec3 c = at(px), b = vec3(0), mn = c;
  for (int i = 0; i < 8; i++){ float a = float(i) * .785 + seed; vec2 d = vec2(cos(a), sin(a)) * soft; vec3 s = at(px + d); b += s; mn = min(mn, s); }
  b /= 8.;
  c = mix(c, b, .55);
  c = mix(c, mn, .18);                                  // ink spreads into the paper
  vec3 reg = at(px + vec2(1.4, -.9) * soft);            // colour plate a hair out of register
  c.r = mix(c.r, reg.r, .35);
  float lum = dot(c, vec3(.299, .587, .114));
  float g = vnoise(px / 1.7 + seed) * .55 + vnoise(px / 4.5 + seed * 3.) * .45;
  c *= 1. - grain * (1. - lum) * (g - .5) * 2.;         // pigment settles in the tooth
  c *= .975 + .04 * vnoise(vec2(px.x / 1.3, px.y / 36.) + seed);
  c = mix(vec3(lum), c, .93) * vec3(1.01, 1., .975);    // aged, slightly warm
  o = vec4(c, 1);
}`;
function printify(c, { soft = 1.1, grain = 0.12, seed = 1 } = {}) {
  const tex = upload(c);
  const out = bake(PRINT_FS, c.width, c.height, { img: { tex }, soft, grain, seed });
  gl.deleteTexture(tex);
  return out;
}
