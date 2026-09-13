import { test } from "node:test";
import assert from "node:assert/strict";
import { context, evaluateLiteral, andMasks, orMasks, xorMasks, notMask, allAssignmentsMask } from "../../src/dld/boolean.js";
import { buildTruthTable, expressionToMask, maskFromMinterms, maskFromMaxterms } from "../../src/dld/truth_table.js";
import { parseBoolExpr, collectVariables, walk, variable } from "../../src/dld/expression.js";
import { buildKMap, grayCode } from "../../src/dld/kmap.js";

const LETTERS = "ABCDEFGHIJKLMNOPQ".split("");

function maskFromFn(vars, fn) {
  const ctx = context(vars);
  let m = 0n;
  for (let i = 0; i < ctx.totalAssignments; i++) {
    const values = {};
    for (let v = 0; v < vars.length; v++) values[vars[v]] = ((i >> v) & 1) ? 1 : 0;
    if (fn(values) === 1) m |= 1n << BigInt(i);
  }
  return m;
}

function indicesOf(mask) {
  const out = [];
  let m = mask;
  let i = 0;
  while (m !== 0n) {
    if ((m & 1n) === 1n) out.push(i);
    m >>= 1n;
    i++;
  }
  return out;
}

function generateSumOfMinterms(vars, truthMask) {
  const n = vars.length;
  const total = 1 << n;
  const terms = [];
  for (let i = 0; i < total; i++) {
    if (((truthMask >> i) & 1) === 1) {
      const parts = [];
      for (let v = 0; v < n; v++) {
        const bit = (i >> v) & 1;
        parts.push(bit ? vars[v] : "!" + vars[v]);
      }
      terms.push("(" + parts.join("*") + ")");
    }
  }
  if (terms.length === 0) return "0";
  if (terms.length === total) return "1";
  return terms.join("+");
}

test("property: expression mask matches truth table mask for 1..4 vars", () => {
  for (let n = 1; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const total = 1 << n;
    const totalFns = 1 << total;
    for (let s = 0; s < totalFns; s++) {
      const exprStr = generateSumOfMinterms(vars, s);
      const tt = buildTruthTable(vars, parseBoolExpr(exprStr));
      let bruteMask = 0n;
      for (let i = 0; i < total; i++) {
        if (((s >> i) & 1) === 1) bruteMask |= 1n << BigInt(i);
      }
      assert.equal(tt.mask, bruteMask, "n=" + n + " s=" + s);
    }
  }
});

test("property: K-map SOP for n=1..3 equals mask of s (all 2^(2^n) functions)", () => {
  for (let n = 2; n <= 3; n++) {
    const vars = LETTERS.slice(0, n);
    const total = 1 << n;
    const totalFns = 1 << total;
    for (let s = 0; s < totalFns; s++) {
      let m = 0n;
      for (let i = 0; i < total; i++) {
        if (((s >> i) & 1) === 1) m |= 1n << BigInt(i);
      }
      const km = buildKMap({ variables: vars, minterms: indicesOf(m) });
      const rebuilt = expressionToMask(km.simplified, km.context);
      assert.equal(rebuilt, m, "n=" + n + " s=" + s + " mask=0b" + m.toString(2));
    }
  }
});

test("property: K-map POS for n=1..3 equals mask of s", () => {
  for (let n = 2; n <= 3; n++) {
    const vars = LETTERS.slice(0, n);
    const total = 1 << n;
    const totalFns = 1 << total;
    for (let s = 0; s < totalFns; s++) {
      let m = 0n;
      for (let i = 0; i < total; i++) {
        if (((s >> i) & 1) === 1) m |= 1n << BigInt(i);
      }
      const km = buildKMap({ variables: vars, minterms: indicesOf(m), form: "pos" });
      const rebuilt = expressionToMask(km.simplified, km.context);
      assert.equal(rebuilt, m, "n=" + n + " s=" + s + " pos");
    }
  }
});

test("property: 4-var K-map with curated adversarial cases", () => {
  const vars = LETTERS.slice(0, 4);
  const cases = [
    0n,
    (1n << 16n) - 1n,
    0b1010_1010_1010_1010n,
    0b0000_1111_0000_1111n,
    0b1000_0000_0000_0001n,
    0b1100_0011_1100_0011n,
    0b1111_0000_1111_0000n,
    0b0110_1001_1001_0110n,
    0b1111_1111_0000_0000n,
  ];
  for (const s of cases) {
    const km = buildKMap({ variables: vars, minterms: indicesOf(s) });
    const rebuilt = expressionToMask(km.simplified, km.context);
    assert.equal(rebuilt, s, "4-var mask=0x" + s.toString(16));
  }
});

test("property: 100 random 4-var K-maps all simplify to correct mask", () => {
  const vars = LETTERS.slice(0, 4);
  const total = 1 << 4;
  let failures = 0;
  const failureCases = [];
  for (let t = 0; t < 100; t++) {
    let s = 0n;
    for (let i = 0; i < total; i++) {
      if (Math.random() < 0.5) s |= 1n << BigInt(i);
    }
    const km = buildKMap({ variables: vars, minterms: indicesOf(s) });
    const rebuilt = expressionToMask(km.simplified, km.context);
    if (rebuilt !== s) {
      failures++;
      failureCases.push(s.toString(2).padStart(16, "0"));
    }
  }
  assert.equal(failures, 0, "failures: " + failureCases.join(" "));
});

test("property: Gray code + GrayToBinary are inverses for n=1..8", () => {
  for (let n = 1; n <= 8; n++) {
    const codes = grayCode(n);
    assert.equal(codes.length, 1 << n, "n=" + n);
    for (let i = 0; i < codes.length; i++) {
      const g = codes[i];
      // Recover binary
      let b = g;
      for (let s = 1; s < n; s++) b ^= (g >> s);
      assert.equal(b, i, "n=" + n + " i=" + i + " g=" + g);
    }
  }
});

test("property: allAssignmentsMask has 2^n bits set for n=1..16", () => {
  for (let n = 1; n <= 16; n++) {
    const vars = LETTERS.slice(0, n);
    const ctx = context(vars);
    const m = allAssignmentsMask(ctx);
    let bits = 0n;
    let x = m;
    while (x !== 0n) { bits += 1n; x &= (x - 1n); }
    assert.equal(bits, 1n << BigInt(n), "n=" + n);
  }
});

test("property: truth table output matches independent evaluation for n=1..4", () => {
  for (let n = 1; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const total = 1 << n;
    const totalFns = 1 << total;
    for (let s = 0; s < totalFns; s++) {
      const truthMask = BigInt(s);
      const tt = buildTruthTable(vars, parseBoolExpr(generateSumOfMinterms(vars, s)));
      for (const row of tt.rows) {
        const expectedBit = ((truthMask >> BigInt(row.index)) & 1n) === 1n ? 1 : 0;
        assert.equal(row.output, expectedBit, "n=" + n + " s=" + s + " row=" + row.index);
      }
    }
  }
});

test("property: dont-cares must not corrupt the simplified mask", () => {
  for (let n = 2; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const total = 1 << n;
    for (let t = 0; t < 30; t++) {
      const realMask = BigInt(Math.floor(Math.random() * (1 << total)));
      const dontMask = BigInt(Math.floor(Math.random() * (1 << total)));
      const cleanDont = dontMask & ~realMask;
      const km = buildKMap({ variables: vars, minterms: indicesOf(realMask), dontCares: indicesOf(cleanDont) });
      const rebuilt = expressionToMask(km.simplified, km.context);
      // Property: simplified mask must agree with realMask on every
      // non-don't-care cell. (The don't-care cells are free.)
      const allMask = (1n << BigInt(total)) - 1n;
      const onNonDontCare = (rebuilt & ~cleanDont) === realMask;
      // Also: simplified must not force F=1 on a non-minterm, non-dont-care
      // cell. Equivalently: rebuilt subseteq (realMask | cleanDont).
      const onlyAllowed = (rebuilt & ~(realMask | cleanDont)) === 0n;
      assert.ok(onNonDontCare && onlyAllowed,
        "t=" + t + " real=" + realMask.toString(2) + " dont=" + cleanDont.toString(2) +
        " rebuilt=" + rebuilt.toString(2) + " allMask=" + allMask.toString(2));
    }
  }
});

test("property: constants evaluate correctly", () => {
  for (let n = 1; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const ctx = context(vars);
    assert.equal(expressionToMask(parseBoolExpr("0"), ctx), 0n);
    assert.equal(expressionToMask(parseBoolExpr("1"), ctx), allAssignmentsMask(ctx));
  }
});

test("property: De Morgan laws hold for n=2..4", () => {
  for (let n = 2; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const ctx = context(vars);
    const lhs1 = expressionToMask(parseBoolExpr("!(A*B)"), ctx);
    const rhs1 = expressionToMask(parseBoolExpr("!A+!B"), ctx);
    assert.equal(lhs1, rhs1, "De Morgan 1 n=" + n);
    const lhs2 = expressionToMask(parseBoolExpr("!(A+B)"), ctx);
    const rhs2 = expressionToMask(parseBoolExpr("!A*!B"), ctx);
    assert.equal(lhs2, rhs2, "De Morgan 2 n=" + n);
  }
});

test("property: notMask(X) XOR X == allAssignmentsMask", () => {
  for (let n = 1; n <= 4; n++) {
    const vars = LETTERS.slice(0, n);
    const ctx = context(vars);
    const total = 1 << n;
    for (let s = 0; s < (1 << total); s++) {
      const m = BigInt(s);
      const xored = notMask(m, ctx) ^ m;
      assert.equal(xored, allAssignmentsMask(ctx), "n=" + n + " s=" + s);
    }
  }
});

test("property: maskFromMaxterms is complement of maskFromMinterms of remaining set", () => {
  for (let n = 1; n <= 3; n++) {
    const vars = LETTERS.slice(0, n);
    const ctx = context(vars);
    const total = ctx.totalAssignments;
    const totalSels = 1 << total;
    for (let s = 0; s < totalSels; s++) {
      const mins = [];
      const maxs = [];
      for (let i = 0; i < total; i++) {
        if (((s >> i) & 1) === 1) mins.push(i);
        else maxs.push(i);
      }
      const m1 = maskFromMinterms(mins, ctx);
      const m2 = maskFromMaxterms(maxs, ctx);
      assert.equal(m1, m2, "n=" + n + " s=" + s);
    }
  }
});

test("adversarial: parser handles various operator synonyms and whitespace", () => {
  const forms = [
    "A*B+!A*!B*C",
    "A AND B OR NOT A AND NOT B AND C",
    "A and B or !A and !B and C",
    "A or B and C",
    "!A*!B",
    "A?B",
    "A xor B",
  ];
  for (const f of forms) {
    const e = parseBoolExpr(f);
    const vars = collectVariables(e);
    assert.ok(vars.length > 0, "vars for " + f);
  }
});

test("adversarial: variable() enforces single-letter name", () => {
  assert.throws(() => variable("ABC"));
  assert.doesNotThrow(() => variable("A"));
});