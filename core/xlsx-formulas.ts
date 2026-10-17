import { formatNumber } from "./numfmt.ts";

/**
 * Excel formulas, calculated: the values a workbook shows when its file carries none (Mowr's own workbooks leave Excel to
 * calculate on open, and an upload may have been written by a tool that did not). Arithmetic, comparison, & and %, cell and
 * range references (also across sheets, absolute or not) and the functions people use every day; anything else is reported
 * as #NAME? so the viewer can fall back to the saved result or show the formula.
 */
export type ErrorValue = { error: string };
export type Value = number | string | boolean | null | ErrorValue;
export const isError = (v: unknown): v is ErrorValue => typeof v === "object" && v !== null && "error" in v;
const err = (error: string): ErrorValue => ({ error });

export type Cell = { value?: Value; formula?: string };
/** Cells by sheet name (case-insensitive), then "row,col" with both 1-based. */
export type Grid = Map<string, Map<string, Cell>>;
export const cellKey = (row: number, col: number) => row + "," + col;
export const colNumber = (letters: string) => letters.toUpperCase().split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

type Node =
  | { t: "num"; v: number } | { t: "str"; v: string } | { t: "bool"; v: boolean } | { t: "err"; v: string }
  | { t: "ref"; sheet?: string; r1: number; c1: number; r2: number; c2: number }
  | { t: "un"; op: string; a: Node } | { t: "pct"; a: Node } | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "fn"; name: string; args: Node[] } | { t: "name"; name: string };

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|"((?:[^"]|"")*)"|(#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!))|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?(?![\w(])|([A-Za-z_][\w.]*)(\()?|(<=|>=|<>|[-+*\/^&=<>(),%:]))/y;
function tokenize(text: string) {
  const tokens: { type: string; value: string; sheet?: string; end?: string }[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (!text.slice(TOKEN.lastIndex).trim()) break;
    const m = TOKEN.exec(text);
    if (!m) throw Error("bad token");
    if (m[1] !== undefined) tokens.push({ type: "num", value: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: "str", value: m[2].replace(/""/g, '"') });
    else if (m[3]) tokens.push({ type: "err", value: m[3] });
    else if (m[5]) tokens.push({ type: "ref", value: m[5], sheet: m[4]?.slice(0, -1).replace(/^'|'$/g, "").replace(/''/g, "'"), end: m[6] });
    else if (m[7]) tokens.push(m[8] ? { type: "fn", value: m[7].toUpperCase() } : /^(true|false)$/i.test(m[7]) ? { type: "bool", value: m[7].toUpperCase() } : { type: "name", value: m[7] });
    else tokens.push({ type: "op", value: m[9] });
  }
  return tokens;
}
const cellRef = (ref: string) => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref)!; return { c: colNumber(m[1]), r: Number(m[2]) }; };

/** A formula's syntax tree. Throws when the formula cannot be read. */
export function parseFormula(source: string): Node {
  const tokens = tokenize(source.replace(/^=/, ""));
  let at = 0;
  const peek = () => tokens[at], take = () => tokens[at++];
  const isOp = (v: string) => peek()?.type === "op" && peek().value === v;
  const level = (ops: string[], next: () => Node): Node => {
    let left = next();
    while (peek()?.type === "op" && ops.includes(peek().value)) { const op = take().value; left = { t: "bin", op, a: left, b: next() }; }
    return left;
  };
  const primary = (): Node => {
    const tok = take();
    if (!tok) throw Error("unexpected end");
    if (tok.type === "num") return { t: "num", v: Number(tok.value) };
    if (tok.type === "str") return { t: "str", v: tok.value };
    if (tok.type === "bool") return { t: "bool", v: tok.value === "TRUE" };
    if (tok.type === "err") return { t: "err", v: tok.value };
    if (tok.type === "ref") {
      const a = cellRef(tok.value), b = tok.end ? cellRef(tok.end) : a;
      return { t: "ref", sheet: tok.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
    }
    if (tok.type === "fn") {
      // The "(" is part of the function token.
      const args: Node[] = [];
      if (!isOp(")")) for (;;) { args.push(isOp(",") || isOp(")") ? { t: "str", v: "" } : expression()); if (isOp(",")) { take(); continue; } break; }
      if (!isOp(")")) throw Error("missing )");
      take();
      return { t: "fn", name: tok.value, args };
    }
    if (tok.type === "name") return { t: "name", name: tok.value };
    if (tok.value === "(") { const inner = expression(); if (!isOp(")")) throw Error("missing )"); take(); return inner; }
    throw Error("unexpected " + tok.value);
  };
  const postfix = (): Node => { let n = primary(); while (isOp("%")) { take(); n = { t: "pct", a: n }; } return n; };
  // Excel binds a leading minus tighter than ^ (-2^2 is 4).
  const unary = (): Node => (isOp("-") || isOp("+") ? { t: "un", op: take().value, a: unary() } : postfix());
  const power = (): Node => level(["^"], unary);
  const product = (): Node => level(["*", "/"], power);
  const sum = (): Node => level(["+", "-"], product);
  const concat = (): Node => level(["&"], sum);
  const expression = (): Node => level(["=", "<>", "<", ">", "<=", ">="], concat);
  const tree = expression();
  if (at < tokens.length) throw Error("unexpected " + peek().value);
  return tree;
}

const num = (v: Value): number | ErrorValue => {
  if (isError(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).trim().replace(/%$/, ""));
  return Number.isFinite(n) && String(v).trim() !== "" ? (/%$/.test(String(v).trim()) ? n / 100 : n) : err("#VALUE!");
};
const text = (v: Value): string => (isError(v) ? v.error : v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? formatNumber(v) : v);
const truth = (v: Value): boolean | ErrorValue => { if (isError(v)) return v; if (typeof v === "string") { if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; const n = num(v); return isError(n) ? n : n !== 0; } const n = num(v); return isError(n) ? n : n !== 0; };
const rank = (v: Value) => (typeof v === "number" ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 3 : 0);
function compare(a: Value, b: Value) {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string") return a.toLowerCase() < (b as string).toLowerCase() ? -1 : a.toLowerCase() > (b as string).toLowerCase() ? 1 : 0;
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}
/** The test a SUMIF/COUNTIF criterion makes: a value, or an operator and a value (">5", "<>x", "a*"). */
function criterion(c: Value): (v: Value) => boolean {
  const s = typeof c === "string" ? c : null;
  const m = s ? /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)! : null;
  const op = m?.[1] || "=", raw = m ? m[2] : c;
  const target: Value = typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : (raw as Value);
  // "" and "<>" ask whether a cell is blank, and an empty cell counts as blank.
  if (target === "" && (op === "=" || op === "<>")) return (v) => (v === null || v === "") === (op === "=");
  return (v) => {
    if (typeof target === "string" && /[*?]/.test(target) && (op === "=" || op === "<>")) { const hit = new RegExp("^" + target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i").test(text(v)); return op === "=" ? hit : !hit; }
    if (op !== "=" && op !== "<>" && rank(v) !== rank(target)) return false;
    const d = compare(v, target);
    return op === "=" ? d === 0 && rank(v) === rank(target) : op === "<>" ? d !== 0 || rank(v) !== rank(target) : op === "<" ? d < 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : d >= 0;
  };
}

type Range = { range: Value[][] };
const isRange = (v: unknown): v is Range => typeof v === "object" && v !== null && "range" in v;

/** A workbook's cells with their formulas calculated on demand. */
export class Calculator {
  private done = new Map<string, Value>();
  private active = new Set<string>();
  private sheets = new Map<string, string>();
  private grid: Grid;
  private stored: boolean;
  /** `stored`: a formula cell the file saved a result for shows that result, as Excel would, instead of being worked out again. */
  constructor(grid: Grid, { stored = false } = {}) { this.grid = grid; this.stored = stored; for (const name of grid.keys()) this.sheets.set(name.toLowerCase(), name); }
  /** The value of one cell: its formula's result, or the value the file stores. */
  value(sheet: string, row: number, col: number): Value {
    const name = this.sheets.get(sheet.toLowerCase());
    const cell = name ? this.grid.get(name)?.get(cellKey(row, col)) : undefined;
    if (!cell) return null;
    if (cell.formula === undefined || (this.stored && cell.value !== undefined && cell.value !== null)) return cell.value ?? null;
    const key = name + "!" + row + "," + col;
    if (this.done.has(key)) return this.done.get(key)!;
    if (this.active.has(key)) return err("#REF!");
    this.active.add(key);
    let result: Value;
    try { const out = this.run(parseFormula(cell.formula), name!); result = isRange(out) ? out.range[0]?.[0] ?? null : out; }
    catch { result = err("#NAME?"); }
    this.active.delete(key);
    // A function the viewer does not know keeps whatever the file saved for it.
    if (isError(result) && result.error === "#NAME?" && cell.value !== undefined && cell.value !== null) result = cell.value;
    this.done.set(key, result);
    return result;
  }
  private rangeOf(n: Extract<Node, { t: "ref" }>, sheet: string): Range {
    const name = n.sheet ? this.sheets.get(n.sheet.toLowerCase()) : sheet;
    if (!name) return { range: [[err("#REF!")]] };
    const rows: Value[][] = [];
    for (let r = n.r1; r <= Math.min(n.r2, n.r1 + 100000); r++) { const row: Value[] = []; for (let c = n.c1; c <= Math.min(n.c2, n.c1 + 1000); c++) row.push(this.value(name, r, c)); rows.push(row); }
    return { range: rows };
  }
  private scalar(n: Node, sheet: string): Value {
    const v = this.run(n, sheet);
    return isRange(v) ? v.range[0]?.[0] ?? null : v;
  }
  /** The numbers in arguments: ranges contribute only their numbers, direct arguments are converted. */
  private numbers(args: Node[], sheet: string) {
    const out: number[] = [];
    for (const a of args) {
      const v = this.run(a, sheet);
      if (isRange(v)) { for (const row of v.range) for (const x of row) { if (isError(x)) return x; if (typeof x === "number") out.push(x); } }
      else { const n = num(v); if (isError(n)) return n; out.push(n); }
    }
    return out;
  }
  private run(n: Node, sheet: string): Value | Range {
    switch (n.t) {
      case "num": case "str": case "bool": return n.v;
      case "err": return err(n.v);
      case "name": return err("#NAME?");
      case "ref": return n.r1 === n.r2 && n.c1 === n.c2 && !n.sheet ? this.value(sheet, n.r1, n.c1) : n.r1 === n.r2 && n.c1 === n.c2 ? this.rangeOf(n, sheet).range[0][0] : this.rangeOf(n, sheet);
      case "pct": { const a = num(this.scalar(n.a, sheet)); return isError(a) ? a : a / 100; }
      case "un": { const a = num(this.scalar(n.a, sheet)); return isError(a) ? a : n.op === "-" ? -a : a; }
      case "bin": {
        const a = this.scalar(n.a, sheet), b = this.scalar(n.b, sheet);
        if (isError(a)) return a;
        if (isError(b)) return b;
        if (n.op === "&") return text(a) + text(b);
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) { const d = compare(a, b); return n.op === "=" ? d === 0 : n.op === "<>" ? d !== 0 : n.op === "<" ? d < 0 : n.op === ">" ? d > 0 : n.op === "<=" ? d <= 0 : d >= 0; }
        const x = num(a), y = num(b);
        if (isError(x)) return x;
        if (isError(y)) return y;
        if (n.op === "+") return x + y;
        if (n.op === "-") return x - y;
        if (n.op === "*") return x * y;
        if (n.op === "/") return y === 0 ? err("#DIV/0!") : x / y;
        const p = x ** y;
        return Number.isFinite(p) ? p : err("#NUM!");
      }
      case "fn": return this.call(n.name, n.args, sheet);
    }
  }
  private call(name: string, args: Node[], sheet: string): Value | Range {
    const arg = (i: number) => this.scalar(args[i], sheet);
    const rangeArg = (i: number): Value[][] => { const v = this.run(args[i], sheet); return isRange(v) ? v.range : [[v]]; };
    const numberArg = (i: number, fallback?: number) => (args[i] === undefined ? fallback! : num(arg(i)));
    const flat = (i: number) => rangeArg(i).flat();
    const math = (f: (x: number) => number) => { const x = numberArg(0); return isError(x) ? x : (() => { const r = f(x); return Number.isFinite(r) ? r : err("#NUM!"); })(); };
    switch (name) {
      case "SUM": case "AVERAGE": case "MIN": case "MAX": case "PRODUCT": case "MEDIAN": {
        const xs = this.numbers(args, sheet);
        if (isError(xs)) return xs;
        if (name === "SUM") return xs.reduce((a, b) => a + b, 0);
        if (name === "PRODUCT") return xs.length ? xs.reduce((a, b) => a * b, 1) : 0;
        if (!xs.length) return name === "AVERAGE" || name === "MEDIAN" ? err("#DIV/0!") : 0;
        if (name === "AVERAGE") return xs.reduce((a, b) => a + b, 0) / xs.length;
        if (name === "MIN") return Math.min(...xs);
        if (name === "MAX") return Math.max(...xs);
        const sorted = [...xs].sort((a, b) => a - b), mid = sorted.length >> 1;
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      case "COUNT": { let c = 0; for (const a of args) { const v = this.run(a, sheet); if (isRange(v)) c += v.range.flat().filter((x) => typeof x === "number").length; else if (!isError(num(v as Value))) c++; } return c; }
      case "COUNTA": return args.reduce((c, a) => { const v = this.run(a, sheet); return c + (isRange(v) ? v.range.flat().filter((x) => x !== null && x !== "").length : v !== null && v !== "" ? 1 : 0); }, 0);
      case "COUNTBLANK": return flat(0).filter((x) => x === null || x === "").length;
      case "ABS": return math(Math.abs);
      case "SQRT": return math(Math.sqrt);
      case "EXP": return math(Math.exp);
      case "LN": return math(Math.log);
      case "LOG10": return math(Math.log10);
      case "INT": return math(Math.floor);
      case "SIGN": return math(Math.sign);
      case "SIN": return math(Math.sin);
      case "COS": return math(Math.cos);
      case "TAN": return math(Math.tan);
      case "PI": return Math.PI;
      case "POWER": { const a = numberArg(0), b = numberArg(1); return isError(a) ? a : isError(b) ? b : a ** b; }
      case "MOD": { const a = numberArg(0), b = numberArg(1); return isError(a) ? a : isError(b) ? b : b === 0 ? err("#DIV/0!") : a - b * Math.floor(a / b); }
      case "ROUND": case "ROUNDUP": case "ROUNDDOWN": {
        const x = numberArg(0), d = numberArg(1, 0);
        if (isError(x)) return x;
        if (isError(d)) return d;
        // Rounded to 15 significant digits first, as Excel does, so 2.675 rounds up but 0.9999999999 is not pushed to 1.
        const k = 10 ** d, scaled = Number((Math.abs(x) * k).toPrecision(15)), r = name === "ROUND" ? Math.round(scaled) : name === "ROUNDUP" ? Math.ceil(scaled) : Math.floor(scaled);
        return (Math.sign(x) * r) / k;
      }
      case "IF": { const c = truth(arg(0)); if (isError(c)) return c; return c ? (args[1] ? this.run(args[1], sheet) : true) : args[2] ? this.run(args[2], sheet) : false; }
      case "IFERROR": { const v = arg(0); return isError(v) ? this.scalar(args[1], sheet) : v; }
      case "AND": case "OR": { const bs = args.flatMap((a) => { const v = this.run(a, sheet); return (isRange(v) ? v.range.flat() : [v]).filter((x) => x !== null && x !== ""); }).map(truth); const bad = bs.find(isError); if (bad) return bad as ErrorValue; return name === "AND" ? bs.every(Boolean) : bs.some(Boolean); }
      case "NOT": { const b = truth(arg(0)); return isError(b) ? b : !b; }
      case "CONCAT": case "CONCATENATE": return args.map((a) => { const v = this.run(a, sheet); return isRange(v) ? v.range.flat().map(text).join("") : text(v); }).join("");
      case "LEN": return text(arg(0)).length;
      case "UPPER": return text(arg(0)).toUpperCase();
      case "LOWER": return text(arg(0)).toLowerCase();
      case "TRIM": return text(arg(0)).trim().replace(/\s+/g, " ");
      case "LEFT": { const n = numberArg(1, 1); return isError(n) ? n : text(arg(0)).slice(0, n); }
      case "RIGHT": { const n = numberArg(1, 1); return isError(n) ? n : n ? text(arg(0)).slice(-n) : ""; }
      case "MID": { const s = numberArg(1), n = numberArg(2); return isError(s) ? s : isError(n) ? n : text(arg(0)).slice(s - 1, s - 1 + n); }
      case "TEXT": { const x = num(arg(0)); return isError(x) ? text(arg(0)) : formatNumber(x, text(arg(1))); }
      case "VALUE": return num(arg(0));
      case "SUMIF": case "COUNTIF": case "AVERAGEIF": {
        const test = criterion(arg(1)), keys = flat(0), values = name === "COUNTIF" ? keys : args[2] ? flat(2) : keys;
        const hits = keys.map((k, i) => (test(k) ? values[i] : undefined)).filter((v) => v !== undefined);
        if (name === "COUNTIF") return hits.length;
        const nums = hits.filter((v): v is number => typeof v === "number");
        return name === "SUMIF" ? nums.reduce((a, b) => a + b, 0) : nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : err("#DIV/0!");
      }
      case "VLOOKUP": case "HLOOKUP": {
        const key = arg(0), table = rangeArg(1), index = numberArg(2), approximate = args[3] ? truth(arg(3)) : true;
        if (isError(index)) return index;
        const lines = name === "VLOOKUP" ? table : table[0].map((_, c) => table.map((r) => r[c]));
        let found = -1;
        lines.forEach((line, i) => { const d = compare(line[0], key); if (approximate === true ? d <= 0 && rank(line[0]) === rank(key) : d === 0 && rank(line[0]) === rank(key)) { if (approximate === true || found < 0) found = i; } });
        return found < 0 ? err("#N/A") : lines[found][index - 1] ?? err("#REF!");
      }
      case "INDEX": {
        const t = rangeArg(0), r = numberArg(1, 1), c = numberArg(2, 1);
        if (isError(r)) return r;
        if (isError(c)) return c;
        // A single row is indexed by its one number, as a column is: INDEX(A1:E1,3) is C1.
        const [row, col] = t.length === 1 && args[2] === undefined ? [1, r] : [r, c];
        return t[(row || 1) - 1]?.[(col || 1) - 1] ?? err("#REF!");
      }
      case "MATCH": {
        // Match type 1 (the default): the last value at or below the key, as in sorted data; -1 the last at or above; 0 exact.
        const key = arg(0), values = flat(1), type = numberArg(2, 1);
        if (isError(type)) return type;
        let i = -1;
        values.forEach((v, j) => { if (rank(v) !== rank(key)) return; const d = compare(v, key); if (type > 0 ? d <= 0 : type < 0 ? d >= 0 : d === 0 && i < 0) i = j; });
        return i < 0 ? err("#N/A") : i + 1;
      }
      case "ISBLANK": return arg(0) === null;
      case "ISNUMBER": return typeof arg(0) === "number";
      case "ISTEXT": return typeof arg(0) === "string";
      case "ISERROR": return isError(arg(0));
      case "DATE": { const y = numberArg(0), m = numberArg(1), d = numberArg(2); return isError(y) ? y : isError(m) ? m : isError(d) ? d : Date.UTC(y, m - 1, d) / 86400000 + 25569; }
      case "YEAR": case "MONTH": case "DAY": { const x = numberArg(0); if (isError(x)) return x; const dt = new Date(Math.round((x - 25569) * 86400000)); return name === "YEAR" ? dt.getUTCFullYear() : name === "MONTH" ? dt.getUTCMonth() + 1 : dt.getUTCDate(); }
      default: return err("#NAME?");
    }
  }
}

/** The text of a calculated value as a cell shows it, using the cell's number format. */
export function showValue(value: Value, format = "General", date1904 = false): string {
  if (isError(value)) return value.error;
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatNumber(value, format, date1904);
  return value;
}
