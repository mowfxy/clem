import type { CSSProperties, ReactNode } from "react";
import { all, attr, find, kid, kids, num, path, type Pkg } from "./package";
import { color, defaultMap, EMU, fillColor, fontFamily, gradientCss, parseTheme, type Theme } from "./drawingml";
import { ChartSvg, parseChart, type ChartModel } from "./chart";
import { Scaled } from "./scaled";

/**
 * A PowerPoint file drawn as slides: shapes at their positions with their fills and lines, text with its bullets, sizes and
 * colours (inherited from the slide's layout and master the way PowerPoint resolves them), pictures, tables and native charts.
 * One slide is a 96-dpi page (13.33 in = 1280 px) that the viewer scales to fit.
 */
type Ctx = { pkg: Pkg; theme: Theme; map: Record<string, string>; part: string; order: Map<Element, number>; changed: Set<string>; defaults: Element | undefined; txStyles: Element | undefined; layout?: Element; master?: Element; slideNo: number; charts: Map<string, ChartModel | undefined> };
type Tx = { ax: number; ex: number; ay: number; ey: number };
type Chain = (Element | undefined)[];
export type PptxModel = { width: number; height: number; slides: { part: string; render: (changed: Set<string>) => ReactNode }[]; dispose: () => void };

const px = (emu: number) => emu / EMU;
const pt = (hundredths: number) => (hundredths / 100) * (4 / 3);
const LEVELS = ["lvl1pPr", "lvl2pPr", "lvl3pPr", "lvl4pPr", "lvl5pPr", "lvl6pPr", "lvl7pPr", "lvl8pPr", "lvl9pPr"];

/** The shape's own placeholder identity (type and index), for finding its layout and master counterparts. */
const placeholder = (sp: Element) => { const ph = find(kid(sp, "nvSpPr") || sp, "ph"); return ph ? { type: attr(ph, "type") || "body", idx: attr(ph, "idx") } : undefined; };
const titleKinds = new Set(["title", "ctrTitle"]);
function counterpart(tree: Element | undefined, ph: { type: string; idx?: string }) {
  const shapes = kids(tree, "sp").filter((s) => placeholder(s));
  return shapes.find((s) => ph.idx && placeholder(s)!.idx === ph.idx && !titleKinds.has(ph.type)) || shapes.find((s) => placeholder(s)!.type === ph.type) || shapes.find((s) => titleKinds.has(ph.type) && titleKinds.has(placeholder(s)!.type)) || (!titleKinds.has(ph.type) && ph.type !== "dt" && ph.type !== "ftr" && ph.type !== "sldNum" ? shapes.find((s) => placeholder(s)!.type === "body") : undefined);
}
const spTree = (part: Element | undefined) => find(part, "spTree");

/** Position of an element's xfrm in slide pixels, through the groups it sits in. */
function box(xfrm: Element | undefined, tx: Tx) {
  const off = kid(xfrm, "off"), ext = kid(xfrm, "ext");
  if (!xfrm || !ext) return undefined;
  return { x: tx.ax * px(num(attr(off, "x"))) + tx.ex, y: tx.ay * px(num(attr(off, "y"))) + tx.ey, w: tx.ax * px(num(attr(ext, "cx"))), h: tx.ay * px(num(attr(ext, "cy"))), rot: num(attr(xfrm, "rot")) / 60000, flipH: attr(xfrm, "flipH") === "1", flipV: attr(xfrm, "flipV") === "1" };
}

/** The first value of an attribute on `lvlNpPr`/`pPr` elements, most specific first. */
const pick = (chain: Chain, name: string) => { for (const el of chain) { const v = attr(el, name); if (v !== undefined) return v; } return undefined; };
const pickKid = (chain: Chain, name: string) => { for (const el of chain) { const k = kid(el, name); if (k) return k; } return undefined; };
/** `lvlNpPr` containers (list styles) from shape, layout and master, then the master's text styles and the presentation default. */
function levelChain(ctx: Ctx, level: number, own: Element | undefined, sp: Element | undefined, ph: ReturnType<typeof placeholder>): Chain {
  const name = LEVELS[Math.min(8, level)];
  const lists: (Element | undefined)[] = [kid(sp ? kid(sp, "txBody") : undefined, "lstStyle")];
  if (ph && sp) {
    const lay = counterpart(spTree(ctx.layout), ph), mas = counterpart(spTree(ctx.master), ph);
    lists.push(kid(kid(lay, "txBody"), "lstStyle"), kid(kid(mas, "txBody"), "lstStyle"));
  }
  const style = ph ? (titleKinds.has(ph.type) ? "titleStyle" : ph.type === "dt" || ph.type === "ftr" || ph.type === "sldNum" ? "otherStyle" : "bodyStyle") : "otherStyle";
  lists.push(kid(ctx.txStyles, style), ctx.defaults);
  return [own, ...lists.map((l) => kid(l, name))];
}

function runStyle(ctx: Ctx, rPr: Element | undefined, chain: Chain, scale: number, forced?: { color?: string; bold?: boolean }): CSSProperties {
  const defs = chain.map((c) => kid(c, "defRPr"));
  const get = (name: string) => attr(rPr, name) ?? pick(defs, name);
  const size = num(get("sz"), 1800) * scale;
  // A shape's style (or a table style) supplies the text colour between the shape's own list style and the inherited ones.
  const fill = (rPr && kid(rPr, "solidFill")) ? color(kid(rPr, "solidFill")!.firstElementChild, ctx.theme, ctx.map) : (() => { for (const [i, d] of defs.entries()) { if (i === 2 && forced?.color) return forced.color; const f = kid(d, "solidFill"); if (f) return color(f.firstElementChild, ctx.theme, ctx.map); } return forced?.color; })();
  const face = attr(kid(rPr, "latin"), "typeface") || attr(pickKid(defs, "latin"), "typeface");
  const base = num(get("baseline"));
  const u = get("u"), strike = get("strike");
  return {
    fontSize: pt(size), color: fill, fontWeight: get("b") === "1" || (get("b") === undefined && forced?.bold) ? 700 : undefined, fontStyle: get("i") === "1" ? "italic" : undefined,
    textDecoration: [u && u !== "none" && "underline", strike && strike !== "noStrike" && "line-through"].filter(Boolean).join(" ") || undefined,
    fontFamily: fontFamily(face, ctx.theme) || fontFamily("+mn-lt", ctx.theme), textTransform: get("cap") === "all" ? "uppercase" : undefined, letterSpacing: get("spc") ? num(get("spc")) / 100 * 4 / 3 : undefined,
    verticalAlign: base ? (base > 0 ? "super" : "sub") : undefined, ...(base ? { fontSize: pt(size) * 0.7 } : {}),
  };
}
const numberOf = (type: string, n: number) => {
  const alpha = (k: number) => { let s = ""; for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s; return s; };
  const roman = (k: number) => [["m", 1000], ["cm", 900], ["d", 500], ["cd", 400], ["c", 100], ["xc", 90], ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1]].reduce((s, [r, v]) => { while (k >= (v as number)) { s += r; k -= v as number; } return s; }, "");
  if (type.startsWith("alphaLc")) return alpha(n) + (type.endsWith("ParenR") ? ")" : ".");
  if (type.startsWith("alphaUc")) return alpha(n).toUpperCase() + (type.endsWith("ParenR") ? ")" : ".");
  if (type.startsWith("romanLc")) return roman(n) + ".";
  if (type.startsWith("romanUc")) return roman(n).toUpperCase() + ".";
  return n + (type.endsWith("ParenR") ? ")" : type.endsWith("ParenBoth") ? ")" : ".");
};

/** The paragraphs of a text body, with inherited sizes, bullets, spacing and alignment. */
function Paragraphs({ ctx, body, sp, scale = 1, lineReduction = 0, fallbackColor, bold }: { ctx: Ctx; body: Element; sp?: Element; scale?: number; lineReduction?: number; fallbackColor?: string; bold?: boolean }): ReactNode {
  const forced = { color: fallbackColor, bold };
  const ph = sp ? placeholder(sp) : undefined;
  let counter = 0, lastLevel = -1;
  return kids(body, "p").map((p, i) => {
    const pPr = kid(p, "pPr"), level = num(attr(pPr, "lvl")), chain = levelChain(ctx, level, pPr, sp, ph);
    const endSize = attr(kid(p, "endParaRPr"), "sz");
    const runs = kids(p).filter((k) => ["r", "br", "fld"].includes(k.localName));
    const defaultStyle = runStyle(ctx, undefined, chain, scale, forced);
    const marL = px(num(pick(chain, "marL"))), indent = px(num(pick(chain, "indent")));
    const buNone = !!pickKid(chain, "buNone") && !pickKid(chain.slice(0, 1), "buChar") && !pickKid(chain.slice(0, 1), "buAutoNum");
    const first = chain.find((c) => kid(c, "buNone") || kid(c, "buChar") || kid(c, "buAutoNum"));
    const buChar = !buNone && first ? kid(first, "buChar") : undefined, buNum = !buNone && first ? kid(first, "buAutoNum") : undefined;
    if (buNum) counter = level === lastLevel || lastLevel < 0 ? counter + 1 : 1; else counter = 0;
    lastLevel = buNum ? level : -1;
    const sizePx = (defaultStyle.fontSize as number) || 24;
    const spacing = (name: string, key: "spcBef" | "spcAft" | "lnSpc") => { const s = pickKid(chain, key); const v = kid(s, name); return v ? num(attr(v, "val")) : undefined; };
    const pct = spacing("spcPct", "lnSpc"), pts = spacing("spcPts", "lnSpc");
    const before = spacing("spcPts", "spcBef") !== undefined ? pt(spacing("spcPts", "spcBef")!) : spacing("spcPct", "spcBef") !== undefined ? spacing("spcPct", "spcBef")! / 100000 * sizePx * 1.2 : 0;
    const after = spacing("spcPts", "spcAft") !== undefined ? pt(spacing("spcPts", "spcAft")!) : spacing("spcPct", "spcAft") !== undefined ? spacing("spcPct", "spcAft")! / 100000 * sizePx * 1.2 : 0;
    const algn = pick(chain, "algn");
    const changed = ctx.changed.has(ctx.part + ":" + ctx.order.get(p));
    const bulletColor = first && kid(first, "buClr") ? color(kid(first, "buClr")!.firstElementChild, ctx.theme, ctx.map) : undefined;
    const marker = buChar ? attr(buChar, "char") : buNum ? numberOf(attr(buNum, "type") || "arabicPeriod", counter + ((num(attr(buNum, "startAt"), 1)) - 1)) : undefined;
    const hanging = marker ? Math.max(-indent, sizePx * 0.9) : 0;
    const hasText = runs.some((r) => r.localName === "br" || (find(r, "t")?.textContent || "") !== "");
    return <div key={i} className={changed ? "fp-changed" : undefined} style={{
      textAlign: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left", paddingLeft: marL + (marker ? hanging : Math.max(0, indent)), textIndent: marker ? -hanging : Math.min(0, indent),
      lineHeight: pts ? px(0) + pt(pts) + "px" : (pct ?? 100000) / 100000 * 1.2 * (1 - lineReduction / 100000), paddingTop: before, paddingBottom: after, minHeight: hasText ? undefined : (endSize ? pt(num(endSize) * scale) : sizePx) * 1.2, color: defaultStyle.color,
    }}>
      {marker && hasText && <span style={{ display: "inline-block", width: hanging, textIndent: 0, color: bulletColor, fontSize: sizePx * (num(attr(kid(first, "buSzPct"), "val"), 100000) / 100000), whiteSpace: "pre" }}>{marker}</span>}
      {runs.map((r, k) => {
        if (r.localName === "br") return <br key={k} />;
        const rPr = kid(r, "rPr"), style = runStyle(ctx, rPr, chain, scale, forced);
        return <span key={k} style={style}>{find(r, "t")?.textContent}</span>;
      })}
    </div>;
  });
}

/** An SVG path for a preset shape in a w×h box (null for a plain rectangle). */
function geometry(prst: string, w: number, h: number, adj: number[]): { d?: string; kind?: "ellipse" | "line" } {
  const a = (i: number, d: number) => (adj[i] ?? d) / 100000, s = Math.min(w, h);
  switch (prst) {
    case "line": case "straightConnector1": return { kind: "line" };
    case "ellipse": return { kind: "ellipse" };
    case "roundRect": { const r = Math.min(s * a(0, 16667), s / 2); return { d: `M${r},0H${w - r}Q${w},0 ${w},${r}V${h - r}Q${w},${h} ${w - r},${h}H${r}Q0,${h} 0,${h - r}V${r}Q0,0 ${r},0Z` }; }
    case "triangle": return { d: `M${w * a(0, 50000)},0L${w},${h}L0,${h}Z` };
    case "rtTriangle": return { d: `M0,0L${w},${h}L0,${h}Z` };
    case "diamond": return { d: `M${w / 2},0L${w},${h / 2}L${w / 2},${h}L0,${h / 2}Z` };
    case "parallelogram": { const o = Math.min(w * a(0, 25000) * (h / Math.max(1, w)) * 1, w); return { d: `M${o},0H${w}L${w - o},${h}H0Z` }; }
    case "homePlate": { const o = Math.min(s * a(0, 50000), w); return { d: `M0,0H${w - o}L${w},${h / 2}L${w - o},${h}H0Z` }; }
    case "chevron": { const o = Math.min(s * a(0, 50000), w); return { d: `M0,0H${w - o}L${w},${h / 2}L${w - o},${h}H0L${o},${h / 2}Z` }; }
    case "rightArrow": { const head = Math.min(s * a(1, 50000), w), body = h * a(0, 50000); return { d: `M0,${(h - body) / 2}H${w - head}V0L${w},${h / 2}L${w - head},${h}V${(h + body) / 2}H0Z` }; }
    case "leftArrow": { const head = Math.min(s * a(1, 50000), w), body = h * a(0, 50000); return { d: `M${w},${(h - body) / 2}H${head}V0L0,${h / 2}L${head},${h}V${(h + body) / 2}H${w}Z` }; }
    case "hexagon": { const o = Math.min(w / 2, s * a(0, 25000)); return { d: `M${o},0H${w - o}L${w},${h / 2}L${w - o},${h}H${o}L0,${h / 2}Z` }; }
    case "pentagon": return { d: `M${w / 2},0L${w},${h * 0.38}L${w * 0.81},${h}H${w * 0.19}L0,${h * 0.38}Z` };
    case "star5": return { d: [0, 1, 2, 3, 4].flatMap((i) => [[w / 2 + (w / 2) * Math.sin((i * 2 * Math.PI) / 5), h / 2 - (h / 2) * Math.cos((i * 2 * Math.PI) / 5)], [w / 2 + (w / 4.2) * Math.sin(((i * 2 + 1) * Math.PI) / 5), h / 2 - (h / 4.2) * Math.cos(((i * 2 + 1) * Math.PI) / 5)]]).map((p, i) => (i ? "L" : "M") + p.join(",")).join("") + "Z" };
    default: return {};
  }
}
/** A custom shape's path list (moveTo, lnTo, cubicBezTo, quadBezTo, close) scaled to the box. */
function customPath(geom: Element, w: number, h: number) {
  const out: string[] = [];
  for (const p of all(geom, "path")) {
    const pw = num(attr(p, "w"), w) || w, ph = num(attr(p, "h"), h) || h, sx = w / pw, sy = h / ph;
    const pt2 = (el: Element) => `${num(attr(el, "x")) * sx},${num(attr(el, "y")) * sy}`;
    for (const c of kids(p)) {
      const pts = kids(c, "pt");
      if (c.localName === "moveTo") out.push("M" + pt2(pts[0]));
      else if (c.localName === "lnTo") out.push("L" + pt2(pts[0]));
      else if (c.localName === "cubicBezTo") out.push("C" + pts.map(pt2).join(" "));
      else if (c.localName === "quadBezTo") out.push("Q" + pts.map(pt2).join(" "));
      else if (c.localName === "close") out.push("Z");
    }
  }
  return out.join("");
}
const DASH: Record<string, string> = { dash: "6 4", sysDash: "3 2", dot: "1.5 3", sysDot: "1.5 1.5", lgDash: "9 4", dashDot: "6 3 1.5 3" };

function ShapeBox({ ctx, sp, b, key_ }: { ctx: Ctx; sp: Element; b: NonNullable<ReturnType<typeof box>>; key_: string }) {
  const spPr = kid(sp, "spPr"), style = kid(sp, "style");
  const prst = attr(kid(spPr, "prstGeom"), "prst") || "rect";
  const adj = all(kid(spPr, "prstGeom"), "gd").map((g) => num((attr(g, "fmla") || "").replace(/^val\s+/, "")));
  let fill = fillColor(spPr, ctx.theme, ctx.map);
  const gradient = gradientCss(spPr, ctx.theme, ctx.map);
  if (fill === undefined && style) fill = color(kid(style, "fillRef")?.firstElementChild, ctx.theme, ctx.map) ?? undefined;
  const ln = kid(spPr, "ln");
  let stroke = ln ? fillColor(ln, ctx.theme, ctx.map) : undefined, lineW = ln ? Math.max(num(attr(ln, "w"), 9525) / EMU, 0.5) : 0;
  if (stroke === undefined && !ln && style && num(attr(kid(style, "lnRef"), "idx")) > 0) { stroke = color(kid(style, "lnRef")?.firstElementChild, ctx.theme, ctx.map); lineW = 1; }
  if (ln && stroke === undefined) stroke = color(kid(style, "lnRef")?.firstElementChild, ctx.theme, ctx.map);
  const dash = DASH[attr(kid(ln, "prstDash"), "val") || ""];
  const custom = kid(spPr, "custGeom"), shape = custom ? { d: customPath(custom, b.w, b.h) } : geometry(prst, b.w, b.h, adj);
  const painted = (fill && fill !== null) || gradient || (stroke && lineW);
  const common = { fill: gradient ? "url(#g)" : fill || "none", stroke: stroke || "none", strokeWidth: stroke ? lineW : 0, strokeDasharray: dash } as const;
  const svg = painted ? <svg width={Math.max(b.w, 1)} height={Math.max(b.h, 1)} viewBox={`0 0 ${Math.max(b.w, 1)} ${Math.max(b.h, 1)}`} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
    {gradient && <defs><linearGradient id="g" gradientTransform={`rotate(${num(attr(kid(kid(spPr, "gradFill"), "lin"), "ang")) / 60000})`}>{all(kid(spPr, "gradFill"), "gs").map((g, i) => <stop key={i} offset={`${num(attr(g, "pos")) / 1000}%`} stopColor={color(g.firstElementChild, ctx.theme, ctx.map)} />)}</linearGradient></defs>}
    {shape.kind === "line" ? <line x1={0} y1={0} x2={b.w} y2={b.h} stroke={stroke || "#000"} strokeWidth={lineW || 1} strokeDasharray={dash} />
      : shape.kind === "ellipse" ? <ellipse cx={b.w / 2} cy={b.h / 2} rx={b.w / 2} ry={b.h / 2} {...common} />
      : shape.d ? <path d={shape.d} {...common} /> : <rect width={b.w} height={b.h} {...common} />}
  </svg> : null;
  const body = kid(sp, "txBody");
  const ph = placeholder(sp);
  const bodyPr = [kid(body, "bodyPr"), ...(ph ? [kid(kid(counterpart(spTree(ctx.layout), ph), "txBody"), "bodyPr"), kid(kid(counterpart(spTree(ctx.master), ph), "txBody"), "bodyPr")] : [])];
  const bp = (n: string) => pick(bodyPr, n);
  const auto = kid(bodyPr[0], "normAutofit") || pickKid(bodyPr, "normAutofit");
  const anchor = bp("anchor"), vert = bp("vert"), wrap = bp("wrap") !== "none";
  const fontRefColor = ph ? undefined : color(kid(style, "fontRef")?.firstElementChild, ctx.theme, ctx.map);
  const hasText = body && kids(body, "p").some((p) => find(p, "t") || find(p, "br"));
  return <div key={key_} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, transform: [b.rot ? `rotate(${b.rot}deg)` : "", b.flipH ? "scaleX(-1)" : "", b.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined }}>
    {svg}
    {hasText && <div style={{ position: "absolute", inset: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start", paddingLeft: px(num(bp("lIns"), 91440)), paddingRight: px(num(bp("rIns"), 91440)), paddingTop: px(num(bp("tIns"), 45720)), paddingBottom: px(num(bp("bIns"), 45720)), whiteSpace: wrap ? "normal" : "pre", overflow: "visible", writingMode: vert === "vert" || vert === "eaVert" ? "vertical-rl" : vert === "vert270" ? "vertical-rl" : undefined, ...(vert === "vert270" ? { transform: "rotate(180deg)" } : {}) }}>
      <Paragraphs ctx={ctx} body={body!} sp={sp} scale={auto ? num(attr(auto, "fontScale"), 100000) / 100000 : 1} lineReduction={auto ? num(attr(auto, "lnSpcReduction")) : 0} fallbackColor={fontRefColor} />
    </div>}
  </div>;
}

function Picture({ ctx, pic, b, key_ }: { ctx: Ctx; pic: Element; b: NonNullable<ReturnType<typeof box>>; key_: string }) {
  const blip = find(pic, "blip"), rel = ctx.pkg.rels(ctx.part).get(attr(blip, "embed") || "") || ctx.pkg.rels(ctx.part).get(attr(blip, "link") || "");
  const url = rel && !rel.external ? ctx.pkg.url(rel.target) : undefined;
  const crop = find(pic, "srcRect"), [l, t, r, bt] = ["l", "t", "r", "b"].map((k) => num(attr(crop, k)) / 100000);
  const shape = attr(find(kid(pic, "spPr"), "prstGeom"), "prst");
  const frame: CSSProperties = { position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", borderRadius: shape === "ellipse" ? "50%" : shape === "roundRect" ? Math.min(b.w, b.h) * 0.16 : undefined, transform: [b.rot ? `rotate(${b.rot}deg)` : "", b.flipH ? "scaleX(-1)" : "", b.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined };
  if (!url) return <div key={key_} style={{ ...frame, background: "rgba(128,128,128,.12)", border: "1px dashed rgba(128,128,128,.5)", display: "grid", placeItems: "center", font: "12px sans-serif", color: "#777" }}>Picture</div>;
  const iw = b.w / Math.max(0.01, 1 - l - r), ih = b.h / Math.max(0.01, 1 - t - bt);
  return <div key={key_} style={frame}><img src={url} alt={attr(find(pic, "cNvPr"), "descr") || ""} draggable={false} style={{ position: "absolute", left: -l * iw, top: -t * ih, width: iw, height: ih }} /></div>;
}

/** What a PowerPoint table style gives a cell: fill, text colour and weight, and borders, by the part of the table the cell is in. */
type CellLook = { fill?: string; color?: string; bold?: boolean; borders: Partial<Record<"l" | "r" | "t" | "b" | "h" | "v", string>> };
function tableLook(ctx: Ctx, styleId: string | undefined, flags: { firstRow: boolean; bandRow: boolean; firstCol: boolean; lastRow: boolean; lastCol: boolean; bandCol: boolean }, r: number, c: number, rows: number, cols: number): CellLook {
  const style = all(ctx.pkg.xml("ppt/tableStyles.xml"), "tblStyle").find((s) => attr(s, "styleId") === styleId);
  const look: CellLook = { borders: {} };
  if (!style) return look;
  const parts = ["wholeTbl", flags.bandRow && (r - (flags.firstRow ? 1 : 0)) % 2 === 0 && r >= (flags.firstRow ? 1 : 0) ? "band1H" : flags.bandRow ? "band2H" : "", flags.bandCol && c % 2 === 0 ? "band1V" : flags.bandCol ? "band2V" : "", flags.firstCol && c === 0 && "firstCol", flags.lastCol && c === cols - 1 && "lastCol", flags.lastRow && r === rows - 1 && "lastRow", flags.firstRow && r === 0 && "firstRow"].filter(Boolean) as string[];
  for (const name of parts) {
    const part = kid(style, name);
    if (!part) continue;
    const tx = kid(part, "tcTxStyle"), cs = kid(part, "tcStyle");
    if (tx) { if (attr(tx, "b") === "on") look.bold = true; if (attr(tx, "b") === "off") look.bold = false; const col = color(kids(tx).find((k) => /Clr$/.test(k.localName)), ctx.theme, ctx.map) ?? color(kid(tx, "fontRef")?.firstElementChild, ctx.theme, ctx.map); if (col) look.color = col; }
    if (cs) {
      const fill = fillColor(kid(cs, "fill"), ctx.theme, ctx.map);
      if (fill !== undefined) look.fill = fill || undefined;
      const bdr = kid(cs, "tcBdr");
      for (const [key, name2] of [["l", "left"], ["r", "right"], ["t", "top"], ["b", "bottom"], ["h", "insideH"], ["v", "insideV"]] as const) {
        const ln = kid(kid(bdr, name2), "ln"), c2 = ln ? fillColor(ln, ctx.theme, ctx.map) : undefined;
        if (c2) look.borders[key] = `${Math.max(1, num(attr(ln, "w"), 12700) / EMU)}px solid ${c2}`;
      }
    }
  }
  return look;
}

function TableFrame({ ctx, frame, b, key_ }: { ctx: Ctx; frame: Element; b: NonNullable<ReturnType<typeof box>>; key_: string }) {
  const tbl = find(frame, "tbl");
  const widths = all(kid(tbl, "tblGrid"), "gridCol").map((g) => px(num(attr(g, "w"))));
  const rows = kids(tbl, "tr");
  const tblPr = kid(tbl, "tblPr"), styleId = kid(tblPr, "tableStyleId")?.textContent || undefined;
  const flags = { firstRow: attr(tblPr, "firstRow") === "1", bandRow: attr(tblPr, "bandRow") === "1", firstCol: attr(tblPr, "firstCol") === "1", lastRow: attr(tblPr, "lastRow") === "1", lastCol: attr(tblPr, "lastCol") === "1", bandCol: attr(tblPr, "bandCol") === "1" };
  const side = (tcPr: Element | undefined, name: string) => { const ln = kid(tcPr, name); const c = ln ? fillColor(ln, ctx.theme, ctx.map) : undefined; return c ? `${Math.max(1, num(attr(ln, "w"), 9525) / EMU)}px solid ${c}` : undefined; };
  return <table key={key_} style={{ position: "absolute", left: b.x, top: b.y, width: widths.reduce((a, c) => a + c, 0) || b.w, borderCollapse: "collapse", tableLayout: "fixed" }}>
    <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    <tbody>{rows.map((tr, i) => <tr key={i} style={{ height: px(num(attr(tr, "h"))) }}>{kids(tr, "tc").map((tc, j) => {
      if (attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1") return null;
      const tcPr = kid(tc, "tcPr"), body = kid(tc, "txBody");
      const look = tableLook(ctx, styleId, flags, i, j, rows.length, kids(tr, "tc").length);
      const own = fillColor(tcPr, ctx.theme, ctx.map), background = own === undefined ? look.fill : own;
      const edge = (k: "l" | "r" | "t" | "b", inner: "h" | "v", first: boolean) => look.borders[first ? k : inner] ?? look.borders[k];
      return <td key={j} colSpan={num(attr(tc, "gridSpan"), 1)} rowSpan={num(attr(tc, "rowSpan"), 1)} style={{ background: background || undefined, borderLeft: side(tcPr, "lnL") ?? edge("l", "v", j === 0), borderRight: side(tcPr, "lnR") ?? edge("r", "v", j === kids(tr, "tc").length - 1), borderTop: side(tcPr, "lnT") ?? edge("t", "h", i === 0), borderBottom: side(tcPr, "lnB") ?? edge("b", "h", i === rows.length - 1), padding: `${px(num(attr(tcPr, "marT"), 45720))}px ${px(num(attr(tcPr, "marR"), 91440))}px ${px(num(attr(tcPr, "marB"), 45720))}px ${px(num(attr(tcPr, "marL"), 91440))}px`, verticalAlign: attr(tcPr, "anchor") === "ctr" ? "middle" : attr(tcPr, "anchor") === "b" ? "bottom" : "top", overflow: "hidden" }}>
        {body && <Paragraphs ctx={ctx} body={body} fallbackColor={look.color} bold={look.bold} />}
      </td>;
    })}</tr>)}</tbody>
  </table>;
}

function Chart({ ctx, frame, b, key_ }: { ctx: Ctx; frame: Element; b: NonNullable<ReturnType<typeof box>>; key_: string }) {
  const rel = ctx.pkg.rels(ctx.part).get(attr(find(frame, "chart"), "id") || "");
  if (!rel) return null;
  if (!ctx.charts.has(rel.target)) ctx.charts.set(rel.target, parseChart(ctx.pkg, rel.target, ctx.theme));
  const model = ctx.charts.get(rel.target);
  return model ? <div key={key_} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, background: "#fff" }}><ChartSvg model={model} width={b.w} height={b.h} /></div> : null;
}

/** The shapes of a slide, layout or master, positioned through the groups they sit in. Placeholders of layouts and masters are not drawn. */
function drawTree(ctx: Ctx, tree: Element | undefined, tx: Tx, own: boolean, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  kids(tree).forEach((node, i) => {
    const key = prefix + i, name = node.localName;
    if (find(node, "cNvPr")?.getAttribute("hidden") === "1" && kid(node, "nvSpPr")) return;
    if (name === "grpSp") {
      const xfrm = path(kid(node, "grpSpPr"), "xfrm"), off = kid(xfrm, "off"), ext = kid(xfrm, "ext"), co = kid(xfrm, "chOff"), ce = kid(xfrm, "chExt");
      const sx = num(attr(ce, "cx")) ? num(attr(ext, "cx")) / num(attr(ce, "cx")) : 1, sy = num(attr(ce, "cy")) ? num(attr(ext, "cy")) / num(attr(ce, "cy")) : 1;
      const inner: Tx = { ax: tx.ax * sx, ex: tx.ax * px(num(attr(off, "x")) - num(attr(co, "x")) * sx) + tx.ex, ay: tx.ay * sy, ey: tx.ay * px(num(attr(off, "y")) - num(attr(co, "y")) * sy) + tx.ey };
      out.push(...drawTree(ctx, node, inner, own, key + "."));
    } else if (name === "sp" || name === "cxnSp") {
      const ph = name === "sp" ? placeholder(node) : undefined;
      if (ph && !own) return;
      let xfrm = path(kid(node, "spPr"), "xfrm");
      if (!xfrm && ph) xfrm = path(kid(counterpart(spTree(ctx.layout), ph), "spPr"), "xfrm") || path(kid(counterpart(spTree(ctx.master), ph), "spPr"), "xfrm");
      const b = box(xfrm, tx);
      if (b) out.push(<ShapeBox key={key} key_={key} ctx={ctx} sp={node} b={b} />);
    } else if (name === "pic") {
      const b = box(path(kid(node, "spPr"), "xfrm"), tx);
      if (b) out.push(<Picture key={key} key_={key} ctx={ctx} pic={node} b={b} />);
    } else if (name === "graphicFrame") {
      const b = box(kid(node, "xfrm"), tx);
      if (!b) return;
      if (find(node, "tbl")) out.push(<TableFrame key={key} key_={key} ctx={ctx} frame={node} b={b} />);
      else if (find(node, "chart")) out.push(<Chart key={key} key_={key} ctx={ctx} frame={node} b={b} />);
    }
  });
  return out;
}

/** A slide, layout or master's background as CSS. */
function background(ctx: Ctx, part: Element | undefined): CSSProperties | undefined {
  const bg = find(part, "bg");
  if (!bg) return undefined;
  const pr = kid(bg, "bgPr");
  if (pr) { const g = gradientCss(pr, ctx.theme, ctx.map); if (g) return { background: g }; const c = fillColor(pr, ctx.theme, ctx.map); if (c) return { background: c }; }
  const ref = kid(bg, "bgRef"), c = color(ref?.firstElementChild, ctx.theme, ctx.map);
  return c ? { background: c } : undefined;
}

export function parsePptx(pkg: Pkg): PptxModel {
  const presPart = "ppt/presentation.xml", pres = pkg.xml(presPart);
  if (!pres) throw Error("This is not a presentation.");
  const rels = pkg.rels(presPart);
  const size = find(pres, "sldSz"), width = px(num(attr(size, "cx"), 12192000)), height = px(num(attr(size, "cy"), 6858000));
  const theme = parseTheme(pkg, Array.from(pkg.rels(Array.from(rels.values()).find((r) => r.type === "slideMaster")?.target || "").values()).find((r) => r.type === "theme")?.target || Array.from(rels.values()).find((r) => r.type === "theme")?.target);
  const defaults = find(pres, "defaultTextStyle");
  const charts = new Map<string, ChartModel | undefined>();
  const slidePaths = all(find(pres, "sldIdLst"), "sldId").map((s) => rels.get(s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "")?.target).filter((p): p is string => !!p && pkg.has(p));
  const slides = slidePaths.map((part, n) => ({
    part,
    render: (changed: Set<string>) => {
      const doc = pkg.xml(part)!, srel = pkg.rels(part);
      const layoutPart = Array.from(srel.values()).find((r) => r.type === "slideLayout")?.target, layoutDoc = layoutPart ? pkg.xml(layoutPart) : undefined;
      const masterPart = layoutPart ? Array.from(pkg.rels(layoutPart).values()).find((r) => r.type === "slideMaster")?.target : undefined, masterDoc = masterPart ? pkg.xml(masterPart) : undefined;
      const mapEl = find(masterDoc, "clrMap");
      const map = { ...defaultMap, ...(mapEl ? Object.fromEntries(Array.from(mapEl.attributes).map((a) => [a.localName, a.value])) : {}) };
      const clrOverride = find(find(doc, "clrMapOvr"), "overrideClrMapping");
      const effective = clrOverride ? { ...map, ...Object.fromEntries(Array.from(clrOverride.attributes).map((a) => [a.localName, a.value])) } : map;
      const base = { pkg, theme, map: effective, changed, defaults, txStyles: find(masterDoc, "txStyles"), layout: layoutDoc?.documentElement, master: masterDoc?.documentElement, slideNo: n + 1, charts };
      const root: Tx = { ax: 1, ex: 0, ay: 1, ey: 0 };
      const showMaster = attr(doc.documentElement, "showMasterSp") !== "0";
      const layers: ReactNode[] = [];
      if (showMaster && masterDoc && attr(layoutDoc?.documentElement, "showMasterSp") !== "0") layers.push(...drawTree({ ...base, pkg, part: masterPart!, order: new Map() }, spTree(masterDoc.documentElement), root, false, "m"));
      if (layoutDoc) layers.push(...drawTree({ ...base, part: layoutPart!, order: new Map() }, spTree(layoutDoc.documentElement), root, false, "l"));
      layers.push(...drawTree({ ...base, part, order: new Map(all(doc, "p").map((p, i) => [p, i])) }, spTree(doc.documentElement), root, true, "s"));
      const fill = background({ ...base, part, order: new Map() }, doc.documentElement) || background({ ...base, part, order: new Map() }, layoutDoc?.documentElement) || background({ ...base, part, order: new Map() }, masterDoc?.documentElement) || { background: "#fff" };
      return <Scaled width={width} height={height} className="op-slide">
        <div style={{ width, height, position: "relative", overflow: "hidden", ...fill }}>{layers}</div>
      </Scaled>;
    },
  }));
  if (!slides.length) throw Error("This presentation has no slides.");
  return { width, height, slides, dispose: () => pkg.dispose() };
}

export function PptxView({ model, changed }: { model: PptxModel; changed: Set<string> }) {
  return <div className="op-slides">{model.slides.map((s, i) => <section className="op-slide-card" key={s.part} aria-label={"Slide " + (i + 1)}><span className="op-slide-num">{i + 1}</span>{s.render(changed)}</section>)}</div>;
}
