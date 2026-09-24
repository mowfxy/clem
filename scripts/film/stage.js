// The film's compositor. `renderAt(t)` draws output time t (seconds): kinetic title cards, and the
// captured interface under a virtual camera with a drawn cursor, click feedback, a share burst and
// a dragged file. Everything is computed from t, so every frame is deterministic.
const { log, framesBase, live } = window.FILM;
const W = 1920, H = 1080, VW = log.view.width, VH = log.view.height, S0 = W / VW;
const t0 = log.frames[0].t;
const cap = (abs) => abs - t0; // capture seconds from the first frame

// ---------- easing and small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outExpo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const outBack = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);

// ---------- the edit: blocks of footage and title cards ----------
const M = Object.fromEntries(Object.entries(log.marks).map(([k, v]) => [k, cap(v)]));
const events = log.events.map((e) => ({ ...e, c: cap(e.t) }));
const cursor = log.cursor.map((p) => ({ ...p, c: cap(p.t) }));
const focusLog = log.focus.map((f) => ({ ...f, c: cap(f.t) }));
const frameTimes = log.frames.map((f) => cap(f.t));

/** Maps output time inside a block to capture time: waits for the model play fast, idle stretches shrink. */
function buildMap(from, to, pace) {
  // Moments where something is happening on screen.
  const busy = [];
  for (const p of cursor) if (p.c >= from && p.c <= to) busy.push([p.c - 0.03, p.c + 0.03]);
  for (const e of events) if (e.c >= from && e.c <= to) busy.push([e.c - 0.2, e.c + (e.kind === "typing" ? (e.chars * (e.perChar || 45)) / 1000 : e.kind === "hold" ? e.dur : e.kind === "down" ? 0.45 : 0.3)]);
  for (const f of focusLog) if (f.c >= from && f.c <= to) busy.push([f.c, f.c + 0.9]);
  // Waiting for a reply: from the click before a fast-end to the fast-end.
  const fast = [];
  for (const e of events) if (e.kind === "fast-end" && e.c > from && e.c <= to) {
    const click = [...events].reverse().find((x) => x.kind === "up" && x.c < e.c);
    if (click && e.c - click.c > 1.4) fast.push([click.c + 0.5, e.c - 0.1]);
  }
  const pieces = []; let c = from;
  const isBusy = (a, b) => busy.some(([x, y]) => x < b && y > a);
  while (c < to - 1e-6) {
    const f = fast.find(([a, b]) => c >= a && c < b);
    if (f) { pieces.push({ c0: c, c1: f[1], rate: (f[1] - c) / 0.9 }); c = f[1]; continue; }
    const next = Math.min(to, ...fast.map(([a]) => a).filter((a) => a > c), c + 0.25);
    pieces.push({ c0: c, c1: next, rate: isBusy(c, next) ? pace : 7 });
    c = next;
  }
  let o = 0;
  for (const p of pieces) { p.o0 = o; o += (p.c1 - p.c0) / p.rate; p.o1 = o; }
  return { duration: o, at: (t) => { const p = pieces.find((x) => t <= x.o1) || pieces.at(-1); return p.c0 + (clamp(t, p.o0, p.o1) - p.o0) * p.rate; }, inverse: (c) => { const p = pieces.find((x) => c <= x.c1) || pieces.at(-1); return p.o0 + (clamp(c, p.c0, p.c1) - p.c0) / p.rate; } };
}

const plan = [
  { kind: "title", id: "intro", dur: 5.2 },
  { kind: "app", id: "subject", from: M.subject - 0.3, to: M["subject-end"], pace: 1.1, float: "in" },
  { kind: "app", id: "worksheet", from: M.worksheet, to: M["worksheet-end"], pace: 1.35 },
  { kind: "title", id: "pdf", dur: 2.4 },
  { kind: "app", id: "pdf", from: M.pdf, to: M["pdf-end"], pace: 1.3 },
  { kind: "app", id: "handout", from: M.handout, to: M["handout-end"], pace: 1.35 },
  { kind: "title", id: "review", dur: 2.1 },
  { kind: "app", id: "review", from: M.review, to: M["review-end"], pace: 1.6 },
  { kind: "app", id: "search", from: M.search, to: M["search-end"], pace: 1.3 },
  { kind: "app", id: "share", from: M.share, to: M["share-end"], pace: 1.15, float: "out" },
  { kind: "title", id: "end", dur: 6.4 },
];
let at = 0;
for (const b of plan) { if (b.kind === "app") { b.map = buildMap(b.from, b.to, b.pace); b.dur = b.map.duration; } b.start = at; at += b.dur; }
export const DURATION = at;
window.FILM_PLAN = plan.map(({ kind, id, start, dur }) => ({ kind, id, start, dur }));

// ---------- sound cues, in output time ----------
export function cues() {
  const out = [];
  for (const b of plan) {
    if (b.kind === "title") { out.push({ t: b.start, kind: "whoosh" }); if (b.id === "intro") [0.35, 1.05, 2.9, 3.25, 3.6].forEach((d) => out.push({ t: b.start + d, kind: d > 2 ? "pop" : "tick" })); if (b.id === "end") { [0.3, 0.55, 0.8, 1.05, 1.3, 1.55, 2.2, 2.45, 2.7, 2.95, 3.2].forEach((d) => out.push({ t: b.start + d, kind: "type" })); out.push({ t: b.start + 4.1, kind: "logo" }); } continue; }
    const within = (c) => c >= b.from && c <= b.to;
    for (const e of events) if (within(e.c)) {
      const t = b.start + b.map.inverse(e.c);
      if (e.kind === "down") out.push({ t, kind: e.sound || "click" });
      if (e.kind === "burst") out.push({ t, kind: "burst" });
      if (e.kind === "sweep") out.push({ t, kind: "sweep" });
      if (e.kind === "drag") out.push({ t, kind: "lift" });
      if (e.kind === "key") out.push({ t, kind: "click" });
      if (e.kind === "typing") for (let i = 0; i < e.chars; i += 2) out.push({ t: b.start + b.map.inverse(e.c + (i * (e.perChar || 45)) / 1000), kind: "type" });
    }
    let last = null;
    for (const f of focusLog) if (within(f.c)) { if (last && Math.abs(f.zoom - last.zoom) > 0.35) out.push({ t: b.start + b.map.inverse(f.c), kind: "whoosh-soft" }); last = f; }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------- DOM ----------
const root = document.getElementById("stage");
root.innerHTML = `
<div class="bg"></div>
<div id="app" class="app"><img id="shot" alt=""/></div>
<svg id="fx" class="fx" width="${W}" height="${H}"></svg>
<div id="ghost" class="ghost"><span class="gi"></span><span class="gl"></span></div>
<div id="cursor" class="cursor"><svg viewBox="0 0 32 32" width="44" height="44"><path d="M7 3.5v21.8l5.2-5 3.4 8.3 3.9-1.6-3.3-8.1h7.3z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg><i></i></div>
<div id="cards"></div>
${live ? "" : '<div class="demo-tag">Demo · scripted AI replies</div>'}`;
const app = document.getElementById("app"), shot = document.getElementById("shot"), cursorEl = document.getElementById("cursor"), fx = document.getElementById("fx"), ghost = document.getElementById("ghost"), cards = document.getElementById("cards");

const logo = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 144 144" fill="${fill}">${[0, 90, 180, 270].map((a) => `<path transform="rotate(${a} 72 72)" d="M64 11 C87 4 104 20 103 42 C103 57 94 70 84 72 C78 73 79 65 81 61 C85 48 75 43 65 48 C55 52 49 43 49 31 C49 22 54 15 64 11Z"/>`).join("")}</svg>`;
const chip = (cls, icon, text) => `<span class="chip ${cls}"><span class="ci">${icon}</span>${text}</span>`;
const ICON = {
  notes: '<svg viewBox="0 0 20 20" width="22" height="22"><rect x="4" y="2.5" width="12" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  pdf: '<svg viewBox="0 0 20 20" width="22" height="22"><path d="M5 2.5h7l3.5 3.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5V6h3.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  cards: '<svg viewBox="0 0 20 20" width="22" height="22"><rect x="2.5" y="5" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 3h9a2 2 0 0 1 2 2v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
cards.innerHTML = `
<section class="card" data-id="intro">
  <div class="line l1"><span class="w">Your</span> <span class="swap"><span class="word">notes,</span>${chip("c-notes", ICON.notes, "Notes")}</span> <span class="swap"><span class="word">PDFs</span>${chip("c-pdf", ICON.pdf, "PDFs")}</span> <span class="w amp">and</span> <span class="swap"><span class="word">flashcards.</span>${chip("c-cards", ICON.cards, "Flashcards")}</span></div>
  <div class="line l2"><span class="w">One subject.</span></div>
</section>
<section class="card" data-id="pdf"><div class="line big"><span class="w">Edit the</span> <span class="w accent">actual<svg class="ul" viewBox="0 0 300 24" preserveAspectRatio="none"><path d="M4 16 C80 6 200 6 296 14" fill="none" stroke="#d9473e" stroke-width="7" stroke-linecap="round" pathLength="1"/></svg></span> <span class="w">PDF.</span></div><div class="sub">Not a copy. Not a note on top. The file itself.</div></section>
<section class="card" data-id="review"><div class="line big"><span class="w">Then make it</span> <span class="w accent2">stick.</span></div><div class="sub">Every card comes back right before you would forget it.</div></section>
<section class="card" data-id="end">
  <div class="type-line"><span class="typed t1"></span><span class="tag tag-mowr">Mowr</span></div>
  <div class="type-line"><span class="typed t2"></span><span class="tag tag-you">You</span></div>
  <div class="endmark">${logo(78, "#16224a")}<span>mowr</span></div>
  <div class="endsub">Free for Windows · <b>mowrai.com</b></div>
</section>`;
const card = (id) => cards.querySelector(`[data-id="${id}"]`);

function style(el, { o = 1, x = 0, y = 0, s = 1, blur = 0 } = {}) {
  el.style.opacity = o;
  el.style.transform = `translate(${x}px,${y}px) scale(${s})`;
  el.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
}
/** Rise-in with blur, the reference's signature word entrance. */
function rise(el, t, start, dur = 0.7, dist = 34) { const k = outExpo(prog(t, start, dur)); style(el, { o: k, y: (1 - k) * dist, blur: (1 - k) * 12 }); }

function renderCard(b, t) {
  const el = card(b.id), local = t - b.start;
  for (const c of cards.children) c.classList.toggle("on", c === el);
  const fadeOut = b.id === "end" ? 1 : 1 - inOut(prog(local, b.dur - 0.35, 0.35));
  el.style.opacity = fadeOut;
  if (b.id === "intro") {
    const words = el.querySelectorAll(".l1 > .w, .l1 .word");
    [...words].forEach((w, i) => rise(w, local, 0.15 + i * 0.12));
    // Words become chips, one after another.
    el.querySelectorAll(".swap").forEach((sw, i) => {
      const k = prog(local, 2.8 + i * 0.35, 0.5), w = sw.querySelector(".word"), c = sw.querySelector(".chip");
      if (local < 2.8 + i * 0.35) { c.style.opacity = 0; return; }
      style(w, { o: 1 - k, y: -12 * k, blur: 8 * k });
      const kk = prog(local, 2.8 + i * 0.35, 0.55);
      style(c, { o: Math.min(1, kk * 2), s: 0.6 + 0.4 * outBack(kk), y: 0 });
    });
    rise(el.querySelector(".l2 .w"), local, 3.9, 0.8, 40);
    const zoom = 1 + 0.025 * local; el.style.transform = `scale(${zoom})`;
  } else if (b.id === "pdf" || b.id === "review") {
    const ws = el.querySelectorAll(".big .w"); ws.forEach((w, i) => rise(w, local, 0.1 + i * 0.13, 0.7, 40));
    const ul = el.querySelector(".ul path"); if (ul) ul.style.strokeDashoffset = String(1 - inOut(prog(local, 0.7, 0.6)));
    rise(el.querySelector(".sub"), local, 0.75, 0.7, 20);
    el.style.transform = `scale(${1 + 0.02 * local})`;
  } else if (b.id === "end") {
    const t1 = "Mowr makes it.", t2 = "You master it.";
    const n1 = Math.round(clamp((local - 0.2) / 0.09, 0, t1.length)), n2 = Math.round(clamp((local - 2.1) / 0.09, 0, t2.length));
    const e1 = el.querySelector(".t1"), e2 = el.querySelector(".t2");
    e1.textContent = t1.slice(0, n1); e2.textContent = t2.slice(0, n2);
    e1.classList.toggle("caret", local < 2.1); e2.classList.toggle("caret", local >= 2.1 && local < 3.9);
    const g1 = el.querySelector(".tag-mowr"), g2 = el.querySelector(".tag-you");
    style(g1, { o: local > 0.2 && local < 2.1 ? 1 : local >= 2.1 ? 0.0 : 0, s: 1 });
    g1.style.left = `${e1.offsetWidth}px`;
    style(g2, { o: local > 2.1 && local < 3.9 ? 1 : 0 });
    g2.style.left = `${e2.offsetWidth}px`;
    const lines = el.querySelectorAll(".type-line"), out = inOut(prog(local, 3.9, 0.5));
    lines.forEach((l) => style(l, { o: 1 - out, y: -30 * out, blur: 6 * out }));
    const mk = outExpo(prog(local, 4.1, 0.9));
    style(el.querySelector(".endmark"), { o: mk, s: 0.9 + 0.1 * mk, blur: (1 - mk) * 10 });
    rise(el.querySelector(".endsub"), local, 4.6, 0.8, 16);
  }
}

// ---------- camera ----------
function targetOf(f) {
  if (!f || !f.box) return { z: 1, cx: VW / 2, cy: VH / 2 };
  const z = f.zoom, hw = VW / z / 2, hh = VH / z / 2;
  return { z, cx: clamp(f.box.x + f.box.width / 2, hw, VW - hw), cy: clamp(f.box.y + f.box.height / 2, hh, VH - hh) };
}
function camera(b, local) {
  const c = b.map.at(local);
  const list = focusLog.filter((f) => f.c <= c);
  const cur = list.at(-1), prev = list.at(-2);
  const to = targetOf(cur); let from = prev ? targetOf(prev) : to;
  if (!cur) return { z: 1, cx: VW / 2, cy: VH / 2 };
  // A block starts where the story is, not mid-move.
  if (cur.c < b.from) from = to;
  const k = inOut(prog(b.start + local, b.start + b.map.inverse(Math.max(cur.c, b.from)), 1.0));
  const z = Math.exp(lerp(Math.log(from.z), Math.log(to.z), k));
  // Pan in screen space so the move reads as one smooth glide.
  return { z, cx: lerp(from.cx, to.cx, k), cy: lerp(from.cy, to.cy, k) };
}

function cursorAt(c) {
  let p = null;
  for (let i = cursor.length - 1; i >= 0; i--) if (cursor[i].c <= c) { p = cursor[i]; const n = cursor[i + 1]; if (n && n.c - p.c < 0.1) { const k = (c - p.c) / (n.c - p.c); return { x: lerp(p.x, n.x, k), y: lerp(p.y, n.y, k) }; } return p; }
  return cursor[0] || { x: VW / 2, y: VH / 2 };
}

let lastFrame = "";
async function renderApp(b, t) {
  const local = t - b.start, c = b.map.at(local);
  // Latest captured frame at or before this moment.
  let lo = 0, hi = frameTimes.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frameTimes[mid] <= c) lo = mid; else hi = mid - 1; }
  const file = framesBase + log.frames[lo].file;
  if (file !== lastFrame) { shot.src = file; lastFrame = file; await shot.decode().catch(() => {}); }
  // Floating window at the edges of the story; full bleed in between.
  let float = 0;
  if (b.float === "in") float = 1 - inOut(prog(local, 0.55, 1.1));
  if (b.float === "out") float = inOut(prog(local, b.dur - 1.3, 1.1));
  // While the window floats, the camera eases back to the whole app so the window reads as one object.
  const shot0 = camera(b, local), cam = { z: Math.exp(lerp(Math.log(shot0.z), 0, float)), cx: lerp(shot0.cx, VW / 2, float), cy: lerp(shot0.cy, VH / 2, float) };
  const fs = lerp(1, 0.72, float);
  const scale = S0 * cam.z * fs;
  const ox = W / 2 - cam.cx * scale, oy = H / 2 - cam.cy * scale + float * 30;
  app.style.transform = `translate(${ox}px,${oy}px) scale(${scale})`;
  app.style.borderRadius = `${lerp(0, 16, float) / scale}px`;
  app.style.boxShadow = float > 0.01 ? `0 ${40 / scale}px ${120 / scale}px ${-10 / scale}px rgba(20,24,50,${0.45 * float})` : "none";
  const enter = b.float === "in" ? outExpo(prog(local, 0, 0.7)) : 1;
  app.style.opacity = enter;
  // Cursor, in screen space.
  const p = cursorAt(c), sx = ox + p.x * scale, sy = oy + p.y * scale;
  const down = [...events].reverse().find((e) => e.kind === "down" && e.c <= c);
  const since = down ? c - down.c : 9;
  const press = since < 0.25 ? 1 - 0.14 * Math.sin((since / 0.25) * Math.PI) : 1;
  const size = clamp(0.9 + 0.35 * (cam.z * fs - 1), 0.85, 1.6) * press;
  cursorEl.style.transform = `translate(${sx - 9}px,${sy - 5}px) scale(${size})`;
  cursorEl.style.opacity = enter * (b.id === "share" && dragging(c) ? 1 : 1);
  const ring = cursorEl.querySelector("i"), rk = prog(since, 0, 0.45);
  ring.style.opacity = since < 0.45 ? 0.8 * (1 - rk) : 0;
  ring.style.transform = `scale(${0.4 + 1.2 * outExpo(rk)})`;
  // Share burst.
  const burst = events.find((e) => e.kind === "burst" && e.c <= c && c - e.c < 1.4 && e.c >= b.from && e.c <= b.to);
  fx.innerHTML = burst ? burstSvg(ox + burst.x * scale, oy + burst.y * scale, b.start + b.map.inverse(burst.c), t) : "";
  // Dragged file.
  const drag = events.find((e) => e.kind === "drag" && e.c <= c && e.c >= b.from && e.c <= b.to);
  const end = events.find((e) => e.kind === "drag-end" && drag && e.c > drag.c);
  if (drag && (!end || c < end.c + 0.2)) {
    const k = outBack(prog(c, drag.c, 0.35));
    ghost.style.opacity = end && c > end.c ? 0 : 1;
    ghost.style.transform = `translate(${sx + 18}px,${sy + 10}px) rotate(${-4 + 2 * Math.sin(c * 3)}deg) scale(${0.6 + 0.45 * k})`;
    ghost.querySelector(".gl").textContent = drag.label || "Biology 101.mowrpack";
  } else ghost.style.opacity = 0;
}
const dragging = () => false;

function burstSvg(x, y, start, t) {
  const k = prog(t, start, 1.2), e = outExpo(k), fade = 1 - inOut(prog(t, start + 0.55, 0.65));
  const colors = ["#d9473e", "#16224a", "#e9a23b", "#3f7fd9", "#2f9e6e"];
  let s = `<g opacity="${fade}"><circle cx="${x}" cy="${y}" r="${60 + 260 * e}" fill="none" stroke="#e9c27a" stroke-width="${3 * (1 - k)}" opacity="${0.8 * (1 - k)}"/>`;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + (i % 2) * 0.2, r = (90 + (i % 5) * 34) * e + 30, px = x + Math.cos(a) * r * 1.5, py = y + Math.sin(a) * r, rot = (a * 180) / Math.PI + 90 * e, c = colors[i % colors.length];
    const shape = i % 4 === 0 ? `<circle r="9" fill="none" stroke="${c}" stroke-width="4"/>` : i % 4 === 1 ? `<path d="M-10 0 q5-9 10 0 t10 0" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>` : i % 4 === 2 ? `<rect x="-6" y="-6" width="12" height="12" rx="2" fill="${c}"/>` : `<path d="M0-9 L8 7 L-8 7Z" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>`;
    s += `<g transform="translate(${px} ${py}) rotate(${rot}) scale(${0.6 + 0.6 * e})">${shape}</g>`;
  }
  return s + "</g>";
}

export async function renderAt(t) {
  const b = plan.find((x) => t < x.start + x.dur) || plan.at(-1);
  document.body.dataset.block = b.kind;
  if (b.kind === "title") {
    app.style.opacity = 0; cursorEl.style.opacity = 0; fx.innerHTML = ""; ghost.style.opacity = 0;
    cards.style.opacity = 1;
    renderCard(b, t);
    // Cards enter with a quick scale-and-fade.
    const k = outExpo(prog(t - b.start, 0, 0.45));
    cards.style.transform = `scale(${1.04 - 0.04 * k})`; cards.style.opacity = k;
  } else {
    cards.style.opacity = 0;
    await renderApp(b, t);
  }
}
window.renderAt = renderAt;
window.FILM_DURATION = DURATION;
window.FILM_CUES = cues();
