/**
 * Label backdrop clean-up, applied to the SVG that renderScene2D returns.
 *
 * Scene2D paints an opaque white rect behind every label, sized from the
 * character count (0.62 em per character). On white paper that is invisible,
 * but inside a filled shape it shows as a white box, usually wider than the
 * text and off-centre. Scene2D is frozen, so the toolkit fixes its own output:
 *
 * - the backdrop is narrowed to the measured glyphs (never beyond the label's
 *   collision footprint, which is the union of glyph box and backdrop);
 * - a backdrop that lies wholly inside one filled shape takes that shape's
 *   fill, so it still hides lines behind the text without showing as a box;
 * - the halo compose() draws for a label over grid lines gets the same
 *   treatment.
 *
 * A backdrop on white, or one that straddles a shape's edge, keeps
 * fill="#ffffff", so it stays recognisable to SVG oracles.
 */
import type { Vec2 } from "../diagram/primitives.js";
import type { Box } from "./geometry.js";
import { pointInPolygon } from "./geometry.js";
import { measureLabelWidth } from "./text_metrics.js";

const BACKDROP = /^<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" fill="#ffffff" stroke="none"\/>$/;
const TEXT_OPEN = /^<text ([^>]*)>$/;
const PAD = 1;

interface Filled { fill: string; contains: (p: Vec2) => boolean }

const attrsOf = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
const isWhite = (c: string) => /^#(fff|ffffff)$/i.test(c);

/** A filled rect, ellipse or straight-edged closed path as a point test; undefined for anything else. */
function filledShape(line: string): Filled | undefined {
  const m = /^<(rect|ellipse|path) ([^>]*)\/>$/.exec(line);
  if (!m) return undefined;
  const a = attrsOf(m[2]!);
  const fill = a.fill;
  if (!fill || fill === "none" || a.transform !== undefined) return undefined;
  if (m[1] === "rect") {
    const x = Number(a.x), y = Number(a.y), w = Number(a.width), h = Number(a.height);
    return { fill, contains: p => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h };
  }
  if (m[1] === "ellipse") {
    const cx = Number(a.cx), cy = Number(a.cy), rx = Number(a.rx), ry = Number(a.ry);
    if (!(rx > 0) || !(ry > 0)) return undefined;
    return { fill, contains: p => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1 };
  }
  const d = a.d ?? "";
  if (!/^M [-\d.e]+ [-\d.e]+(?: L [-\d.e]+ [-\d.e]+)+ Z$/.test(d)) return undefined;
  const nums = d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
  const poly: Vec2[] = [];
  for (let k = 0; k + 1 < nums.length; k += 2) poly.push({ x: nums[k]!, y: nums[k + 1]! });
  return { fill, contains: p => pointInPolygon(p, poly) };
}

/** The fill a box sits wholly inside, or undefined when it is on white or straddles an edge. */
function fillUnder(box: Box, stack: Filled[]): string | undefined {
  const pts = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }];
  for (let k = stack.length - 1; k >= 0; k--) {
    const n = pts.filter(p => stack[k]!.contains(p)).length;
    if (n === 0) continue;
    return n === pts.length && !isWhite(stack[k]!.fill) ? stack[k]!.fill : undefined;
  }
  return undefined;
}

const sameBox = (a: Box, b: Box) => Math.abs(a.x0 - b.x0) < 1e-6 && Math.abs(a.y0 - b.y0) < 1e-6 && Math.abs(a.x1 - b.x1) < 1e-6 && Math.abs(a.y1 - b.y1) < 1e-6;

/**
 * Tidy every label backdrop in `svg`. `halos` are the view-space boxes of the
 * halo rects compose() added (each is drawn immediately before its label).
 * Must run before renderScriptTspans, while each <text> still holds one code
 * point per glyph.
 */
export function tidyLabelBackdrops(svg: string, halos: Box[] = []): string {
  const lines = svg.split("\n");
  const stack: Filled[] = [];
  for (let k = 0; k < lines.length; k++) {
    const m = BACKDROP.exec(lines[k]!);
    const open = m ? TEXT_OPEN.exec(lines[k + 1] ?? "") : null;
    if (!m || !open) {
      const next = lines[k + 1] ?? "";
      // A halo is handled with the backdrop that follows it, not as a shape under the label.
      const halo = BACKDROP.test(next) && haloBox(lines[k]!, halos);
      if (!halo) { const f = filledShape(lines[k]!); if (f) stack.push(f); }
      continue;
    }
    const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const a = attrsOf(open[1]!);
    const size = Number(a["font-size"] ?? 12), tx = Number(a.x);
    const glyphW = measureLabelWidth(unescapeXml((lines[k + 2] ?? "").trim()), size);
    const g0 = a["text-anchor"] === "middle" ? tx - glyphW / 2 : a["text-anchor"] === "end" ? tx - glyphW : tx;
    // Glyphs plus 1 px, clipped to the footprint (union of glyph box and Scene2D's backdrop).
    const x0 = Math.max(g0 - PAD, Math.min(x, g0)), x1 = Math.min(g0 + glyphW + PAD, Math.max(x + w, g0 + glyphW));
    const near = k > 0 ? haloBox(lines[k - 1]!, halos) : undefined;
    const halo = near && near.x0 <= x + 1e-6 && near.x1 >= x + w - 1e-6 && near.y0 <= y + 1e-6 && near.y1 >= y + h - 1e-6 ? near : undefined;
    const box: Box = { x0, y0: halo ? Math.min(y, halo.y0) : y, x1, y1: halo ? Math.max(y + h, halo.y1) : y + h };
    const under = fillUnder(box, stack);
    lines[k] = `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${h}" fill="${under ?? "#ffffff"}" stroke="none"/>`;
    if (halo) lines[k - 1] = `<rect x="${x0}" y="${halo.y0}" width="${x1 - x0}" height="${halo.y1 - halo.y0}" fill="${under ?? "#fff"}" stroke="none" stroke-width="1" rx="0"/>`;
  }
  return lines.join("\n");
}

function haloBox(line: string, halos: Box[]): Box | undefined {
  if (!halos.length) return undefined;
  const m = /^<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" fill="#fff" stroke="none" stroke-width="1" rx="0"\/>$/.exec(line);
  if (!m) return undefined;
  const b: Box = { x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[1]) + Number(m[3]), y1: Number(m[2]) + Number(m[4]) };
  return halos.some(hb => sameBox(hb, b)) ? b : undefined;
}
