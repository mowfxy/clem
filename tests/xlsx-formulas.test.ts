import { test } from "node:test";
import assert from "node:assert/strict";
import { Calculator, showValue, cellKey, type Grid, type Value } from "../core/xlsx-formulas.ts";
import { formatNumber, formatText, isDateFormat } from "../core/numfmt.ts";

/** A one-sheet grid from rows of values; strings starting with "=" are formulas. */
const grid = (rows: (Value | string)[][], name = "Sheet1", more: Record<string, (Value | string)[][]> = {}): Grid => {
  const g: Grid = new Map();
  for (const [sheet, data] of Object.entries({ [name]: rows, ...more })) {
    const cells = new Map<string, any>();
    data.forEach((row, r) => row.forEach((v, c) => { if (v !== null) cells.set(cellKey(r + 1, c + 1), typeof v === "string" && v.startsWith("=") ? { formula: v } : { value: v }); }));
    g.set(sheet, cells);
  }
  return g;
};
const calc = (rows: (Value | string)[][], formula: string, more?: Record<string, (Value | string)[][]>) => { const g = grid([...rows.map((r) => [...r]), [formula]], "Sheet1", more); return new Calculator(g).value("Sheet1", rows.length + 1, 1); };

test("arithmetic follows Excel's precedence, including the unary minus and percent", () => {
  assert.equal(calc([], "=1+2*3"), 7);
  assert.equal(calc([], "=-2^2"), 4);
  assert.equal(calc([], "=2^3^2"), 64);
  assert.equal(calc([], "=(1+2)*3-4/2"), 7);
  assert.equal(calc([], "=50%*4"), 2);
  assert.equal(calc([], '="a"&"b"&1'), "ab1");
  assert.equal(calc([], "=5>3"), true);
  assert.equal(calc([], '="a"="A"'), true);
  assert.deepEqual(calc([], "=1/0"), { error: "#DIV/0!" });
  assert.deepEqual(calc([], '="x"+1'), { error: "#VALUE!" });
});

test("Mowr's workbook formulas calculate: row formulas, totals and cross-cell references", () => {
  const g = grid([["Item", "Qty", "Price", "Total"], ["Pen", 3, 1.5, "=B2*C2"], ["Book", 2, 12, "=B3*C3"], ["Total", "=SUM(B2:B3)", "", "=SUM(D2:D3)"], ["Share", "", "", "=D2/D4"]]);
  const c = new Calculator(g);
  assert.equal(c.value("Sheet1", 2, 4), 4.5);
  assert.equal(c.value("Sheet1", 3, 4), 24);
  assert.equal(c.value("Sheet1", 4, 2), 5);
  assert.equal(c.value("Sheet1", 4, 4), 28.5);
  assert.equal(showValue(c.value("Sheet1", 5, 4), "0.0%"), "15.8%");
});

test("the everyday functions", () => {
  const data: Value[][] = [[1, "a"], [2, "b"], [3, "a"], [4, "c"], [null, "a"]];
  assert.equal(calc(data, "=SUM(A1:A5)"), 10);
  assert.equal(calc(data, "=AVERAGE(A1:A5)"), 2.5);
  assert.equal(calc(data, "=MIN(A1:A5)+MAX(A1:A5)"), 5);
  assert.equal(calc(data, "=COUNT(A1:A5)"), 4);
  assert.equal(calc(data, "=COUNTA(B1:B5)"), 5);
  assert.equal(calc(data, '=COUNTIF(B1:B5,"a")'), 3);
  assert.equal(calc(data, '=SUMIF(B1:B5,"a",A1:A5)'), 4);
  assert.equal(calc(data, '=SUMIF(A1:A5,">1")'), 9);
  assert.equal(calc(data, "=MEDIAN(A1:A4)"), 2.5);
  assert.equal(calc(data, "=ROUND(2.345,2)"), 2.35);
  assert.equal(calc(data, "=ROUND(-2.5,0)"), -3);
  assert.equal(calc(data, "=ROUNDUP(2.01,1)+ROUNDDOWN(2.99,1)"), 5);
  assert.equal(calc(data, '=IF(A1>0,"pos","neg")'), "pos");
  assert.equal(calc(data, "=IFERROR(1/0,-1)"), -1);
  assert.equal(calc(data, "=AND(A1>0,A2>1)"), true);
  assert.equal(calc(data, "=OR(A1>5,FALSE)"), false);
  assert.equal(calc(data, '=UPPER(B1)&LEN("héllo")'), "A5");
  assert.equal(calc(data, '=TEXT(1234.5,"#,##0.00")'), "1,234.50");
  assert.equal(calc(data, "=MOD(-3,5)+ABS(-2)+INT(2.9)+SQRT(16)+POWER(2,3)"), 2 + 2 + 2 + 4 + 8);
  assert.equal(calc(data, '=VLOOKUP("b",B1:B4,1,FALSE)'), "b");
  assert.equal(calc(data, "=INDEX(A1:B4,3,2)"), "a");
  assert.equal(calc(data, '=MATCH("c",B1:B5,0)'), 4);
  assert.equal(calc(data, "=SUM(A1:A5,10,\"5\")"), 25);
});

test("references across sheets, absolute references and circular references", () => {
  const g = grid([["=Data!B2*2", "=$A$2+A2"], [5, "=A1+B1"]], "Calc", { Data: [["x", "y"], ["p", 21]] });
  const c = new Calculator(g);
  assert.equal(c.value("Calc", 1, 1), 42);
  assert.equal(c.value("Calc", 1, 2), 10);
  assert.equal(c.value("Calc", 2, 2), 52);
  const loop = grid([["=B1", "=A1"]]);
  assert.deepEqual(new Calculator(loop).value("Sheet1", 1, 1), { error: "#REF!" });
  const quoted = grid([["='My Sheet'!A1+1"]], "Main", { "My Sheet": [[9]] });
  assert.equal(new Calculator(quoted).value("Main", 1, 1), 10);
});

test("a function the viewer does not know keeps the result the file saved, else says #NAME?", () => {
  const g: Grid = new Map([["S", new Map<string, any>([[cellKey(1, 1), { formula: "=XLOOKUP(1,B1:B2,C1:C2)", value: 77 }], [cellKey(2, 1), { formula: "=FOO(1)" }], [cellKey(3, 1), { formula: "=1+" }]])]]);
  const c = new Calculator(g);
  assert.equal(c.value("S", 1, 1), 77);
  assert.deepEqual(c.value("S", 2, 1), { error: "#NAME?" });
  assert.deepEqual(c.value("S", 3, 1), { error: "#NAME?" });
});

test("number formats show what Excel shows", () => {
  const cases: [number, string, string][] = [
    [1234.5, "#,##0.00", "1,234.50"], [1234.5, "#,##0", "1,235"], [0.256, "0.0%", "25.6%"], [1234.5, '"$"#,##0.00', "$1,234.50"], [-1234.5, '"$"#,##0.00', "-$1,234.50"],
    [1234.5, "[$€-x-euro2] #,##0.00", "€ 1,234.50"], [-5, "#,##0;(#,##0)", "(5)"], [0, '0;-0;"zero"', "zero"], [5, "000", "005"], [3.14159, "0.00", "3.14"], [42, "General", "42"],
    [0.1 + 0.2, "General", "0.3"], [1234567, "0.00E+00", "1.23E+06"], [1500000, '#,##0.0,,"M"', "1.5M"], [7, '0" items"', "7 items"], [2.5, "0.0", "2.5"], [1e12, "General", "1E+12"],
    [45000, "yyyy-mm-dd", "2023-03-15"], [45000.75, "yyyy-mm-dd hh:mm", "2023-03-15 18:00"], [45000, "d mmm yyyy", "15 Mar 2023"], [45000, "dddd, mmmm d", "Wednesday, March 15"], [0.5, "h:mm AM/PM", "12:00 PM"], [45000, "dd/mm/yy", "15/03/23"],
  ];
  for (const [value, code, expected] of cases) assert.equal(formatNumber(value, code), expected, `${value} as ${code}`);
  assert.ok(isDateFormat("yyyy-mm-dd") && isDateFormat("h:mm") && !isDateFormat("#,##0.00") && !isDateFormat('0" days"') && !isDateFormat("General") && !isDateFormat("@"));
  assert.equal(formatText("abc", '"Name: "@'), "Name: abc");
  assert.equal(showValue(true), "TRUE");
  assert.equal(showValue({ error: "#N/A" }), "#N/A");
});

test("COUNTIF's blank criteria treat empty cells as blank", () => {
  const rows = [[5], [null], ["x"], [null]];
  assert.equal(calc(rows, '=COUNTIF(A1:A4,"<>")'), 2);
  assert.equal(calc(rows, '=COUNTIF(A1:A4,"")'), 2);
});

test("rounding works on 15 significant digits, without pushing values across a boundary", () => {
  assert.equal(calc([], "=ROUNDDOWN(0.9999999999,0)"), 0);
  assert.equal(calc([], "=ROUND(0.4999999999,0)"), 0);
  assert.equal(calc([], "=ROUND(2.675,2)"), 2.68);
  assert.equal(calc([], "=ROUNDUP(1.1,1)"), 1.1);
});

test("the preview keeps a result the file saved instead of working it out again", () => {
  const g: Grid = new Map([["Sheet1", new Map([[cellKey(1, 1), { value: 7, formula: 'VLOOKUP("app*",B1:C1,2,FALSE)' }], [cellKey(2, 1), { value: null, formula: "1+1" }]])]]);
  const stored = new Calculator(g, { stored: true });
  assert.equal(stored.value("Sheet1", 1, 1), 7);
  assert.equal(stored.value("Sheet1", 2, 1), 2);
});

test("elapsed and clock times round to the second the way Excel shows them", () => {
  let hour = 0;
  for (let i = 0; i < 60; i++) hour += 1 / 1440;
  assert.equal(showValue(hour, "[h]:mm:ss", false), "1:00:00");
  assert.equal(showValue(0.5 + 0.6 / 86400, "hh:mm:ss", false), "12:00:01");
  assert.equal(showValue(2, "[h]", false), "48");
  assert.ok(isDateFormat("[h]"));
});
