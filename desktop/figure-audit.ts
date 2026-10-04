/**
 * Measures the text in a rendered figure without a browser: every <text> line becomes a box (from its position,
 * size, anchor and baseline, inside translated groups), and boxes that overlap each other or leave the frame are
 * reported. Rotated or matrix-transformed text is skipped rather than guessed.
 */
type Box = { x: number; y: number; w: number; h: number; text: string };

/** Average glyph widths of the UI face at 1px, slightly generous. */
const width = (text: string, size: number) =>
  [...text].reduce((w, c) => w + (/[ilj.,:;'|!()[\]]/.test(c) ? 0.3 : /[frtI ]/.test(c) ? 0.36 : /[mwMWΩ@]/.test(c) ? 0.86 : /[A-Z0-9]/.test(c) ? 0.62 : 0.53), 0) * size;
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function textBoxes(svg: string): Box[] {
  const boxes: Box[] = [];
  const stack: ({ dx: number; dy: number } | null)[] = [];
  const offset = () => stack.reduce<{ dx: number; dy: number } | null>((o, t) => (o && t ? { dx: o.dx + t.dx, dy: o.dy + t.dy } : null), { dx: 0, dy: 0 });
  const shift = (transform?: string) => {
    if (!transform) return { dx: 0, dy: 0 };
    const m = transform.trim().match(/^translate\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)$/);
    return m ? { dx: Number(m[1]), dy: Number(m[2] ?? 0) } : null;
  };
  const re = /<g\b[^>]*?\/>|<g\b[^>]*>|<\/g>|<text\b[^>]*>[\s\S]*?<\/text>/g;
  for (const [token] of svg.matchAll(re)) {
    if (token.startsWith("</g")) { stack.pop(); continue; }
    if (token.startsWith("<g")) { if (!token.endsWith("/>")) stack.push(shift(attr(token, "transform"))); continue; }
    const open = token.match(/^<text\b[^>]*>/)![0];
    const base = offset(), own = shift(attr(open, "transform"));
    if (!base || !own || /\bclass="glyph"/.test(open)) continue;
    const size = Number(attr(open, "font-size") ?? 12), anchor = attr(open, "text-anchor") ?? "start";
    const middle = /middle|central/.test(attr(open, "dominant-baseline") ?? "");
    let x = Number(attr(open, "x") ?? 0), y = Number(attr(open, "y") ?? 0);
    const inner = token.slice(open.length, -"</text>".length);
    // Lines: tspans that set x or dy start a new line; otherwise the whole element is one line.
    const lines: { x: number; y: number; text: string }[] = [];
    const spans = [...inner.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
    if (spans.length && spans.some((s) => /\s(x|dy)="/.test(" " + s[1]) && attr(" " + s[1], "x") !== undefined)) {
      for (const s of spans) {
        const a = " " + s[1], sx = attr(a, "x"), dy = Number(attr(a, "dy") ?? 0);
        if (sx !== undefined) { x = Number(sx); y += dy; lines.push({ x, y, text: plain(s[2]) }); }
        else if (lines.length) lines[lines.length - 1].text += plain(s[2]);
      }
    } else lines.push({ x, y, text: plain(inner) });
    for (const l of lines) {
      const text = l.text.trim();
      if (!text || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
      const w = width(text, size), h = size * 1.1;
      const left = anchor === "middle" ? l.x - w / 2 : anchor === "end" ? l.x - w : l.x;
      const top = middle ? l.y - h / 2 : l.y - size * 0.8;
      boxes.push({ x: left + base.dx + own.dx, y: top + base.dy + own.dy, w, h, text });
    }
  }
  return boxes;
}

/** Text lines that overlap another line, or stick out of the figure's frame. */
export function textProblems(svg: string): string[] {
  const boxes = textBoxes(svg), problems: string[] = [];
  const vb = svg.match(/viewBox="([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)"/)?.slice(1).map(Number);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // A sliver of a pixel is measurement noise; a real collision covers part of a glyph.
      if (w > 1.5 && h > 2) problems.push(`"${a.text.slice(0, 40)}" overlaps "${b.text.slice(0, 40)}"`);
    }
    if (vb && (a.x < vb[0] - 2 || a.y < vb[1] - 2 || a.x + a.w > vb[0] + vb[2] + 2 || a.y + a.h > vb[1] + vb[3] + 2)) problems.push(`"${a.text.slice(0, 40)}" runs outside the figure`);
  }
  return problems;
}
