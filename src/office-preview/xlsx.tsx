import { useState, type CSSProperties } from "react";
import { all, attr, find, kid, kids, num, type Pkg } from "./package";
import { parseTheme, type Theme } from "./drawingml";
import { ChartSvg, parseChart, type ChartModel } from "./chart";
import { Calculator, cellKey, colNumber, showValue, isError, type Cell, type Grid, type Value } from "../../core/xlsx-formulas";
import { BUILTIN } from "../../core/numfmt";

/** A workbook as formatted tables: every cell with its number format, fonts, fills, borders and merges, and every formula calculated. */
type Style = { fmt: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; size?: number; font?: string; fill?: string; h?: string; v?: string; wrap?: boolean; indent?: number; border: Partial<Record<"l" | "r" | "t" | "b", string>> };
type Shown = { r: number; c: number; index: number; style: Style; text: string; value: Value; formula: boolean; span: number };
type SheetModel = {
  name: string; part: string; cols: Map<number, { px: number; hidden: boolean }>; defaultCol: number; rows: Map<number, { px: number; hidden: boolean }>; defaultRow: number;
  cells: Map<number, Map<number, Shown>>; merges: { r1: number; c1: number; r2: number; c2: number }[]; maxRow: number; maxCol: number; frozen: number; truncated: boolean; charts: ChartModel[];
};
export type XlsxModel = { sheets: SheetModel[] };
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
const INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080"];
const MAX_ROWS = 3000, MAX_COLS = 150;
const BORDER_PX: Record<string, string> = { thin: "1px solid", hair: "1px dotted", dotted: "1px dotted", dashed: "1px dashed", medium: "2px solid", thick: "3px solid", double: "3px double", mediumDashed: "2px dashed" };

function xcolor(el: Element | undefined, theme: Theme): string | undefined {
  if (!el) return undefined;
  let hex = attr(el, "rgb")?.slice(-6);
  const t = attr(el, "theme"), idx = attr(el, "indexed");
  if (!hex && t !== undefined) hex = theme.colors[THEME_ORDER[num(t)]];
  if (!hex && idx !== undefined) hex = INDEXED[num(idx)];
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const tint = num(attr(el, "tint"));
  const ch = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16)).map((k) => Math.round(tint > 0 ? k + (255 - k) * tint : k * (1 + tint)));
  return "#" + ch.map((k) => k.toString(16).padStart(2, "0")).join("");
}
const flag = (el: Element | undefined) => !!el && attr(el, "val") !== "0" && attr(el, "val") !== "false";

function readStyles(pkg: Pkg, theme: Theme) {
  const doc = pkg.xml("xl/styles.xml");
  const codes = new Map<number, string>();
  for (const n of all(doc, "numFmt")) codes.set(num(attr(n, "numFmtId")), attr(n, "formatCode") || "General");
  const fonts = kids(find(doc, "fonts"), "font").map((f) => ({ bold: flag(kid(f, "b")), italic: flag(kid(f, "i")), underline: !!kid(f, "u") && attr(kid(f, "u"), "val") !== "none", strike: flag(kid(f, "strike")), size: num(attr(kid(f, "sz"), "val"), 11), color: xcolor(kid(f, "color"), theme), font: attr(kid(f, "name"), "val") }));
  const fills = kids(find(doc, "fills"), "fill").map((f) => { const p = kid(f, "patternFill"); return attr(p, "patternType") === "solid" ? xcolor(kid(p, "fgColor"), theme) : undefined; });
  const borders = kids(find(doc, "borders"), "border").map((b) => {
    const out: Style["border"] = {};
    for (const [key, name] of [["l", "left"], ["r", "right"], ["t", "top"], ["b", "bottom"]] as const) { const side = kid(b, name), style = attr(side, "style"); if (style) out[key] = `${BORDER_PX[style] || "1px solid"} ${xcolor(kid(side, "color"), theme) || "#000"}`; }
    return out;
  });
  const xfs = kids(find(doc, "cellXfs"), "xf").map((xf): Style => {
    const font = fonts[num(attr(xf, "fontId"))] || fonts[0], align = kid(xf, "alignment"), id = num(attr(xf, "numFmtId"));
    return { fmt: codes.get(id) ?? BUILTIN[id] ?? "General", bold: font?.bold, italic: font?.italic, underline: font?.underline, strike: font?.strike, color: font?.color, size: font?.size, font: font?.font, fill: fills[num(attr(xf, "fillId"))], h: attr(align, "horizontal"), v: attr(align, "vertical"), wrap: attr(align, "wrapText") === "1" || attr(align, "wrapText") === "true", indent: num(attr(align, "indent")), border: borders[num(attr(xf, "borderId"))] || {} };
  });
  return xfs.length ? xfs : [{ fmt: "General", border: {} } as Style];
}

/** A shared formula's text for a cell that only names it: the master's formula with its relative references moved. */
function shiftFormula(formula: string, dr: number, dc: number) {
  return formula.replace(/('(?:[^']|'')+'!|[A-Za-z_][\w.]*!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (_, sheet = "", ac, col, ar, row) => {
    const c = ac ? col : (() => { let n = colNumber(col) + dc, s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s || "A"; })();
    return sheet + ac + c + ar + (ar ? row : Math.max(1, Number(row) + dr));
  });
}
const refOf = (ref: string) => { const m = /^([A-Z]+)(\d+)$/i.exec(ref)!; return { c: colNumber(m[1]), r: Number(m[2]) }; };

export function parseXlsx(pkg: Pkg): XlsxModel {
  const book = pkg.xml("xl/workbook.xml");
  if (!book) throw Error("This is not a workbook.");
  const rels = pkg.rels("xl/workbook.xml");
  const theme = parseTheme(pkg, Array.from(rels.values()).find((r) => r.type === "theme")?.target);
  const styles = readStyles(pkg, theme);
  const strings = all(pkg.xml("xl/sharedStrings.xml"), "si").map((si) => all(si, "t").filter((t) => t.parentElement?.localName !== "rPh").map((t) => t.textContent).join(""));
  const date1904 = attr(find(book, "workbookPr"), "date1904") === "1";
  const entries = all(book, "sheet").map((s) => ({ name: attr(s, "name") || "Sheet", part: rels.get(attr(s, "id") || "")?.target || "" })).filter((s) => pkg.has(s.part));
  // Pass one: every cell's stored value and formula, for the calculator.
  const grid: Grid = new Map();
  const parsed = entries.map((entry) => {
    const doc = pkg.xml(entry.part)!;
    const order = new Map<Element, number>(all(doc, "c").map((c, i) => [c, i]));
    const cells = new Map<string, Cell>(), raw: { r: number; c: number; s: number; index: number; fmt?: string }[] = [], shared = new Map<string, { formula: string; r: number; c: number }>();
    for (const row of all(doc, "row")) for (const c of kids(row, "c")) {
      const { r, c: col } = refOf(attr(c, "r") || "A1");
      const type = attr(c, "t"), v = kid(c, "v")?.textContent ?? "", f = kid(c, "f");
      let value: Value = null;
      if (type === "s") value = strings[num(v)] ?? "";
      else if (type === "str") value = v;
      else if (type === "b") value = v === "1";
      else if (type === "e") value = { error: v };
      else if (type === "inlineStr") value = all(kid(c, "is"), "t").map((t) => t.textContent).join("");
      else if (v !== "") value = Number(v);
      let formula: string | undefined;
      if (f) {
        const text = f.textContent || "";
        if (attr(f, "t") === "shared") {
          const si = attr(f, "si") || "";
          if (text) shared.set(si, { formula: text, r, c: col }); else { const m = shared.get(si); if (m) formula = shiftFormula(m.formula, r - m.r, col - m.c); }
          if (text) formula = text;
        } else formula = text;
        if (formula === "") formula = undefined;
      }
      cells.set(cellKey(r, col), { value, ...(formula !== undefined ? { formula } : {}) });
      raw.push({ r, c: col, s: num(attr(c, "s")), index: order.get(c)! });
    }
    grid.set(entry.name, cells);
    return { ...entry, doc, raw };
  });
  const calc = new Calculator(grid);
  const lookup = (sheet: string, r1: number, c1: number, r2: number, c2: number) => { const out: (string | number | null)[] = []; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = calc.value(sheet, r, c); out.push(isError(v) ? null : typeof v === "boolean" ? String(v) : v); } return out; };
  const sheets = parsed.map(({ name, part, doc, raw }): SheetModel => {
    const cols = new Map<number, { px: number; hidden: boolean }>(), rows = new Map<number, { px: number; hidden: boolean }>();
    const format = find(doc, "sheetFormatPr");
    const defaultCol = attr(format, "defaultColWidth") ? Math.round(num(attr(format, "defaultColWidth")) * 7) : 64, defaultRow = Math.round(num(attr(format, "defaultRowHeight"), 15) * 4 / 3);
    for (const c of all(doc, "col")) for (let i = num(attr(c, "min")); i <= Math.min(num(attr(c, "max")), MAX_COLS + 1); i++) cols.set(i, { px: Math.max(8, Math.round(num(attr(c, "width"), defaultCol / 7) * 7)), hidden: attr(c, "hidden") === "1" });
    for (const r of all(doc, "row")) if (attr(r, "ht") || attr(r, "hidden")) rows.set(num(attr(r, "r")), { px: attr(r, "ht") ? Math.round(num(attr(r, "ht")) * 4 / 3) : defaultRow, hidden: attr(r, "hidden") === "1" });
    const merges = all(doc, "mergeCell").map((m) => { const [a, b = a] = (attr(m, "ref") || "A1").split(":"), p = refOf(a), q = refOf(b); return { r1: p.r, c1: p.c, r2: q.r, c2: q.c }; });
    const model: SheetModel = { name, part, cols, defaultCol, rows, defaultRow, cells: new Map(), merges, maxRow: 0, maxCol: 0, frozen: attr(find(doc, "pane"), "state") === "frozen" || attr(find(doc, "pane"), "state") === "frozenSplit" ? num(attr(find(doc, "pane"), "ySplit")) : 0, truncated: false, charts: [] };
    for (const { r, c, s, index } of raw) {
      if (r > MAX_ROWS || c > MAX_COLS) { model.truncated = true; continue; }
      const style = styles[s] || styles[0], value = calc.value(name, r, c);
      const cell = grid.get(name)!.get(cellKey(r, c));
      const text = typeof value === "string" && /^@$/.test(style.fmt) ? value : showValue(value, style.fmt, date1904);
      if (!text && !style.fill && !Object.keys(style.border).length) continue;
      if (!model.cells.has(r)) model.cells.set(r, new Map());
      model.cells.get(r)!.set(c, { r, c, index, style, text, value, formula: cell?.formula !== undefined, span: 1 });
      model.maxRow = Math.max(model.maxRow, r); model.maxCol = Math.max(model.maxCol, c);
    }
    for (const m of merges) { model.maxRow = Math.max(model.maxRow, Math.min(m.r2, MAX_ROWS)); model.maxCol = Math.max(model.maxCol, Math.min(m.c2, MAX_COLS)); }
    // Text runs on into empty neighbours, the way Excel shows a long title or note.
    const mergedAt = new Set(merges.flatMap((m) => { const out: string[] = []; for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) out.push(r + "," + c); return out; }));
    for (const row of model.cells.values()) for (const cell of row.values()) {
      if (typeof cell.value !== "string" || cell.style.wrap || cell.style.h === "right" || cell.style.h === "center" || mergedAt.has(cell.r + "," + cell.c)) continue;
      const need = cell.text.length * 7 * ((cell.style.size || 11) / 11) + 10;
      let have = cols.get(cell.c)?.px ?? defaultCol, span = 1;
      while (have < need && span < 20 && !model.cells.get(cell.r)?.get(cell.c + span)?.text && !mergedAt.has(cell.r + "," + (cell.c + span))) { have += cols.get(cell.c + span)?.px ?? defaultCol; span++; }
      cell.span = span;
    }
    // Native charts anchored on the sheet.
    const drawing = Array.from(pkg.rels(part).values()).find((r) => r.type === "drawing");
    if (drawing) {
      const dr = pkg.rels(drawing.target);
      for (const ref of all(pkg.xml(drawing.target), "chart")) {
        const target = dr.get(attr(ref, "id") || "")?.target;
        const chart = target && parseChart(pkg, target, theme, lookup);
        if (chart) model.charts.push(chart);
      }
    }
    return model;
  });
  if (!sheets.length) throw Error("This workbook has no sheets.");
  return { sheets };
}

const letterOf = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function cellStyle(s: Style, isNumber: boolean): CSSProperties {
  const h = s.h === "centerContinuous" ? "center" : s.h === "general" || !s.h ? (isNumber ? "right" : "left") : (s.h as CSSProperties["textAlign"]);
  return {
    textAlign: h, verticalAlign: s.v === "center" ? "middle" : s.v === "top" ? "top" : "bottom", background: s.fill, color: s.color, fontWeight: s.bold ? 700 : undefined, fontStyle: s.italic ? "italic" : undefined,
    textDecoration: [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || undefined, fontSize: s.size && s.size !== 11 ? s.size * 4 / 3 : undefined, fontFamily: s.font && s.font !== "Calibri" ? `"${s.font}", Calibri, 'Segoe UI', sans-serif` : undefined,
    whiteSpace: s.wrap ? "pre-wrap" : "nowrap", paddingLeft: s.indent ? 4 + s.indent * 9 : undefined,
    borderLeft: s.border.l, borderRight: s.border.r, borderTop: s.border.t, borderBottom: s.border.b,
  };
}

export function XlsxView({ model, changed }: { model: XlsxModel; changed: Set<string> }) {
  const [active, setActive] = useState(0);
  const sheet = model.sheets[Math.min(active, model.sheets.length - 1)];
  const mergeAt = new Map<string, (typeof sheet.merges)[number]>(), covered = new Set<string>();
  for (const m of sheet.merges) { mergeAt.set(m.r1 + "," + m.c1, m); for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(r + "," + c); }
  const maxRow = Math.max(sheet.maxRow, 1), maxCol = Math.max(sheet.maxCol, 1);
  const colPx = (c: number) => sheet.cols.get(c)?.px ?? sheet.defaultCol, rowPx = (r: number) => sheet.rows.get(r)?.px ?? sheet.defaultRow;
  const columns = Array.from({ length: maxCol }, (_, i) => i + 1).filter((c) => !sheet.cols.get(c)?.hidden);
  const frozenTop = (r: number) => 22 + Array.from({ length: r - 1 }, (_, i) => i + 1).reduce((a, k) => a + (sheet.rows.get(k)?.hidden ? 0 : rowPx(k)), 0);
  const skipped = new Set<string>();
  return <div className="op-xlsx">
    <div className="op-scroll"><table className="op-grid" style={{ width: 40 + columns.reduce((a, c) => a + colPx(c), 0) }}>
      <colgroup><col style={{ width: 40 }} />{columns.map((c) => <col key={c} style={{ width: colPx(c) }} />)}</colgroup>
      <thead><tr><th className="op-corner" />{columns.map((c) => <th key={c}>{letterOf(c)}</th>)}</tr></thead>
      <tbody>{Array.from({ length: maxRow }, (_, i) => i + 1).filter((r) => !sheet.rows.get(r)?.hidden).map((r) => {
        const row = sheet.cells.get(r), sticky = r <= sheet.frozen;
        return <tr key={r} style={{ height: rowPx(r) }}><th className="op-rowhead" style={sticky ? { position: "sticky", top: frozenTop(r), zIndex: 2 } : undefined}>{r}</th>{columns.map((c) => {
          const key = r + "," + c;
          if (covered.has(key) || skipped.has(key)) return null;
          const cell = row?.get(c), merge = mergeAt.get(key);
          let span = merge ? columns.filter((k) => k >= merge.c1 && k <= merge.c2).length : cell?.span ?? 1;
          if (!merge) for (let k = 1; k < span; k++) skipped.add(r + "," + (c + k));
          const isNumber = typeof cell?.value === "number" || typeof cell?.value === "boolean" || isError(cell?.value);
          const style = cell ? cellStyle(cell.style, isNumber) : undefined;
          const hit = cell && changed.has(sheet.part + ":" + cell.index);
          const text = cell?.text ?? "";
          return <td key={c} colSpan={span > 1 ? span : undefined} rowSpan={merge && merge.r2 > merge.r1 ? merge.r2 - merge.r1 + 1 : undefined}
            className={(hit ? "fp-changed " : "") + (cell?.formula ? "op-formula " : "") + (isError(cell?.value) ? "op-error" : "")}
            style={{ ...style, ...(sticky ? { position: "sticky", top: frozenTop(r), zIndex: 1, background: style?.background || "var(--op-paper, #fff)" } : {}) }} title={cell?.formula ? text : undefined}>{text}</td>;
        })}</tr>;
      })}</tbody>
    </table></div>
    {sheet.truncated && <p className="op-note">Showing the first {MAX_ROWS.toLocaleString()} rows and {MAX_COLS} columns.</p>}
    {sheet.charts.length > 0 && <div className="op-charts">{sheet.charts.map((chart, i) => <figure key={i}><ChartSvg model={chart} width={480} height={300} /></figure>)}</div>}
    {model.sheets.length > 1 && <div className="op-tabs" role="tablist">{model.sheets.map((s, i) => <button key={s.part} role="tab" aria-selected={i === active} className={i === active ? "on" : undefined} onClick={() => setActive(i)}>{s.name}</button>)}</div>}
  </div>;
}
