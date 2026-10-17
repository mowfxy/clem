import { BrowserWindow } from "electron";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { contrast } from "./deck-design.ts";
import { capturePage } from "./rasterize.ts";
import { unmark } from "./deck-math.ts";

/**
 * The deck's self-review. Every element drawn on a slide is recorded as it goes into PowerPoint; the slides are then
 * laid out again in a hidden Chromium page with the same fonts, so text that would overflow its box is measured, not
 * guessed. Overflowing text is shrunk and the deck redrawn (twice at most); what is left (low contrast, text off the
 * slide, overlapping text, crowded slides, tiny type) is reported, and contact sheets of the slides go back to the model
 * as pictures so it can look at the deck before the person does.
 */
export type Run = { text: string; options?: Record<string, any> };
export type Item =
  | { kind: "text"; x: number; y: number; w: number; h: number; runs: Run[]; o: Record<string, any>; k: number }
  | { kind: "shape"; shape: string; x: number; y: number; w: number; h: number; fill?: string; alpha?: number; line?: string; lineWidth?: number; dash?: boolean }
  | { kind: "image"; x: number; y: number; w: number; h: number; data: string }
  | { kind: "chart"; x: number; y: number; w: number; h: number; type: string; colors: string[] }
  | { kind: "table"; x: number; y: number; w: number; colW: number[]; rowH: number; rows: { text: string; options?: Record<string, any> }[][]; o: Record<string, any> };
export type SlideRecord = { bg: string; items: Item[] };

/** Font-size changes the review asks for, by slide and text box ("3:5" → 0.85). */
export type Adjust = Map<string, number>;

/** Wraps a pptxgenjs slide so everything drawn on it is also recorded. Text sizes in `adjust` are applied as they are drawn. */
export function recorded(slide: any, index: number, adjust: Adjust, records: SlideRecord[]) {
  const record: SlideRecord = { bg: "FFFFFF", items: [] };
  records[index] = record;
  let texts = 0;
  const scaled = (o: Record<string, any>, factor: number) => (o && typeof o.fontSize === "number" ? { ...o, fontSize: Math.max(9, Math.round(o.fontSize * factor * 2) / 2) } : o);
  return {
    get background() { return slide.background; },
    set background(value: any) { slide.background = value; record.bg = String(value?.color || "FFFFFF"); },
    addText(value: any, o: Record<string, any>) {
      const k = texts++, factor = adjust.get(`${index}:${k}`);
      let runs: Run[] = typeof value === "string" ? [{ text: value }] : value;
      if (factor) { o = scaled(o, factor); runs = runs.map((r) => ({ ...r, options: scaled(r.options || {}, factor) })); }
      // Inline equations travel as marked runs (deck-math.ts); the review sees their plain-text form.
      record.items.push({ kind: "text", x: o.x, y: o.y, w: o.w, h: o.h, runs: runs.map((r) => ({ ...r, text: unmark(r.text) })), o, k });
      return slide.addText(typeof value === "string" ? runs[0].text : runs, o);
    },
    addShape(shape: string, o: Record<string, any>) {
      record.items.push({ kind: "shape", shape: String(shape), x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill?.color, alpha: o.fill?.transparency ?? 0, line: o.line?.color, lineWidth: o.line?.width, dash: !!o.line?.dashType && o.line.dashType !== "solid" });
      return slide.addShape(shape, o);
    },
    addImage(o: Record<string, any>) {
      record.items.push({ kind: "image", x: o.x, y: o.y, w: o.w, h: o.h, data: String(o.data || "") });
      return slide.addImage(o);
    },
    addChart(type: any, data: any, o: Record<string, any>) {
      record.items.push({ kind: "chart", x: o.x, y: o.y, w: o.w, h: o.h, type: String(type), colors: o.chartColors || [] });
      return slide.addChart(type, data, o);
    },
    addTable(rows: any, o: Record<string, any>) {
      record.items.push({ kind: "table", x: o.x, y: o.y, w: o.w, colW: o.colW, rowH: o.rowH, rows, o });
      return slide.addTable(rows, o);
    },
    addNotes(text: string) { return slide.addNotes(text); },
  };
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PT = 72; // CSS pixels per inch in the review page: one point is one pixel.

/** A text box's paragraphs: runs up to each breakLine (and each newline) form one paragraph. */
function paragraphs(runs: Run[]) {
  const out: Run[][] = [[]];
  for (const run of runs) {
    const lines = String(run.text ?? "").split("\n");
    lines.forEach((line, i) => { if (i) out.push([]); out[out.length - 1].push({ text: line, options: run.options }); });
    if (run.options?.breakLine) out.push([]);
  }
  return out.filter((p, i) => p.length || i < out.length - 1);
}

function textHtml(item: Extract<Item, { kind: "text" }>, id: string) {
  const o = item.o, size = o.fontSize || 18, line = 1.2 * (o.lineSpacingMultiple || 1);
  const justify = o.valign === "middle" ? "center" : o.valign === "bottom" ? "flex-end" : "flex-start";
  const paras = paragraphs(item.runs).map((runs) => {
    const first = runs[0]?.options || {};
    const indent = first.bullet ? Number(first.bullet.indent || size) : 0;
    const level = first.indentLevel ? indent * first.indentLevel : 0;
    const mark = first.bullet ? `<span style="display:inline-block;width:${indent}px;margin-left:-${indent}px">${first.bullet.code ? "&#x" + first.bullet.code + ";" : "•"}</span>` : "";
    const style = `margin:${first.paraSpaceBefore || 0}px 0 ${first.paraSpaceAfter || 0}px ${indent + level}px;text-align:${first.align || o.align || "left"}`;
    return `<p style="${style}">${mark}${runs.map((r) => { const ro = r.options || {}; return `<span style="${ro.bold ?? o.bold ? "font-weight:700;" : ""}${ro.italic ?? o.italic ? "font-style:italic;" : ""}${ro.color ? `color:#${ro.color};` : ""}${ro.fontSize ? `font-size:${ro.fontSize}px;` : ""}${ro.fontFace ? `font-family:'${ro.fontFace}';` : ""}">${esc(r.text) || "&#8203;"}</span>`; }).join("")}</p>`;
  }).join("");
  return `<div class="t" id="${id}" style="left:${item.x * PT}px;top:${item.y * PT}px;width:${item.w * PT}px;height:${item.h * PT}px;justify-content:${justify};font-family:'${o.fontFace || "Segoe UI"}';font-size:${size}px;line-height:${line};color:#${o.color || "000000"};${o.bold ? "font-weight:700;" : ""}${o.italic ? "font-style:italic;" : ""}${o.charSpacing ? `letter-spacing:${o.charSpacing}px;` : ""}text-align:${o.align || "left"}${o.rotate ? `;transform:rotate(${o.rotate}deg)` : ""}"><div class="c">${paras}</div></div>`;
}

const shapeCss: Record<string, string> = {
  ellipse: "border-radius:50%", roundRect: "border-radius:10px",
  chevron: "clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%,18% 50%)", homePlate: "clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%)",
  triangle: "clip-path:polygon(50% 0,100% 100%,0 100%)", trapezoid: "clip-path:polygon(15% 0,85% 0,100% 100%,0 100%)", diamond: "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)",
  rightArrow: "clip-path:polygon(0 30%,65% 30%,65% 0,100% 50%,65% 100%,65% 70%,0 70%)",
};
function slideHtml(slide: SlideRecord, n: number, W: number, H: number) {
  const parts = slide.items.map((item, i) => {
    const box = `left:${item.x * PT}px;top:${item.y * PT}px;width:${("w" in item ? item.w : 0) * PT}px;`;
    if (item.kind === "text") return textHtml(item, `t${n}-${item.k}`);
    if (item.kind === "image") return `<img style="position:absolute;${box}height:${item.h * PT}px" src="data:${esc(item.data)}">`;
    if (item.kind === "chart") return `<div style="position:absolute;${box}height:${item.h * PT}px;display:flex;align-items:flex-end;gap:6%;padding:6% 8%;box-sizing:border-box;border:1px dashed #9996">${[0.5, 0.8, 0.65, 0.95].map((v, j) => `<i style="flex:1;height:${v * 100}%;background:#${item.colors[j % Math.max(1, item.colors.length)] || "888888"}"></i>`).join("")}</div>`;
    if (item.kind === "table") {
      const total = item.colW.reduce((a, b) => a + b, 0) || 1;
      return `<table id="tb${n}-${i}" style="position:absolute;${box}border-collapse:collapse;table-layout:fixed;font-family:'${item.o.fontFace || "Segoe UI"}';font-size:${item.o.fontSize || 14}px">${item.colW.map((c) => `<col style="width:${(c / total) * 100}%">`).join("")}${item.rows.map((row) => `<tr style="height:${item.rowH * PT}px">${row.map((cell) => { const co = cell.options || {}; return `<td style="padding:0 ${0.08 * PT}px;background:#${co.fill?.color || "FFFFFF"};color:#${co.color || "000000"};${co.bold ? "font-weight:700;" : ""}text-align:${co.align || "left"};${co.fontFace ? `font-family:'${co.fontFace}';` : ""}">${esc(cell.text)}</td>`; }).join("")}</tr>`).join("")}</table>`;
    }
    if (item.kind === "shape") {
      if (item.shape === "line") return `<div style="position:absolute;left:${item.x * PT}px;top:${item.y * PT}px;width:${Math.max(item.w * PT, item.lineWidth || 1)}px;height:${Math.max(item.h * PT, item.lineWidth || 1)}px;background:#${item.line || "000000"}"></div>`;
      const fill = item.fill && (item.alpha ?? 0) < 100 ? `background:#${item.fill};opacity:${1 - (item.alpha || 0) / 100};` : "";
      const border = item.line && (item.lineWidth || 0) > 0 && !fill.includes(item.line) ? `outline:${item.lineWidth}px solid #${item.line};outline-offset:-${item.lineWidth}px;` : "";
      return `<div style="position:absolute;${box}height:${item.h * PT}px;${fill}${border}${shapeCss[item.shape] || ""}"></div>`;
    }
    return "";
  });
  return `<div class="s" style="width:${W * PT}px;height:${H * PT}px;background:#${slide.bg}">${parts.join("")}</div>`;
}
const PAGE_CSS = `html,body{margin:0;background:#1d1d1b}*{box-sizing:border-box}.s{position:relative;overflow:hidden}.t{position:absolute;display:flex;flex-direction:column;overflow:visible}.t p{margin:0}.c{width:100%}.sheet{display:grid;gap:14px;padding:14px}.cell{position:relative}.cell b{position:absolute;left:6px;top:6px;z-index:9;font:700 13px 'Segoe UI';color:#fff;background:#000a;padding:2px 7px;border-radius:9px}`;
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export type Finding = { slide: number; problem: string; key?: string; factor?: number };
type Area = { x: number; y: number; w: number; h: number };
const overlap = (a: Area, b: Area) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const words = (item: Extract<Item, { kind: "text" }>) => item.runs.map((r) => r.text).join(" ");
/** Where a text box really is on the slide: a box turned a quarter turn swaps its width and height about its centre. */
const placed = (t: Extract<Item, { kind: "text" }>) => (Math.abs(Number(t.o.rotate) || 0) % 180 === 90 ? { ...t, x: t.x + t.w / 2 - t.h / 2, y: t.y + t.h / 2 - t.w / 2, w: t.h, h: t.w } : t);

/** Problems that need no rendering: contrast, text off the slide, text over text, crowded slides and tiny type. */
export function staticFindings(slides: SlideRecord[], W: number, H: number): Finding[] {
  const found: Finding[] = [];
  slides.forEach((slide, s) => {
    const texts = slide.items.filter((i): i is Extract<Item, { kind: "text" }> => i.kind === "text" && !!words(i).trim()).map(placed);
    const n = s + 1;
    for (const t of texts) {
      const label = `"${words(t).trim().slice(0, 40)}${words(t).length > 40 ? "…" : ""}"`;
      if (t.x < -0.02 || t.y < -0.02 || t.x + t.w > W + 0.02 || t.y + t.h > H + 0.02) found.push({ slide: n, problem: `text ${label} runs off the slide` });
      // What the text sits on: the last opaque filled shape under its centre, else the slide.
      const at = slide.items.findIndex((i) => i.kind === "text" && i.k === t.k), cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      let ground = slide.bg, onImage = false;
      for (const item of slide.items.slice(0, at)) {
        if (item.kind === "shape" && item.fill && (item.alpha ?? 0) <= 30 && item.shape !== "line" && cx >= item.x && cx <= item.x + item.w && cy >= item.y && cy <= item.y + item.h) { ground = item.fill; onImage = false; }
        if (item.kind === "image" && cx >= item.x && cx <= item.x + item.w && cy >= item.y && cy <= item.y + item.h) onImage = true;
      }
      if (!onImage) {
        const colors = [...new Set(t.runs.map((r) => r.options?.color || t.o.color).filter(Boolean))] as string[];
        const size = Math.min(...t.runs.map((r) => r.options?.fontSize || t.o.fontSize || 18));
        const need = size >= 18 || (t.o.bold && size >= 14) ? 3 : 4.5;
        const worst = colors.map((c) => contrast(c, ground)).sort((a, b) => a - b)[0];
        if (worst !== undefined && worst < need) found.push({ slide: n, problem: `text ${label} has low contrast (${worst.toFixed(1)}:1) on its background` });
      }
      const size = t.o.fontSize || 18;
      if (size < 11 && t.h > 0.32) found.push({ slide: n, problem: `text ${label} is ${size} pt, too small to read when presented` });
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j], shared = overlap(a, b);
      if (shared > 0.25 * Math.min(a.w * a.h, b.w * b.h)) found.push({ slide: n, problem: `"${words(a).trim().slice(0, 30)}" and "${words(b).trim().slice(0, 30)}" overlap` });
    }
    const count = texts.reduce((c, t) => c + words(t).split(/\s+/).filter(Boolean).length, 0);
    if (count > 90) found.push({ slide: n, problem: `${count} words on one slide: split it or move detail into the notes` });
  });
  return found;
}

/** The hidden page the slides are measured and photographed in (scripts allowed only for measuring Mowr's own markup). */
export async function slideReviewer() {
  const page = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: true } });
  page.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  page.webContents.on("will-navigate", (event) => event.preventDefault());
  const file = join(tmpdir(), "mowr-deck-review-" + randomUUID() + ".html");
  const load = async (body: string, width: number, height: number) => {
    page.setContentSize(Math.ceil(width), Math.ceil(height));
    await writeFile(file, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${PAGE_CSS}</style></head><body>${body}</body></html>`, "utf8");
    await page.loadFile(file);
    await page.webContents.executeJavaScript("document.fonts.ready.then(()=>true)");
  };
  return {
    /** Text boxes whose text needs more room than the box has, measured with the real fonts, and tables that run off the slide. */
    async overflow(slides: SlideRecord[], W: number, H: number): Promise<Finding[]> {
      await load(slides.map((s, i) => slideHtml(s, i, W, H)).join(""), W * PT, H * PT);
      const measured: { id: string; need: number; have: number; wide: boolean }[] = await page.webContents.executeJavaScript(`[...document.querySelectorAll(".t,table")].map(e=>{if(e.tagName==="TABLE"){const s=e.closest(".s").getBoundingClientRect(),r=e.getBoundingClientRect();return {id:e.id,need:r.bottom-s.top,have:${H * PT - 0.15 * PT},wide:false}}const c=e.firstElementChild;return {id:e.id,need:c.scrollHeight,have:e.clientHeight,wide:c.scrollWidth>e.clientWidth+2}})`);
      const found: Finding[] = [];
      for (const m of measured) {
        if (m.id.startsWith("tb")) { if (m.need > m.have + 1) found.push({ slide: Number(m.id.slice(2).split("-")[0]) + 1, problem: "the table runs off the bottom of the slide: split it across two slides or shorten its cells" }); continue; }
        const [s, k] = m.id.slice(1).split("-").map(Number);
        if (m.need > m.have + 1.5 || m.wide) {
          const item = slides[s].items.find((i) => i.kind === "text" && i.k === k) as Extract<Item, { kind: "text" }>;
          found.push({ slide: s + 1, key: `${s}:${k}`, factor: m.wide ? 0.85 : Math.max(0.55, (m.have / m.need) * 0.97), problem: `text "${words(item).trim().slice(0, 40)}" does not fit its box${m.wide ? " (a word is wider than the box)" : ""}` });
        }
      }
      return found;
    },
    /** Contact sheets of the slides (numbered), at most `limit` pictures. */
    async sheets(slides: SlideRecord[], W: number, H: number, limit = 4) {
      const perRow = slides.length > 18 ? 3 : 2, scale = perRow === 3 ? 0.5 : 0.75, per = perRow * (perRow === 3 ? 4 : 3);
      const cellW = W * PT * scale, cellH = H * PT * scale, out: { name: string; first: number; last: number; jpeg: Uint8Array }[] = [];
      for (let start = 0; start < slides.length && out.length < limit; start += per) {
        const group = slides.slice(start, start + per), rows = Math.ceil(group.length / perRow);
        const body = `<div class="sheet" style="grid-template-columns:repeat(${perRow},${cellW}px)">${group.map((s, i) => `<div class="cell" style="width:${cellW}px;height:${cellH}px"><b>${start + i + 1}</b><div style="transform:scale(${scale});transform-origin:0 0">${slideHtml(s, start + i, W, H)}</div></div>`).join("")}</div>`;
        const width = perRow * cellW + (perRow + 1) * 14, height = rows * cellH + (rows + 1) * 14;
        await load(body, width, height);
        await new Promise((done) => setTimeout(done, 80));
        const image = await capturePage(page.webContents, { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) });
        out.push({ name: `slides ${start + 1}–${start + group.length}`, first: start + 1, last: start + group.length, jpeg: new Uint8Array(image.toJPEG(82)) });
      }
      return out;
    },
    close() {
      page.destroy();
      void rm(file, { force: true }).catch(() => {});
    },
  };
}
