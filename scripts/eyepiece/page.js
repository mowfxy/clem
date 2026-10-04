// The notebook page that opens and closes the film: Mowr's flower drawn in navy ink (on twos, with
// a visible line boil, like Mowr's own illustrations), margin sketches of what the lens showed,
// the wordmark and the closing lines.

const PAGE_W = 3200, PAGE_H = 2200;
const NAVY = "#16224a", RED = "#d9473e";
const FLOWER = { x: 1250, y: 1060, s: 4.2 };       // petal units (144 box) → page px
const PAGE = { paper: null, sketches: [] };

/** Samples the logo's petal outline (the same curve as PETAL) as points in the 144-unit box. */
function petalPoints() {
  const segs = [[[64, 11], [87, 4], [104, 20], [103, 42]], [[103, 42], [103, 57], [94, 70], [84, 72]], [[84, 72], [78, 73], [79, 65], [81, 61]], [[81, 61], [85, 48], [75, 43], [65, 48]], [[65, 48], [55, 52], [49, 43], [49, 31]], [[49, 31], [49, 22], [54, 15], [64, 11]]];
  let pts = [];
  for (const s of segs) pts = pts.concat(bez(...s, 24).slice(pts.length ? 1 : 0));
  return pts;
}
const toPage = (px, py, k) => {             // petal box point, rotated a quarter turn k times, to page coordinates
  const a = k * Math.PI / 2, dx = px - 72, dy = py - 72;
  return [FLOWER.x + (dx * Math.cos(a) - dy * Math.sin(a)) * FLOWER.s, FLOWER.y + (dx * Math.sin(a) + dy * Math.cos(a)) * FLOWER.s];
};

/** A stroke the pen draws between t0 and t1 (film seconds). */
function stroke(pts, t0, t1, w = 5, { color = NAVY, alpha = 0.95 } = {}) { return { kind: "line", pts, t0, t1, w, color, alpha }; }
function ellipsePts(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = TAU, n = 90) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
  return out;
}

function buildPage() {
  PAGE.paper = paper(PAGE_W, PAGE_H, [0.955, 0.935, 0.885], { seed: 21, age: 0.7, edge: 0.12 });
  // faint ruled lines and a margin, like a study notebook
  const x = PAGE.paper.getContext("2d");
  x.strokeStyle = "rgba(70,110,170,.13)"; x.lineWidth = 2;
  for (let y = 180; y < PAGE_H; y += 74) { x.beginPath(); x.moveTo(0, y); x.lineTo(PAGE_W, y); x.stroke(); }
  x.strokeStyle = "rgba(200,70,60,.22)"; x.lineWidth = 3; x.beginPath(); x.moveTo(250, 0); x.lineTo(250, PAGE_H); x.stroke();

  const S = PAGE.sketches = [];
  // the flower, petal by petal, then its centre
  const pet = petalPoints();
  for (let k = 0; k < 4; k++) S.push(stroke(pet.map(([a, b]) => toPage(a, b, k)), 0.7 + k * 0.42, 0.7 + k * 0.42 + 0.5, 6));
  S.push(stroke(ellipsePts(FLOWER.x, FLOWER.y, 34, 34, 0, -1.5, TAU - 1.5, 50), 2.4, 2.65, 6));
  S.push({ kind: "text", text: "fig. i", x: FLOWER.x + 250, y: FLOWER.y - 360, size: 70, font: "'Palace Script MT'", t0: 2.55, t1: 2.9 });
  S.push(stroke([[FLOWER.x + 150, FLOWER.y - 150], [FLOWER.x + 240, FLOWER.y - 330]], 2.45, 2.7, 3));

  // margin sketches drawn at the close: nautilus, fern, orbits, Euclid, a pendulum
  const nx = 2790, ny = 760, spiral = [];
  for (let t = 0; t < 3 * TAU; t += 0.05) { const rr = 7 * Math.exp(0.1775 * t); spiral.push([nx + Math.cos(t) * rr, ny + Math.sin(t) * rr]); }
  S.push(stroke(spiral, 17.3, 18.3, 4.5));
  for (let t = 2 * TAU; t < 3 * TAU - 0.3; t += 0.42) { const a = 7 * Math.exp(0.1775 * (t - TAU)), b = 7 * Math.exp(0.1775 * t); S.push(stroke([[nx + Math.cos(t - TAU) * a, ny + Math.sin(t - TAU) * a], [nx + Math.cos(t) * (a + b) / 2 + 12, ny + Math.sin(t) * (a + b) / 2 + 12], [nx + Math.cos(t) * b, ny + Math.sin(t) * b]], 18.0 + (t - 2 * TAU) * 0.12, 18.15 + (t - 2 * TAU) * 0.12, 3)); }
  S.push({ kind: "text", text: "Nautilus", x: nx - 120, y: ny + 250, size: 64, font: "'Palace Script MT'", t0: 18.4, t1: 18.9 });

  const fx = 860, fy = 2120, rach = bez([fx, fy], [fx + 30, fy - 220], [fx + 150, fy - 400], [fx + 330, fy - 520], 40);
  S.push(stroke(rach, 20.6, 21.1, 4.5));
  for (let i = 4; i < 38; i += 3) { const [px, py] = rach[i], [qx, qy] = rach[i + 1], a = Math.atan2(qy - py, qx - px), l = 115 * Math.sin(Math.PI * (1 - i / 40)); for (const s of [-1, 1]) S.push(stroke([[px, py], [px + Math.cos(a + s * 1.1) * l * 0.5 + Math.cos(a) * 12, py + Math.sin(a + s * 1.1) * l * 0.5 + Math.sin(a) * 12], [px + Math.cos(a + s * 0.95) * l, py + Math.sin(a + s * 0.95) * l]], 20.8 + i * 0.02, 20.95 + i * 0.02, 3)); }

  const ox = 2480, oy = 1780;
  [110, 190, 270].forEach((r, i) => S.push(stroke(ellipsePts(ox, oy, r, r * 0.38, -0.2), 21.0 + i * 0.25, 21.4 + i * 0.25, 3.5)));
  S.push(stroke(ellipsePts(ox, oy, 26, 26), 21.0, 21.2, 5));
  S.push(stroke(ellipsePts(ox + 250, oy - 200, 42, 42, 0, 1.2, 1.2 + Math.PI * 1.15), 21.6, 21.85, 5));
  S.push(stroke(ellipsePts(ox + 266, oy - 207, 36, 36, 0, 1.5, 1.5 + Math.PI * 0.85), 21.8, 22.0, 4));

  const ex = 840, ey = 700, er = 150;
  S.push(stroke(ellipsePts(ex, ey, er, er), 21.2, 21.6, 4.5));
  const hex = [...Array(7)].map((_, i) => [ex + Math.cos(i * TAU / 6 - Math.PI / 2) * er, ey + Math.sin(i * TAU / 6 - Math.PI / 2) * er]);
  S.push(stroke(hex, 21.55, 21.95, 3.5));
  S.push(stroke([hex[0], hex[3]], 21.9, 22.05, 3));
  S.push({ kind: "text", text: "A", x: ex - 14, y: ey - er - 30, size: 56, font: "italic 'Baskerville Old Face'", t0: 22.0, t1: 22.2 });

  S.push({ kind: "text", text: "T = 2π √(L / g)", x: 1500, y: 2020, size: 66, font: "'Baskerville Old Face'", t0: 21.4, t1: 22.0 });
  const px0 = 1970, py0 = 1880; S.push(stroke([[px0, py0], [px0 + 90, py0 + 150]], 21.6, 21.8, 3)); S.push(stroke(ellipsePts(px0 + 98, py0 + 168, 20, 20), 21.8, 21.95, 4));

  // the closing words
  S.push({ kind: "wordmark", t0: 16.25, t1: 17.15 });
  S.push({ kind: "text", text: "The world, in focus.", x: 1762, y: 420, size: 140, font: "MowafySerif", color: NAVY, t0: 19.0, t1: 20.1, center: true });
  S.push({ kind: "text", text: "Free for Windows", x: 1762, y: 1520, size: 100, font: "MowafySerif", color: NAVY, t0: 23.2, t1: 23.8, center: true });
  S.push({ kind: "text", text: "mowrai.com", x: 1762, y: 1650, size: 70, font: "MowafySans", color: RED, t0: 23.6, t1: 24.1, center: true, spacing: 4 });
  // the close happens 6 s later in the longer cut
  for (const k of S) if (k.t0 > 10) { k.t0 += 6; k.t1 += 6; }
}

/** Draws the page into ctx under a camera [cx, cy, span] (page px across the view) at film time t. */
function drawPage(ctx, t, cam, { fill = 0 } = {}) {
  const [cx, cy, span] = cam, s = OUT / span;
  ctx.setTransform(s, 0, 0, s, OUT / 2 - cx * s, OUT / 2 - cy * s);
  ctx.drawImage(PAGE.paper, 0, 0);
  const step = Math.floor(t * 12);                        // on twos at 24 fps
  const boil = Noise2(step * 7 + 3);
  // the flower's colour wash spreads from the centre
  if (fill > 0) {
    ctx.save();
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(FLOWER.x, FLOWER.y); ctx.rotate(k * Math.PI / 2); ctx.scale(FLOWER.s, FLOWER.s); ctx.translate(-72, -72);
      ctx.clip(PETAL);
      const g = ctx.createRadialGradient(72, 72, 0, 72, 72, 75 * fill + 1);
      g.addColorStop(0, "#b8302a"); g.addColorStop(0.55, RED); g.addColorStop(0.92, "#ee7a64"); g.addColorStop(1, "rgba(238,122,100,0)");
      ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.92;
      ctx.fillStyle = g; ctx.fillRect(0, 0, 144, 144);
      ctx.restore();
    }
    ctx.restore();
  }
  for (let k = 0; k < 4 && fill < 1; k++) {
    const st = PAGE.sketches[k], a = clamp((t - st.t1 + 0.1) / 0.4) * 0.16 * (1 - fill);
    if (a <= 0) continue;
    ctx.save(); ctx.translate(FLOWER.x, FLOWER.y); ctx.rotate(k * Math.PI / 2); ctx.scale(FLOWER.s, FLOWER.s); ctx.translate(-72, -72);
    ctx.globalAlpha = a; ctx.fillStyle = RED; ctx.fill(PETAL); ctx.restore();
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const k of PAGE.sketches) {
    if (t < k.t0) continue;
    const p = clamp((t - k.t0) / (k.t1 - k.t0));
    if (k.kind === "line") {
      const pts = k.pts, n = pts.length;
      let total = 0; const acc = [0];
      for (let i = 1; i < n; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc.push(total); }
      const upto = total * easeInOut(p), amp = 1.9 / s;
      ctx.beginPath();
      for (let i = 0; i < n && acc[i] <= upto; i++) {
        const [a, b] = pts[i], jx = boil(a * 0.02, b * 0.02) * amp, jy = boil(b * 0.02 + 9, a * 0.02) * amp;
        i ? ctx.lineTo(a + jx, b + jy) : ctx.moveTo(a + jx, b + jy);
      }
      ctx.strokeStyle = k.color; ctx.globalAlpha = k.alpha; ctx.lineWidth = k.w; ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (k.kind === "text") {
      ctx.save();
      ctx.font = `${k.size}px ${k.font}`; ctx.fillStyle = k.color || NAVY; ctx.textBaseline = "alphabetic";
      if (k.spacing) ctx.letterSpacing = k.spacing + "px";
      const w = ctx.measureText(k.text).width, x0 = k.center ? k.x - w / 2 : k.x;
      ctx.beginPath(); ctx.rect(x0 - 10, k.y - k.size * 1.2, (w + 20) * easeOut(p), k.size * 1.7); ctx.clip();
      ctx.translate(boil(k.x * 0.01, 1) * 1.2, boil(1, k.y * 0.01) * 1.2);
      ctx.fillText(k.text, x0, k.y);
      ctx.restore();
    } else if (k.kind === "wordmark") {
      ctx.save();
      ctx.font = "400 330px MowafySerif"; ctx.fillStyle = NAVY; ctx.textBaseline = "middle";
      const x0 = FLOWER.x + 380, w = ctx.measureText("Mowr").width;
      ctx.beginPath(); ctx.rect(x0 - 20, FLOWER.y - 300, (w + 40) * easeOut(p), 600); ctx.clip();
      ctx.fillText("Mowr", x0, FLOWER.y + 20);
      ctx.restore();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
