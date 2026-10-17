/**
 * Spreadsheet number formats (Excel format codes) as the text a cell shows: "#,##0.00", "0.0%", '"$"#,##0.00', "yyyy-mm-dd",
 * "[$€-x-euro2] #,##0.00", sections for positive, negative and zero. No locale: separators are "," and ".".
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The built-in format ids Excel stores without a code. */
export const BUILTIN: Record<number, string> = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@" };

/** Splits a code into its ";"-separated sections, outside quotes and brackets. */
function sections(code: string) {
  const out: string[] = [];
  let part = "", quote = false, bracket = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "\\") { part += c + (code[++i] ?? ""); continue; }
    if (c === '"') quote = !quote;
    else if (!quote && c === "[") bracket = true;
    else if (!quote && c === "]") bracket = false;
    if (c === ";" && !quote && !bracket) { out.push(part); part = ""; } else part += c;
  }
  out.push(part);
  return out;
}
/** Whether a code formats dates or times (a "d", "m", "y", "h" or "s" outside quotes, brackets and literals). */
export function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[(?![hms]+\])[^\]]*\]/gi, "").replace(/\\./g, "").replace(/_./g, "");
  return /[dmyhs]/i.test(bare) && !/^\s*(general|@)\s*$/i.test(bare);
}
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
/** An Excel serial (days since 1899-12-30) as a UTC date. */
export const serialDate = (serial: number, date1904 = false) => new Date(Math.round((serial - (date1904 ? 24107 : 25569)) * 86400000));

function formatDate(value: number, code: string, date1904: boolean) {
  // Without a fraction of a second on show, times round to the nearest second, as Excel does.
  if (!/\.0/.test(code)) value = Math.round(value * 86400) / 86400;
  const d = serialDate(value, date1904);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate(), wd = d.getUTCDay(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  const twelve = /am\/pm|a\/p/i.test(code);
  // "m" is a minute right after an hour or before a second, a month otherwise.
  const tokens = code.match(/\[[hms]+\]|"[^"]*"|\\.|_.|\[[^\]]*\]|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|\.0+|[^a-zA-Z]|./gi) || [];
  let out = "", lastWasHour = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], l = t.toLowerCase();
    const nextIsSecond = tokens.slice(i + 1).find((x) => /^[a-z]/i.test(x) && !/^(am|a\/p)/i.test(x))?.toLowerCase().startsWith("s");
    if (t[0] === '"') out += t.slice(1, -1);
    else if (t[0] === "\\") out += t.slice(1);
    else if (t[0] === "_") out += " ";
    else if (t[0] === "[") { const m = /^\[([hms]+)\]$/i.exec(t); if (m) { const total = Math.floor(Math.round(value * 86400000) / 1000); out += m[1][0].toLowerCase() === "h" ? Math.floor(total / 3600) : m[1][0].toLowerCase() === "m" ? Math.floor(total / 60) : total; } }
    else if (l === "yyyy") out += pad(y, 4);
    else if (l === "yy") out += pad(y % 100);
    else if (l === "mmmmm") out += MONTHS[mo][0];
    else if (l === "mmmm") out += MONTHS[mo];
    else if (l === "mmm") out += MONTHS[mo].slice(0, 3);
    else if (l === "mm" || l === "m") { const minute = lastWasHour || nextIsSecond; out += minute ? (l === "mm" ? pad(mi) : mi) : l === "mm" ? pad(mo + 1) : mo + 1; }
    else if (l === "dddd") out += DAYS[wd];
    else if (l === "ddd") out += DAYS[wd].slice(0, 3);
    else if (l === "dd") out += pad(day);
    else if (l === "d") out += day;
    else if (l === "hh" || l === "h") { const hour = twelve ? h % 12 || 12 : h; out += l === "hh" ? pad(hour) : hour; }
    else if (l === "ss") out += pad(s);
    else if (l === "s") out += s;
    else if (l === "am/pm") out += h < 12 ? "AM" : "PM";
    else if (l === "a/p") out += h < 12 ? "A" : "P";
    else if (/^\.0+$/.test(l)) out += "." + String(Math.floor((value * 86400 % 1) * 10 ** (l.length - 1))).padStart(l.length - 1, "0");
    else out += t;
    if (/^(hh?|\[h+\])$/.test(l)) lastWasHour = true; else if (!/^[:\s]$/.test(t) && !/^(am\/pm|a\/p)$/.test(l)) lastWasHour = false;
  }
  return out;
}

/** The digits of a number set into a pattern of # 0 ? , . — with grouping, decimals, a percent sign and a scientific exponent. */
function formatDigits(value: number, pattern: string) {
  const percent = (pattern.match(/%/g) || []).length;
  value = Math.abs(value) * 100 ** percent;
  const scientific = /E[+-]0+/i.exec(pattern);
  if (scientific) {
    const mantissaPattern = pattern.slice(0, scientific.index);
    const decimals = (mantissaPattern.split(".")[1] || "").replace(/[^0#?]/g, "").length;
    const exponent = value === 0 ? 0 : Math.floor(Math.log10(value));
    const mantissa = value / 10 ** exponent;
    return mantissa.toFixed(decimals) + "E" + (exponent < 0 ? "-" : "+") + pad(Math.abs(exponent), scientific[0].length - 2);
  }
  const [intPattern, decPattern = ""] = pattern.split(".");
  const zeros = (decPattern.match(/0/g) || []).length, places = decPattern.replace(/[^0#?]/g, "").length;
  const digits = (Math.round(value * 10 ** places + 1e-9 * (value > 0 ? 1 : 0)) / 10 ** places).toFixed(places);
  let [whole, fraction = ""] = digits.split(".");
  fraction = fraction.replace(/0+$/, (z) => z.slice(0, Math.max(0, zeros - (fraction.length - z.length))));
  fraction = fraction.padEnd(zeros, "0");
  const minWhole = (intPattern.match(/0/g) || []).length;
  whole = whole.replace(/^0+/, "").padStart(minWhole, "0");
  if (/,/.test(intPattern)) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!whole && !fraction && !/[#?]/.test(pattern)) whole = "0";
  return whole + (fraction ? "." + fraction : "") + "%".repeat(percent);
}

function applyPattern(value: number, section: string, negativeShown: boolean) {
  // Literals and the digit pattern: everything between the first and last of # 0 ? . , % E is the number.
  const literal = (s: string) => s.replace(/"([^"]*)"|\\(.)|_.|\*.|\[(?:\$([^\]-]*)[^\]]*|[A-Za-z]+\d*)\]/g, (_, q, e, cur) => q ?? e ?? (cur !== undefined ? cur : "") ?? "");
  const m = /[#0?][#0?,.]*(?:E[+-]0+)?%*|%+/.exec(section.replace(/"[^"]*"/g, (x) => "\u0001".repeat(x.length)).replace(/\\./g, "\u0001\u0001").replace(/\[[^\]]*\]/g, (x) => "\u0001".repeat(x.length)));
  if (!m) return (negativeShown ? "-" : "") + literal(section);
  const number = formatDigits(value, section.slice(m.index, m.index + m[0].length).replace(/,(?=[^#0?]|$)/g, (x) => x));
  // A trailing comma scales by a thousand per comma ("#,##0," shows thousands).
  const scale = /(?:[#0?])(,+)(?![#0?])/.exec(m[0]);
  const scaled = scale ? formatDigits(value / 1000 ** scale[1].length, m[0].replace(/,+$/, "")) : number;
  return (negativeShown ? "-" : "") + literal(section.slice(0, m.index)) + scaled + literal(section.slice(m.index + m[0].length));
}

/** The text a cell with this number and format code shows. */
export function formatNumber(value: number, code = "General", date1904 = false): string {
  if (!Number.isFinite(value)) return String(value);
  if (!code || /^general$/i.test(code.trim())) {
    if (Number.isInteger(value) && Math.abs(value) < 1e11) return String(value);
    const text = Number(value.toPrecision(10)).toString();
    // Excel's General switches to scientific notation from 1E+11 and below 1E-9.
    return Math.abs(value) >= 1e11 || (value !== 0 && Math.abs(value) < 1e-9) || /e/i.test(text) ? Number(value.toPrecision(6)).toExponential().replace("e", "E").replace(/E([+-]?)(\d)$/, (_, sign, d) => "E" + (sign || "+") + "0" + d).replace(/E(\d\d)$/, "E+$1") : text;
  }
  const parts = sections(code);
  const section = value < 0 && parts.length > 1 ? parts[1] : value === 0 && parts.length > 2 ? parts[2] : parts[0];
  const negativeShown = value < 0 && parts.length <= 1;
  if (isDateFormat(section)) return formatDate(value, section, date1904);
  if (/^\s*@\s*$/.test(section)) return String(value);
  return applyPattern(value, section, negativeShown);
}
/** Text in a cell with a format: the "@" section, if any, wraps it. */
export function formatText(text: string, code = "General") {
  const section = sections(code)[3] ?? (/@/.test(code) ? code : undefined);
  return section ? section.replace(/"([^"]*)"|\\(.)|@/g, (m, q, e) => (m === "@" ? text : q ?? e ?? "")) : text;
}
