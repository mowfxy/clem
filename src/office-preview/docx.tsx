import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { all, attr, find, kid, kids, num, path, type Pkg } from "./package";
import { fontFamily, parseTheme, type Theme } from "./drawingml";
import { ommlToMathml } from "./omml";
import { Scaled } from "./scaled";

/**
 * A Word document drawn as pages: paragraphs and tables with their styles (resolved through basedOn chains and the document
 * defaults), numbered and bulleted lists, pictures, native equations (as MathML), headers and footers with page numbers,
 * footnotes, columns and page breaks. Pages are laid out here: each block is measured and blocks are placed until a page is full.
 */
type Fields = { page: number; total: number };
type Section = { w: number; h: number; top: number; right: number; bottom: number; left: number; header: number; footer: number; cols: number; gap: number; titlePg: boolean; continuous: boolean; headers: Record<string, string>; footers: Record<string, string> };
type Block = { node: ReactNode; breakBefore?: boolean; keepNext?: boolean };
type Ctx = { pkg: Pkg; part: string; styles: Map<string, Element>; defaults: { p?: Element; r?: Element }; numbering: Map<string, Element>; abstracts: Map<string, Element>; counters: Map<string, number[]>; theme: Theme; changed: Set<string>; order: Map<Element, number>; fields: Fields; notes: string[] };
const tw = (v: string | null | undefined) => num(v) / 15; // twips → px at 96 dpi
const HIGHLIGHT: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff" };
const flag = (el: Element | undefined) => !!el && attr(el, "val") !== "0" && attr(el, "val") !== "false" && attr(el, "val") !== "off";

/** A style's property element (pPr or rPr) up through its basedOn chain, nearest first. */
function chainOf(ctx: Ctx, id: string | undefined, kind: "pPr" | "rPr") {
  const out: (Element | undefined)[] = [];
  for (let seen = 0; id && seen < 12; seen++) { const style = ctx.styles.get(id); if (!style) break; out.push(kid(style, kind)); id = attr(kid(style, "basedOn"), "val"); }
  return out;
}
const firstKid = (chain: (Element | undefined)[], name: string) => { for (const el of chain) { const k = kid(el, name); if (k) return k; } return undefined; };

function runCss(ctx: Ctx, rPr: Element | undefined, styleId: string | undefined, paragraphChain: (Element | undefined)[]): CSSProperties {
  const chain = [rPr, ...chainOf(ctx, styleId, "rPr"), ...paragraphChain, ctx.defaults.r];
  const size = num(attr(firstKid(chain, "sz"), "val"), 22);
  const fonts = firstKid(chain, "rFonts");
  const themeFace = attr(fonts, "asciiTheme");
  const face = themeFace ? (/major/i.test(themeFace) ? ctx.theme.major : ctx.theme.minor) : attr(fonts, "ascii") || attr(fonts, "hAnsi");
  const color = attr(firstKid(chain, "color"), "val"), shade = attr(firstKid(chain, "shd"), "fill"), highlight = attr(firstKid(chain, "highlight"), "val");
  const under = firstKid(chain, "u"), vert = attr(firstKid(chain, "vertAlign"), "val");
  const own = (name: string) => firstKid(chain, name);
  return {
    fontFamily: fontFamily(face, ctx.theme), fontSize: (size / 2) * (4 / 3) * (vert ? 0.7 : 1), color: color && color !== "auto" && /^[0-9a-f]{6}$/i.test(color) ? "#" + color : undefined,
    fontWeight: flag(own("b")) ? 700 : undefined, fontStyle: flag(own("i")) ? "italic" : undefined,
    textDecoration: [under && attr(under, "val") !== "none" && "underline", flag(own("strike")) && "line-through"].filter(Boolean).join(" ") || undefined,
    textTransform: flag(own("caps")) ? "uppercase" : undefined, fontVariant: flag(own("smallCaps")) ? "small-caps" : undefined, verticalAlign: vert === "superscript" ? "super" : vert === "subscript" ? "sub" : undefined,
    background: highlight ? HIGHLIGHT[highlight] : shade && /^[0-9a-f]{6}$/i.test(shade) ? "#" + shade : undefined, letterSpacing: attr(own("spacing"), "val") ? tw(attr(own("spacing"), "val")) : undefined,
  };
}

function marker(ctx: Ctx, numPr: Element | undefined): { text: string; css: CSSProperties; left?: number; hanging?: number } | undefined {
  const id = attr(kid(numPr, "numId"), "val");
  if (!numPr || !id || id === "0") return undefined;
  const level = num(attr(kid(numPr, "ilvl"), "val")), abstract = ctx.abstracts.get(attr(kid(ctx.numbering.get(id), "abstractNumId"), "val") || "");
  const lvl = kids(abstract, "lvl").find((l) => num(attr(l, "ilvl")) === level);
  if (!lvl) return undefined;
  const key = attr(kid(ctx.numbering.get(id), "abstractNumId"), "val") || id, counts = ctx.counters.get(key) || Array(9).fill(0);
  counts[level] = counts[level] ? counts[level] + 1 : num(attr(kid(lvl, "start"), "val"), 1);
  for (let k = level + 1; k < 9; k++) counts[k] = 0;
  ctx.counters.set(key, counts);
  const fmt = (n: number, format: string) => {
    const alpha = (k: number) => { let s = ""; for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s; return s; };
    const roman = (k: number) => [["m", 1000], ["cm", 900], ["d", 500], ["cd", 400], ["c", 100], ["xc", 90], ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1]].reduce((s, [r, v]) => { while (k >= (v as number)) { s += r; k -= v as number; } return s; }, "");
    return format === "lowerLetter" ? alpha(n) : format === "upperLetter" ? alpha(n).toUpperCase() : format === "lowerRoman" ? roman(n) : format === "upperRoman" ? roman(n).toUpperCase() : format === "decimalZero" ? String(n).padStart(2, "0") : String(n);
  };
  const format = attr(kid(lvl, "numFmt"), "val") || "decimal";
  let text = attr(kid(lvl, "lvlText"), "val") ?? "";
  if (format === "bullet") text = text.replace(/[-]/g, "•") || "•";
  else if (format === "none") text = "";
  else text = text.replace(/%(\d)/g, (_, d) => { const l = kids(abstract, "lvl").find((x) => num(attr(x, "ilvl")) === Number(d) - 1); return fmt(counts[Number(d) - 1] || 1, attr(kid(l, "numFmt"), "val") || "decimal"); });
  const ind = kid(kid(lvl, "pPr"), "ind");
  return { text, css: runCss(ctx, kid(lvl, "rPr"), undefined, []), left: attr(ind, "left") ? tw(attr(ind, "left")) : undefined, hanging: attr(ind, "hanging") ? tw(attr(ind, "hanging")) : undefined };
}

/** The runs of a paragraph (or hyperlink) as inline nodes; fields (page numbers) are replaced with their values. */
function runs(ctx: Ctx, container: Element, chain: (Element | undefined)[], pStyle: string | undefined, state = { field: "", hold: false, skip: false }): ReactNode[] {
  const out: ReactNode[] = [];
  kids(container).forEach((r, i) => {
    const name = r.localName;
    if (name === "hyperlink" || name === "smartTag" || name === "sdt" || name === "ins" || name === "sdtContent") { out.push(...runs(ctx, r, chain, pStyle, state)); return; }
    if (name === "oMath" || name === "oMathPara") { out.push(<span key={i} className="op-math" dangerouslySetInnerHTML={{ __html: ommlToMathml(r) }} />); return; }
    if (name === "fldSimple") { const instr = attr(r, "instr") || ""; out.push(/PAGE/i.test(instr) && !/NUMPAGES/i.test(instr) ? ctx.fields.page : /NUMPAGES/i.test(instr) ? ctx.fields.total : <span key={i}>{runs(ctx, r, chain, pStyle, state)}</span>); return; }
    if (name !== "r") return;
    const rPr = kid(r, "rPr"), style = runCss(ctx, rPr, attr(kid(rPr, "rStyle"), "val"), chain);
    for (const [k, part] of kids(r).entries()) {
      const key = i + "." + k;
      if (part.localName === "fldChar") {
        const t = attr(part, "fldCharType");
        if (t === "begin") { state.field = ""; state.hold = true; state.skip = false; } else if (t === "separate") { state.hold = false; state.skip = /NUMPAGES|PAGE\b/i.test(state.field); if (state.skip) out.push(<span key={key} style={style}>{/NUMPAGES/i.test(state.field) ? ctx.fields.total : ctx.fields.page}</span>); } else if (t === "end") { state.hold = false; state.skip = false; }
      } else if (part.localName === "instrText") state.field += part.textContent || "";
      else if (state.skip || state.hold) continue;
      else if (part.localName === "t") out.push(<span key={key} style={style}>{part.textContent}</span>);
      else if (part.localName === "tab") out.push(<span key={key} style={style}>{"\t"}</span>);
      else if (part.localName === "br" && attr(part, "type") !== "page" && attr(part, "type") !== "column") out.push(<br key={key} />);
      else if (part.localName === "footnoteReference") { const n = ctx.notes.length + 1; ctx.notes.push(attr(part, "id") || ""); out.push(<sup key={key} style={{ fontSize: "0.7em" }}>{n}</sup>); }
      else if (part.localName === "drawing" || part.localName === "pict") {
        const blip = find(part, "blip"), rel = ctx.pkg.rels(ctx.part).get(attr(blip, "embed") || ""), url = rel ? ctx.pkg.url(rel.target) : undefined;
        const ext = find(part, "extent"), w = num(attr(ext, "cx")) / 9525, h = num(attr(ext, "cy")) / 9525;
        out.push(url ? <img key={key} src={url} alt={attr(find(part, "docPr"), "descr") || ""} draggable={false} style={{ width: w || undefined, height: h || undefined, maxWidth: "100%", verticalAlign: "bottom" }} /> : <span key={key} className="op-missing">[picture]</span>);
      }
    }
  });
  return out;
}

function paragraph(ctx: Ctx, p: Element, key: string | number): Block {
  const pPr = kid(p, "pPr"), styleId = attr(kid(pPr, "pStyle"), "val");
  const chain = [pPr, ...chainOf(ctx, styleId, "pPr"), ctx.defaults.p];
  const own = (name: string) => firstKid(chain, name);
  const runChain = [kid(pPr, "rPr"), ...chainOf(ctx, styleId, "rPr")];
  const ind = own("ind"), spacing = own("spacing"), jc = attr(own("jc"), "val"), bidi = flag(own("bidi"));
  const num_ = marker(ctx, own("numPr"));
  const before = tw(attr(spacing, "before")), after = tw(attr(spacing, "after")), line = attr(spacing, "line"), rule = attr(spacing, "lineRule");
  const left = attr(ind, "left") ?? attr(ind, "start"), hanging = attr(ind, "hanging"), first = attr(ind, "firstLine");
  const bottom = kid(own("pBdr"), "bottom"), top = kid(own("pBdr"), "top");
  const border = (b: Element | undefined) => b && attr(b, "val") !== "nil" && attr(b, "val") !== "none" ? `${Math.max(1, num(attr(b, "sz"), 4) / 6)}px solid ${/^[0-9a-f]{6}$/i.test(attr(b, "color") || "") ? "#" + attr(b, "color") : "#000"}` : undefined;
  const shade = attr(own("shd"), "fill");
  const breakAfter = all(p, "br").some((b) => attr(b, "type") === "page"), breakBefore = flag(own("pageBreakBefore"));
  const hasContent = !!find(p, "t") || !!find(p, "drawing") || !!find(p, "oMath") || !!find(p, "oMathPara") || !!find(p, "footnoteReference");
  const changed = ctx.changed.has(ctx.part + ":" + ctx.order.get(p));
  const math = kids(p).length === 1 && (kids(p)[0].localName === "oMathPara");
  const baseSize = (num(attr(firstKid([...runChain, ctx.defaults.r], "sz"), "val"), 22) / 2) * (4 / 3);
  const lineHeight = rule === "exact" || rule === "atLeast" ? tw(line) + "px" : line ? (num(line) / 240) * 1.2 : 1.2;
  const heading = /^heading|^title/i.test(styleId || "");
  const css: CSSProperties = {
    textAlign: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : bidi ? "start" : "left", direction: bidi ? "rtl" : undefined,
    paddingTop: before, paddingBottom: after, lineHeight, marginLeft: num_ ? undefined : left ? tw(left) : undefined, marginRight: attr(ind, "right") ? tw(attr(ind, "right")) : undefined,
    textIndent: num_ ? undefined : hanging ? -tw(hanging) : first ? tw(first) : undefined, borderBottom: border(bottom), borderTop: border(top), background: shade && /^[0-9a-f]{6}$/i.test(shade) ? "#" + shade : undefined,
    minHeight: hasContent ? undefined : baseSize * 1.2, whiteSpace: "pre-wrap", tabSize: 36, overflowWrap: "anywhere", textAlignLast: jc === "distribute" ? "justify" : undefined,
    ...(math ? { textAlign: "center" as const } : {}),
  };
  const body = runs(ctx, p, runChain, styleId);
  const pad = num_ ? (num_.left ?? tw(attr(ind, "left")) ?? 0) : 0, hang = num_ ? (num_.hanging ?? tw(hanging)) : 0;
  return {
    breakBefore, keepNext: flag(own("keepNext")) || heading,
    node: <div key={key} className={changed ? "fp-changed" : undefined} style={num_ ? { ...css, paddingLeft: pad, textIndent: -hang, position: "relative" } : css} data-break-after={breakAfter || undefined}>
      {num_ && num_.text && <span style={{ display: "inline-block", width: hang || 18, textIndent: 0, ...num_.css, ...runCss(ctx, kid(pPr, "rPr"), styleId, []), fontWeight: num_.css.fontWeight }}>{num_.text}{"\t"}</span>}
      {body}
    </div>,
    ...(breakAfter ? { breakAfter: true } : {}),
  } as Block & { breakAfter?: boolean };
}

function table(ctx: Ctx, tbl: Element, key: string | number): Block {
  const grid = all(kid(tbl, "tblGrid"), "gridCol").map((g) => tw(attr(g, "w")));
  const pr = kid(tbl, "tblPr"), tableBorders = kid(pr, "tblBorders");
  const side = (b: Element | undefined) => b && attr(b, "val") !== "nil" && attr(b, "val") !== "none" ? `${Math.max(1, num(attr(b, "sz"), 4) / 6)}px solid ${/^[0-9a-f]{6}$/i.test(attr(b, "color") || "") ? "#" + attr(b, "color") : "#000"}` : undefined;
  const rows = kids(tbl, "tr");
  // Cell margins in twips: the cell's own, else the table's, else Word's default.
  const cellMargin = (tcPr: Element | undefined, name: string, fallback: number) => tw(attr(kid(kid(tcPr, "tcMar"), name), "w") ?? attr(kid(kid(pr, "tblCellMar"), name), "w") ?? String(fallback));
  // Vertical merges: a cell that continues the one above is swallowed by it.
  const span = (r: number, c: number) => { let n = 1; for (let k = r + 1; k < rows.length; k++) { const next = kids(rows[k], "tc")[c]; if (attr(kid(kid(next, "tcPr"), "vMerge"), "val") === "continue" || (kid(kid(next, "tcPr"), "vMerge") && !attr(kid(kid(next, "tcPr"), "vMerge"), "val"))) n++; else break; } return n; };
  const total = grid.reduce((a, b) => a + b, 0);
  return { node: <table key={key} style={{ borderCollapse: "collapse", width: total || "100%", tableLayout: "fixed", marginBottom: 6 }}>
    <colgroup>{grid.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    <tbody>{rows.map((tr, r) => <tr key={r}>{kids(tr, "tc").map((tc, c) => {
      const tcPr = kid(tc, "tcPr"), merge = kid(tcPr, "vMerge");
      if (merge && attr(merge, "val") !== "restart") return null;
      const borders = kid(tcPr, "tcBorders"), shade = attr(kid(tcPr, "shd"), "fill");
      const last = r === rows.length - 1, firstRow = r === 0;
      const colSpan = num(attr(kid(tcPr, "gridSpan"), "val"), 1);
      const nodes = kids(tc).flatMap((child, i) => child.localName === "p" ? [paragraph(ctx, child, i).node] : child.localName === "tbl" ? [table(ctx, child, i).node] : []);
      return <td key={c} colSpan={colSpan > 1 ? colSpan : undefined} rowSpan={merge ? span(r, c) : undefined} style={{
        verticalAlign: attr(kid(tcPr, "vAlign"), "val") === "center" ? "middle" : attr(kid(tcPr, "vAlign"), "val") === "bottom" ? "bottom" : "top", background: shade && /^[0-9a-f]{6}$/i.test(shade) ? "#" + shade : undefined, overflow: "hidden",
        padding: `${cellMargin(tcPr, "top", 0)}px ${cellMargin(tcPr, "right", 108)}px ${cellMargin(tcPr, "bottom", 0)}px ${cellMargin(tcPr, "left", 108)}px`,
        borderTop: side(kid(borders, "top")) ?? (firstRow ? side(kid(tableBorders, "top")) : side(kid(tableBorders, "insideH"))), borderBottom: side(kid(borders, "bottom")) ?? (last ? side(kid(tableBorders, "bottom")) : side(kid(tableBorders, "insideH"))),
        borderLeft: side(kid(borders, "left")) ?? (c === 0 ? side(kid(tableBorders, "left")) : side(kid(tableBorders, "insideV"))), borderRight: side(kid(borders, "right")) ?? (c === kids(tr, "tc").length - 1 ? side(kid(tableBorders, "right")) : side(kid(tableBorders, "insideV"))),
      }}>{nodes}</td>;
    })}</tr>)}</tbody>
  </table> };
}

type Parsed = { sections: { props: Section; blocks: Block[] }[]; notes: ReactNode; ctx: Ctx; doc: Document };
export type DocxModel = { build: (changed: Set<string>) => Parsed; header: (props: Section, page: number, total: number, kind: "headers" | "footers") => ReactNode; dispose: () => void };

export function parseDocx(pkg: Pkg): DocxModel {
  const part = "word/document.xml", doc = pkg.xml(part);
  if (!doc) throw Error("This is not a Word document.");
  const rels = pkg.rels(part);
  const stylesDoc = pkg.xml("word/styles.xml"), numberingDoc = pkg.xml("word/numbering.xml");
  const theme = parseTheme(pkg, Array.from(rels.values()).find((r) => r.type === "theme")?.target || (pkg.has("word/theme/theme1.xml") ? "word/theme/theme1.xml" : undefined));
  const base: Omit<Ctx, "changed" | "order" | "fields" | "notes" | "counters"> = {
    pkg, part, theme, styles: new Map(all(stylesDoc, "style").map((s) => [attr(s, "styleId") || "", s])),
    defaults: { p: path(find(stylesDoc, "docDefaults") || undefined, "pPrDefault/pPr"), r: path(find(stylesDoc, "docDefaults") || undefined, "rPrDefault/rPr") },
    numbering: new Map(all(numberingDoc, "num").map((n) => [attr(n, "numId") || "", n])), abstracts: new Map(all(numberingDoc, "abstractNum").map((n) => [attr(n, "abstractNumId") || "", n])),
  };
  const bodyEl = find(doc, "body")!;
  const readSection = (sectPr: Element | undefined): Section => {
    const size = kid(sectPr, "pgSz"), mar = kid(sectPr, "pgMar"), cols = kid(sectPr, "cols");
    const refs = (name: string) => Object.fromEntries(kids(sectPr, name).map((r) => [attr(r, "type") || "default", rels.get(attr(r, "id") || "")?.target || ""]));
    return { w: tw(attr(size, "w")) || 794, h: tw(attr(size, "h")) || 1123, top: tw(attr(mar, "top") ?? "1440"), right: tw(attr(mar, "right") ?? "1440"), bottom: tw(attr(mar, "bottom") ?? "1440"), left: tw(attr(mar, "left") ?? "1440"), header: tw(attr(mar, "header") ?? "720"), footer: tw(attr(mar, "footer") ?? "720"), cols: Math.max(1, num(attr(cols, "num"), 1)), gap: tw(attr(cols, "space") ?? "720"), titlePg: !!kid(sectPr, "titlePg"), continuous: attr(kid(sectPr, "type"), "val") === "continuous", headers: refs("headerReference"), footers: refs("footerReference") };
  };
  const build = (changed: Set<string>): Parsed => {
    const ctx: Ctx = { ...base, changed, order: new Map(all(doc, "p").map((p, i) => [p, i])), counters: new Map(), fields: { page: 0, total: 0 }, notes: [] };
    const sections: Parsed["sections"] = [];
    let blocks: Block[] = [];
    const nodes = kids(bodyEl);
    nodes.forEach((child, i) => {
      if (child.localName === "p") {
        const b = paragraph(ctx, child, i);
        blocks.push(b);
        const sectPr = kid(kid(child, "pPr"), "sectPr");
        if (sectPr) { sections.push({ props: readSection(sectPr), blocks }); blocks = []; }
      } else if (child.localName === "tbl") blocks.push(table(ctx, child, i));
      else if (child.localName === "sectPr") { sections.push({ props: readSection(child), blocks }); blocks = []; }
    });
    if (blocks.length) sections.push({ props: readSection(undefined), blocks });
    // Footnotes are gathered at the end, numbered as referenced.
    const notesDoc = pkg.xml("word/footnotes.xml");
    const notes = ctx.notes.length && notesDoc ? <div className="op-notes">{ctx.notes.map((id, n) => { const fn = all(notesDoc, "footnote").find((f) => attr(f, "id") === id); return <p key={n}><sup>{n + 1}</sup> {all(fn, "t").map((t) => t.textContent).join("")}</p>; })}</div> : null;
    return { sections, notes, ctx, doc };
  };
  const header = (props: Section, page: number, total: number, kind: "headers" | "footers") => {
    const table = kind === "headers" ? props.headers : props.footers;
    const target = page === 1 && props.titlePg ? table.first : table.default;
    const hf = target ? pkg.xml(target) : undefined;
    if (!hf) return null;
    const ctx: Ctx = { ...base, part: target, changed: new Set(), order: new Map(), counters: new Map(), fields: { page, total }, notes: [] };
    return kids(hf.documentElement).map((c, i) => c.localName === "p" ? paragraph(ctx, c, i).node : c.localName === "tbl" ? table_(ctx, c, i) : null);
  };
  const table_ = (ctx: Ctx, el: Element, i: number) => table(ctx, el, i).node;
  return { build, header, dispose: () => pkg.dispose() };
}

type Page = { section: Section; blocks: ReactNode[]; first: boolean };
export function DocxView({ model, changed }: { model: DocxModel; changed: Set<string> }) {
  const parsed = useMemo(() => model.build(changed), [model, changed]);
  const probe = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>();
  // Each block is measured at its section's column width; blocks are then placed page by page.
  useLayoutEffect(() => {
    const host = probe.current;
    if (!host) return;
    const out: Page[] = [];
    parsed.sections.forEach((section, s) => {
      const p = section.props, room = p.h - p.top - p.bottom, cols = p.cols;
      const items = Array.from(host.querySelectorAll<HTMLElement>(`[data-section="${s}"] > [data-block]`));
      const heights = items.map((el) => el.getBoundingClientRect().height);
      let used = 0, current: number[] = [];
      const flush = () => { if (current.length) out.push({ section: p, blocks: current.map((i) => section.blocks[i].node), first: false }); current = []; used = 0; };
      section.blocks.forEach((b, i) => {
        const h = heights[i] || 0, capacity = room * cols;
        if (b.breakBefore) flush();
        if (used + h > capacity && current.length) {
          // A heading never ends a page: it moves to the next with the block it introduces.
          const carry: number[] = [];
          while (current.length > 1 && section.blocks[current.at(-1)!].keepNext) carry.unshift(current.pop()!);
          flush();
          current = carry; used = carry.reduce((a, k) => a + (heights[k] || 0), 0);
        }
        current.push(i); used += h;
        if ((b as Block & { breakAfter?: boolean }).breakAfter) flush();
      });
      flush();
    });
    out.forEach((page, i) => { page.first = i === 0; });
    setPages(out.length ? out : [{ section: parsed.sections[0]?.props, blocks: [], first: true }]);
  }, [parsed]);
  const total = pages?.length || 0;
  return <div className="op-docx">
    <div ref={probe} className="op-probe" aria-hidden>{parsed.sections.map((s, i) => <div key={i} data-section={i} style={{ width: (s.props.w - s.props.left - s.props.right - s.props.gap * (s.props.cols - 1)) / s.props.cols }}>{s.blocks.map((b, k) => <div key={k} data-block>{b.node}</div>)}</div>)}</div>
    {(pages || []).map((page, n) => {
      const p = page.section, inner = p.w - p.left - p.right;
      return <section key={n} className="op-page-card" aria-label={"Page " + (n + 1)}><Scaled width={p.w} height={p.h} className="op-page-wrap" max={1.5}>
        <div className="op-page" style={{ width: p.w, height: p.h }}>
          <div className="op-header" style={{ left: p.left, width: inner, top: p.header }}>{model.header(p, n + 1, total, "headers")}</div>
          <div className="op-body" style={{ position: "absolute", left: p.left, top: p.top, width: inner, height: p.h - p.top - p.bottom, ...(p.cols > 1 ? { columnCount: p.cols, columnGap: p.gap, columnFill: "auto" as const } : {}), overflow: "hidden" }}>
            {page.blocks}
            {n === total - 1 && parsed.notes}
          </div>
          <div className="op-footer" style={{ left: p.left, width: inner, bottom: p.footer }}>{model.header(p, n + 1, total, "footers")}</div>
        </div>
      </Scaled></section>;
    })}
    {!pages && <p className="fp-note">Laying out pages…</p>}
  </div>;
}
