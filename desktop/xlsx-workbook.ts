import { zipSync, strToU8 } from "fflate";
import { Calculator, cellKey, isError, type Grid, type Value } from "../core/xlsx-formulas.ts";

/**
 * Excel workbooks written directly as Office Open XML: typed cells, live formulas, number formats, a styled header,
 * banded rows, frozen header, filters, totals and native Excel charts. The workbook asks Excel to calculate
 * on open, so every number the person sees in Excel is Excel's own.
 *
 * Each formula also carries its calculated value (core/xlsx-formulas.ts), so a viewer that does not calculate (Mowr's own file
 * panel, Quick Look, a program reading the text) shows numbers, not "=B4-C4"; Excel still recalculates everything on open.
 *
 * Formulas may use {row} (this row), {first} and {last} (the first and last data rows) so a model does not have
 * to count rows: "=B{row}*C{row}", "=SUM(D{first}:D{last})". Columns can also be named: [Price]{row}.
 */
export type Column = { header: string; width?: number; format?: string };
export type Sheet = {
  name: string;
  title?: string;
  columns: Column[];
  rows: (string | number | boolean | null)[][];
  totals?: { label?: string; columns: Record<string, "sum" | "average" | "min" | "max" | "count"> };
  freeze?: boolean;
  filter?: boolean;
  notes?: string[];
  charts?: { type: "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter"; title?: string; categories: string; series: string[]; stacked?: boolean }[];
};
export type WorkbookSpec = { title?: string; theme?: { accent?: string; font?: string }; sheets: Sheet[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const col = (n: number) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const sheetRef = (name: string) => "'" + name.replace(/'/g, "''") + "'";
const formats: Record<string, string> = {
  integer: "#,##0", number: "#,##0.00", decimal: "#,##0.00", percent: "0.0%", currency: '"$"#,##0.00', usd: '"$"#,##0.00', eur: '[$€-x-euro2] #,##0.00', gbp: '"£"#,##0.00', date: "yyyy-mm-dd", datetime: "yyyy-mm-dd hh:mm", time: "hh:mm", text: "@",
};
const fontOk = (v: unknown) => typeof v === "string" && /^[\p{L}\p{N} -]{2,48}$/u.test(v) && !/mowafy|\bmowr\b|kindred/i.test(v);

export function workbookProblems(spec: any): string[] {
  const problems: string[] = [];
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length) return ['A workbook needs "sheets": [{"name","columns":[{"header"}],"rows":[[…]]}].'];
  if (spec.sheets.length > 40) problems.push("A workbook holds at most 40 sheets here.");
  const names = new Set<string>();
  spec.sheets.forEach((s: any, i: number) => {
    const at = `Sheet ${i + 1}`;
    // Excel also repairs a file whose sheet name starts or ends with an apostrophe, or is its reserved "History".
    if (typeof s?.name !== "string" || !s.name.trim() || s.name.length > 31 || /[\\/?*[\]:]/.test(s.name) || /^'|'$/.test(s.name) || s.name.toLowerCase() === "history") problems.push(`${at}: "name" must be 1–31 characters without \\ / ? * [ ] :, not start or end with ', and not be "History".`);
    else if (names.has(s.name.toLowerCase())) problems.push(`${at}: the name "${s.name}" is used twice.`);
    else names.add(s.name.toLowerCase());
    if (!Array.isArray(s?.columns) || !s.columns.length || s.columns.some((c: any) => typeof c?.header !== "string")) problems.push(`${at}: "columns" must be [{"header":…}, …].`);
    if (!Array.isArray(s?.rows) || s.rows.some((r: any) => !Array.isArray(r))) problems.push(`${at}: "rows" must be a list of rows (lists of values).`);
    else if (s.rows.length > 100_000) problems.push(`${at}: at most 100,000 rows.`);
    if (s?.totals && (typeof s.totals.columns !== "object" || !s.totals.columns || Array.isArray(s.totals.columns))) problems.push(`${at}: "totals" must be {"label"?, "columns": {"<header>": "sum" | "average" | "min" | "max" | "count"}}.`);
    for (const c of s?.columns || []) if (c?.format && !formats[String(c.format).toLowerCase()] && !/^[#0.,%$€£¥"\[\]\-\s:;@a-zA-Z/\\()]+$/.test(c.format)) problems.push(`${at}: unknown format "${c.format}". Use ${Object.keys(formats).join(", ")} or an Excel format code.`);
    for (const chart of s?.charts || []) {
      if (!["column", "bar", "line", "area", "pie", "doughnut", "scatter"].includes(chart?.type)) problems.push(`${at}: chart "type" must be column, bar, line, area, pie, doughnut or scatter.`);
      const headers = (s.columns || []).map((c: any) => c?.header);
      if (!headers.includes(chart?.categories)) problems.push(`${at}: chart "categories" must be a column header (${headers.join(", ")}).`);
      if (!Array.isArray(chart?.series) || !chart.series.length || chart.series.some((x: any) => !headers.includes(x))) problems.push(`${at}: chart "series" must be column headers.`);
    }
  });
  return problems;
}

/** Turns {row}, {first}, {last} and [Header] references into A1 references. */
export function resolveFormula(formula: string, row: number, first: number, last: number, headers: string[]) {
  return formula
    .replace(/\[([^\]]+)\](?=\{|\d)/g, (whole, name: string) => { const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase()); return i < 0 ? whole : col(i); })
    .replace(/\{row\}/g, String(row)).replace(/\{first\}/g, String(first)).replace(/\{last\}/g, String(last));
}
/** Days since 1899-12-30, Excel's date serial, for ISO dates. */
const serial = (iso: string) => { const t = Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z")); return Number.isFinite(t) ? t / 86_400_000 + 25569 : null; };

export function excelWorkbook(spec: WorkbookSpec): Uint8Array {
  const problems = workbookProblems(spec);
  if (problems.length) throw Error(problems.join(" ") + " No workbook was created. Fix these and send the xlsx action again.");
  const accent = /^#?[0-9a-f]{6}$/i.test(spec.theme?.accent || "") ? spec.theme!.accent!.replace("#", "").toUpperCase() : "1F4E79";
  const font = fontOk(spec.theme?.font) ? spec.theme!.font! : "Calibri";

  // Styles: a small registry so each distinct (format, role) pair gets one cellXfs entry.
  const numFmts: string[] = [];
  const fmtId = (code?: string) => { if (!code) return 0; const builtin: Record<string, number> = { "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "@": 49 }; if (builtin[code] !== undefined) return builtin[code]; let i = numFmts.indexOf(code); if (i < 0) { numFmts.push(code); i = numFmts.length - 1; } return 164 + i; };
  // fonts: 0 normal, 1 bold white (header), 2 bold (totals), 3 title, 4 note; fills: 0 none, 1 gray125, 2 accent, 3 band; borders: 0 none, 1 thin bottom, 2 double top
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIndex = new Map<string, number>();
  const style = (role: "body" | "band" | "header" | "total" | "title" | "note", code?: string) => {
    const key = role + "|" + (code || "");
    let i = xfIndex.get(key);
    if (i !== undefined) return i;
    const f = { body: 0, band: 0, header: 1, total: 2, title: 3, note: 4 }[role], fill = { body: 0, band: 3, header: 2, total: 0, title: 0, note: 0 }[role], border = { body: 0, band: 0, header: 0, total: 2, title: 0, note: 0 }[role];
    const id = fmtId(code);
    const align = role === "header" ? '<alignment vertical="center" wrapText="1"/>' : role === "note" ? '<alignment wrapText="0"/>' : "";
    xfs.push(`<xf numFmtId="${id}" fontId="${f}" fillId="${fill}" borderId="${border}" xfId="0"${id ? ' applyNumberFormat="1"' : ""}${f ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`);
    i = xfs.length - 1;
    xfIndex.set(key, i);
    return i;
  };

  // Every cell's value or formula, so each formula can be written with its result.
  const grid: Grid = new Map();
  for (const sheet of spec.sheets) {
    const headers = sheet.columns.map((c) => c.header), headerRow = sheet.title ? 3 : 1, first = headerRow + 1, last = headerRow + Math.max(1, sheet.rows.length);
    const cells = new Map<string, { value?: Value; formula?: string }>();
    // A title or header is always its text as written ("=Total", "2024-01"), never a formula or a date.
    const put = (r: number, c: number, v: unknown, literal = false) => {
      if (v === null || v === undefined || v === "") return;
      if (literal) { cells.set(cellKey(r, c + 1), { value: String(v) }); return; }
      if (typeof v === "string" && v.startsWith("=") && v.length > 1) { cells.set(cellKey(r, c + 1), { formula: resolveFormula(v.slice(1), r, first, last, headers) }); return; }
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(v) && serial(v) !== null) { cells.set(cellKey(r, c + 1), { value: serial(v) }); return; }
      cells.set(cellKey(r, c + 1), { value: v as Value });
    };
    if (sheet.title) put(1, 0, sheet.title, true);
    headers.forEach((h, c) => put(headerRow, c, h, true));
    sheet.rows.forEach((row, k) => sheet.columns.forEach((_, c) => put(first + k, c, row[c])));
    if (sheet.totals) {
      const fn = { sum: "SUM", average: "AVERAGE", min: "MIN", max: "MAX", count: "COUNTA" } as const;
      sheet.columns.forEach((c, i) => { const how = sheet.totals!.columns[c.header]; if (how && fn[how]) put(last + 1, i, `=${fn[how]}(${col(i)}${first}:${col(i)}${last})`); });
    }
    grid.set(sheet.name, cells);
  }
  const cellOrder = (key: string) => { const [r, c] = key.split(",").map(Number); return r * 16384 + c; };
  const calc = new Calculator(grid);
  // Calculated top to bottom, sheet by sheet, so a long chain (a running balance over thousands of rows) is
  // worked out one step at a time from cached rows instead of in one deep recursion.
  for (const [name, cells] of grid)
    for (const key of [...cells.keys()].filter((k) => cells.get(k)!.formula !== undefined).sort((a, b) => cellOrder(a) - cellOrder(b))) {
      const [r, c] = key.split(",").map(Number);
      calc.value(name, r, c);
    }
  /** The `<v>` (and type) a formula cell is written with, from its calculated result. */
  const result = (sheetName: string, ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    const v = calc.value(sheetName, Number(m[2]), c);
    // Nothing to show, or a function the viewer does not know (#NAME?): no saved value, so no reader shows a false error.
    if (v === null || (isError(v) && v.error === "#NAME?")) return { type: "", xml: "" };
    if (isError(v)) return { type: ' t="e"', xml: `<v>${esc(v.error)}</v>` };
    if (typeof v === "boolean") return { type: ' t="b"', xml: `<v>${v ? 1 : 0}</v>` };
    if (typeof v === "number") return Number.isFinite(v) ? { type: "", xml: `<v>${v}</v>` } : { type: ' t="e"', xml: "<v>#NUM!</v>" };
    return { type: ' t="str"', xml: `<v>${esc(v)}</v>` };
  };

  const files: Record<string, Uint8Array> = {};
  const sheetEntries: string[] = [], rels: string[] = [], overrides: string[] = [], defined: string[] = [];
  let chartNo = 0;
  spec.sheets.forEach((sheet, s) => {
    const headers = sheet.columns.map((c) => c.header);
    const codes = sheet.columns.map((c) => (c.format ? formats[c.format.toLowerCase()] ?? c.format : undefined));
    const headerRow = sheet.title ? 3 : 1, first = headerRow + 1, last = headerRow + Math.max(1, sheet.rows.length);
    const rowsXml: string[] = [];
    const cell = (ref: string, value: unknown, xf: number, r: number, literal = false) => {
      if (value === null || value === undefined || value === "") return xf ? `<c r="${ref}" s="${xf}"/>` : "";
      if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="${xf}"><v>${value}</v></c>` : `<c r="${ref}" s="${xf}" t="e"><v>#NUM!</v></c>`;
      if (typeof value === "boolean") return `<c r="${ref}" s="${xf}" t="b"><v>${value ? 1 : 0}</v></c>`;
      const text = String(value);
      if (!literal && text.startsWith("=") && text.length > 1) { const shown = result(sheet.name, ref); return `<c r="${ref}" s="${xf}"${shown.type}><f>${esc(resolveFormula(text.slice(1), r, first, last, headers))}</f>${shown.xml}</c>`; }
      return `<c r="${ref}" s="${xf}" t="inlineStr"><is><t xml:space="preserve">${esc(text.slice(0, 32767))}</t></is></c>`;
    };
    if (sheet.title) rowsXml.push(`<row r="1" ht="24" customHeight="1">${cell("A1", sheet.title, style("title"), 1, true)}</row>`);
    rowsXml.push(`<row r="${headerRow}" ht="22" customHeight="1">${headers.map((h, c) => cell(col(c) + headerRow, h, style("header"), headerRow, true)).join("")}</row>`);
    sheet.rows.forEach((row, k) => {
      const r = first + k;
      rowsXml.push(`<row r="${r}">${sheet.columns.map((_, c) => {
        let value = row[c] as unknown;
        let code = codes[c];
        // ISO dates become real dates in date-formatted (or unformatted) columns.
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(value) && (!code || /y|d/.test(code))) { const n = serial(value); if (n !== null) { value = n; code = code || ((value as number) % 1 ? formats.datetime : formats.date); } }
        return cell(col(c) + r, value, style(k % 2 ? "band" : "body", code), r);
      }).join("")}</row>`);
    });
    let end = last;
    if (sheet.totals) {
      end = last + 1;
      const fn = { sum: "SUM", average: "AVERAGE", min: "MIN", max: "MAX", count: "COUNTA" } as const;
      rowsXml.push(`<row r="${end}">${sheet.columns.map((c, i) => {
        const how = sheet.totals!.columns[c.header];
        if (how && fn[how]) return cell(col(i) + end, `=${fn[how]}(${col(i)}${first}:${col(i)}${last})`, style("total", codes[i]), end);
        return cell(col(i) + end, i === 0 ? sheet.totals!.label || "Total" : "", style("total", codes[i]), end);
      }).join("")}</row>`);
    }
    (sheet.notes || []).forEach((note, k) => rowsXml.push(`<row r="${end + 2 + k}">${cell("A" + (end + 2 + k), note, style("note"), end + 2 + k)}</row>`));

    // Widths from the header and the longest values, unless given.
    // Numbers are measured as formatted (separators, decimals, currency) and with room for a totals row.
    const widths = sheet.columns.map((c, i) => {
      if (c.width) return c.width;
      const numbers = sheet.rows.map((r) => r[i]).filter((v): v is number => typeof v === "number");
      const biggest = numbers.length ? Math.max(...numbers.map(Math.abs)) * (sheet.totals?.columns[c.header] ? numbers.length : 1) : 0;
      const numeric = numbers.length ? Math.round(biggest).toLocaleString("en-US").length + (codes[i] && /0\.0/.test(codes[i]!) ? 4 : 1) + (codes[i] && /[$€£¥]/.test(codes[i]!) ? 2 : 0) + 2 : 0;
      const texts = sheet.rows.slice(0, 500).map((r) => (typeof r[i] === "string" && !String(r[i]).startsWith("=") ? String(r[i]).length + 2 : typeof r[i] === "string" ? 12 : 0));
      return Math.min(60, Math.max(9, c.header.length + 3, numeric, ...texts));
    });
    const lastCol = col(sheet.columns.length - 1);
    const freeze = sheet.freeze !== false ? `<sheetViews><sheetView workbookViewId="0"${s === 0 ? ' tabSelected="1"' : ""}><pane ySplit="${headerRow}" topLeftCell="A${first}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${first}" sqref="A${first}"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"${s === 0 ? ' tabSelected="1"' : ""}/></sheetViews>`;
    const filter = sheet.filter !== false && sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${last}"/>` : "";
    if (filter) defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${s}" hidden="1">${esc(sheetRef(sheet.name))}!$A$${headerRow}:$${lastCol}$${last}</definedName>`);
    const charts = sheet.charts || [];
    const drawing = charts.length ? '<drawing r:id="rId1"/>' : "";
    files[`xl/worksheets/sheet${s + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}<sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rowsXml.join("")}</sheetData>${filter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="${sheet.columns.length > 6 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>${drawing}</worksheet>`);
    sheetEntries.push(`<sheet name="${esc(sheet.name)}" sheetId="${s + 1}" r:id="rId${s + 1}"/>`);
    rels.push(`<Relationship Id="rId${s + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s + 1}.xml"/>`);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${s + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);

    if (charts.length) {
      const anchors: string[] = [], drawingRels: string[] = [];
      charts.forEach((chart, k) => {
        const id = ++chartNo;
        const catCol = col(headers.indexOf(chart.categories));
        const series = chart.series.map((name) => ({ name, col: col(headers.indexOf(name)), headerRow }));
        files[`xl/charts/chart${id}.xml`] = strToU8(chartXml(chart, sheetRef(sheet.name), catCol, series, first, last, accent, font));
        overrides.push(`<Override PartName="/xl/charts/chart${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        const from = sheet.columns.length + 1, top = headerRow - 1 + k * 18;
        anchors.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${from}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${from + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="Chart ${k + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${k + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
        drawingRels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${id}.xml"/>`);
      });
      files[`xl/drawings/drawing${s + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`);
      files[`xl/drawings/_rels/drawing${s + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join("")}</Relationships>`);
      files[`xl/worksheets/_rels/sheet${s + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${s + 1}.xml"/></Relationships>`);
      overrides.push(`<Override PartName="/xl/drawings/drawing${s + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    }
  });

  const band = "F3F6F9";
  files["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>` : ""}<fonts count="5"><font><sz val="11"/><color theme="1"/><name val="${esc(font)}"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="${esc(font)}"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="${esc(font)}"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF${accent}"/><name val="${esc(font)}"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="${esc(font)}"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${accent}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${band}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border><border><left/><right/><top style="double"><color rgb="FF${accent}"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="17000" activeTab="0"/></bookViews><sheets>${sheetEntries.join("")}</sheets>${defined.length ? `<definedNames>${defined.join("")}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}<Relationship Id="rId${spec.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${spec.sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  files["xl/theme/theme1.xml"] = strToU8(themeXml(font));
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(spec.title || spec.sheets[0].name)}</dc:title><dc:creator>Mowr</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Mowr</Application></Properties>`);
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  return zipSync(files, { level: 6 });
}

function chartXml(chart: NonNullable<Sheet["charts"]>[number], sheet: string, catCol: string, series: { name: string; col: string; headerRow: number }[], first: number, last: number, accent: string, font: string) {
  const palette = [accent, "E07A5F", "3D9970", "F2A900", "7B61FF", "5B6676", "13A89E", "C0392B"];
  const range = (c: string) => `${sheet}!$${c}$${first}:$${c}$${last}`;
  const round = chart.type === "pie" || chart.type === "doughnut";
  const scatter = chart.type === "scatter";
  const ser = series.map((s, i) => {
    const color = palette[i % palette.length];
    const shape = chart.type === "line" || scatter ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>` : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
    const points = round ? Array.from({ length: last - first + 1 }, (_, p) => `<c:dPt><c:idx val="${p}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${palette[p % palette.length]}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("") : "";
    const labels = round ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>` : "";
    const cat = scatter ? `<c:xVal><c:numRef><c:f>${range(catCol)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${range(s.col)}</c:f></c:numRef></c:yVal>` : `<c:cat><c:strRef><c:f>${range(catCol)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${range(s.col)}</c:f></c:numRef></c:val>`;
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${sheet}!$${s.col}$${s.headerRow}</c:f></c:strRef></c:tx>${shape}${points}${labels}${cat}${chart.type === "line" || scatter ? '<c:smooth val="0"/>' : ""}</c:ser>`;
  }).join("");
  const axes = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  const text = (sz: number, color = "595959") => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${esc(font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const grid = '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E3E6EA"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const catAx = scatter
    ? `<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${text(900)}<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
    : `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${chart.type === "bar" ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>${text(900)}<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${chart.type === "bar" ? "b" : "l"}"/>${grid}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${text(900)}<c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="${chart.type === "area" ? "midCat" : "between"}"/></c:valAx>`;
  const grouping = chart.stacked ? "stacked" : chart.type === "line" ? "standard" : chart.type === "area" ? "standard" : "clustered";
  const plot =
    chart.type === "column" || chart.type === "bar" ? `<c:barChart><c:barDir val="${chart.type === "bar" ? "bar" : "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}<c:gapWidth val="60"/>${chart.stacked ? '<c:overlap val="100"/>' : ""}${axes}</c:barChart>${catAx}${valAx}`
    : chart.type === "line" ? `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>${catAx}${valAx}`
    : chart.type === "area" ? `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}${axes}</c:areaChart>${catAx}${valAx}`
    : chart.type === "scatter" ? `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}${axes}</c:scatterChart>${catAx}${valAx}`
    : chart.type === "pie" ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`
    : `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  const title = chart.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"><a:solidFill><a:srgbClr val="262626"/></a:solidFill><a:latin typeface="${esc(font)}"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="262626"/></a:solidFill><a:latin typeface="${esc(font)}"/></a:rPr><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = series.length > 1 || round ? `<c:legend><c:legendPos val="${round ? "r" : "b"}"/><c:overlay val="0"/>${text(900, "404040")}</c:legend>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

/** A minimal Office theme, so theme colours and fonts resolve when the workbook opens. */
function themeXml(font: string) {
  const f = esc(font);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Mowr"><a:themeElements><a:clrScheme name="Mowr"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2328"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="1F4E79"/></a:accent1><a:accent2><a:srgbClr val="E07A5F"/></a:accent2><a:accent3><a:srgbClr val="3D9970"/></a:accent3><a:accent4><a:srgbClr val="F2A900"/></a:accent4><a:accent5><a:srgbClr val="7B61FF"/></a:accent5><a:accent6><a:srgbClr val="13A89E"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Mowr"><a:majorFont><a:latin typeface="${f}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${f}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}
