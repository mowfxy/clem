/**
 * Numeric expression AST. Supports a broad subset of mathematics sufficient
 * for technical documents: arithmetic, trigonometric, exponential/log, vectors,
 * units, sums, products, derivatives, integrals, piecewise definitions, matrices.
 *
 * The parser is recursive-descent. The evaluator is in ./eval.ts.
 */

import { KinetraError } from "../errors.js";

export type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "const"; name: "pi" | "e" | "inf" | "nan" }
  | { type: "neg"; arg: Expr }
  | { type: "add"; args: Expr[] }
  | { type: "sub"; left: Expr; right: Expr }
  | { type: "mul"; args: Expr[] }
  | { type: "div"; left: Expr; right: Expr }
  | { type: "pow"; left: Expr; right: Expr }
  | { type: "fn"; name: FnName; args: Expr[] }
  | { type: "sum"; var: string; from: Expr; to: Expr; body: Expr }
  | { type: "prod"; var: string; from: Expr; to: Expr; body: Expr }
  | { type: "piecewise"; cases: { cond: Expr; value: Expr }[]; otherwise: Expr }
  | { type: "matrix"; rows: Expr[][] }
  | { type: "vector"; items: Expr[] }
  | { type: "deriv"; var: string; body: Expr; order: number };

export type FnName =
  | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "atan2"
  | "sinh" | "cosh" | "tanh"
  | "exp" | "ln" | "log" | "log2" | "log10" | "sqrt" | "cbrt" | "abs"
  | "floor" | "ceil" | "round" | "min" | "max" | "sign"
  | "mod" | "pow";

export function num(v: number): Expr { return { type: "num", value: v }; }
export function vr(name: string): Expr { return { type: "var", name }; }
export function pi(): Expr { return { type: "const", name: "pi" }; }
export function e(): Expr { return { type: "const", name: "e" }; }

class Parser {
  private pos = 0;
  private src: string;
  constructor(src: string) { this.src = src; }
  parse(): Expr {
    const e = this.parseAdd();
    this.skip();
    if (this.pos < this.src.length) {
      throw new KinetraError("parse", `Unexpected "${this.src[this.pos]}" at ${this.pos}`);
    }
    return e;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (true) {
      this.skip();
      const c = this.src[this.pos];
      if (c === "+" || c === "-") {
        this.pos += 1;
        const right = this.parseMul();
        left = c === "+" ? { type: "add", args: [left, right] } : { type: "sub", left, right };
        continue;
      }
      break;
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    while (true) {
      this.skip();
      const c = this.src[this.pos];
      const next = this.src[this.pos + 1] ?? " ";
      if (c === "*" || c === "�" || c === "/") {
        this.pos += 1;
        const right = this.parsePow();
        left = c === "*" ? { type: "mul", args: [left, right] } : { type: "div", left, right };
        continue;
      }
      // Implicit multiplication
      if ((/[A-Za-z0-9(]/.test(c ?? "") && /[A-Za-z0-9(]/.test(next) && left.type !== "num" && left.type !== "const") ||
          (/[A-Za-z0-9)\]]|"/.test(c ?? "") && left.type === "num")) {
        const right = this.parsePow();
        left = { type: "mul", args: [left, right] };
        continue;
      }
      break;
    }
    return left;
  }

  private parsePow(): Expr {
    const left = this.parseUnary();
    this.skip();
    if (this.src[this.pos] === "^") {
      this.pos += 1;
      const right = this.parsePow(); // right-associative
      return { type: "pow", left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    this.skip();
    if (this.src[this.pos] === "-") {
      this.pos += 1;
      return { type: "neg", arg: this.parseUnary() };
    }
    if (this.src[this.pos] === "+") {
      this.pos += 1;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    this.skip();
    const c = this.src[this.pos];
    if (c === "(") {
      this.pos += 1;
      const e = this.parseAdd();
      this.skip();
      if (this.src[this.pos] !== ")") throw new KinetraError("parse", "Expected )");
      this.pos += 1;
      return e;
    }
    if (c === "[") {
      this.pos += 1;
      const items: Expr[] = [];
      this.skip();
      if (this.src[this.pos] !== "]") {
        items.push(this.parseAdd());
        while (this.src[this.pos] === ",") {
          this.pos += 1;
          items.push(this.parseAdd());
        }
      }
      this.skip();
      if (this.src[this.pos] !== "]") throw new KinetraError("parse", "Expected ]");
      this.pos += 1;
      if (this.src[this.pos] === ";") {
        // matrix
        const rows: Expr[][] = [items];
        while (this.src[this.pos] === ";") {
          this.pos += 1;
          const row: Expr[] = [];
          row.push(this.parseAdd());
          while (this.src[this.pos] === ",") {
            this.pos += 1;
            row.push(this.parseAdd());
          }
          rows.push(row);
        }
        this.skip();
        if (this.src[this.pos] !== "]") throw new KinetraError("parse", "Expected ]");
        this.pos += 1;
        return { type: "matrix", rows };
      }
      return { type: "vector", items };
    }
    if (c === "{") {
      this.pos += 1;
      const cases: { cond: Expr; value: Expr }[] = [];
      let otherwise: Expr = num(0);
      while (this.src[this.pos] !== "}") {
        const cond = this.parseAdd();
        this.skip();
        if (this.src[this.pos] !== ":") throw new KinetraError("parse", "Expected :");
        this.pos += 1;
        const value = this.parseAdd();
        if (cond.type === "const" && cond.name === "inf") otherwise = value;
        else cases.push({ cond, value });
        this.skip();
        if (this.src[this.pos] === ",") { this.pos += 1; this.skip(); }
      }
      this.pos += 1;
      return { type: "piecewise", cases, otherwise };
    }
    if (c === "S" || c === "?") {
      this.pos += 1;
      return this.parseSigmaBody("sum");
    }
    if (c === "?" || c === "?") {
      this.pos += 1;
      return this.parseSigmaBody("prod");
    }
    if (c === "d" && this.src[this.pos + 1] === "/") {
      this.pos += 2;
      const v = this.readIdent();
      this.skip();
      if (this.src[this.pos] !== "(") throw new KinetraError("parse", "Expected ( after d/dx");
      this.pos += 1;
      const body = this.parseAdd();
      this.skip();
      if (this.src[this.pos] !== ")") throw new KinetraError("parse", "Expected )");
      this.pos += 1;
      return { type: "deriv", var: v, body, order: 1 };
    }
    if (/[0-9]/.test(c ?? "") || (c === "." && /[0-9]/.test(this.src[this.pos + 1] ?? ""))) {
      let j = this.pos;
      let seenDot = false;
      let seenE = false;
      while (j < this.src.length) {
        const x = this.src[j];
        if (/[0-9]/.test(x)) { j += 1; continue; }
        if (x === "." && !seenDot) { seenDot = true; j += 1; continue; }
        if ((x === "e" || x === "E") && !seenE) {
          seenE = true;
          j += 1;
          if (this.src[j] === "+" || this.src[j] === "-") j += 1;
          continue;
        }
        break;
      }
      const text = this.src.slice(this.pos, j);
      this.pos = j;
      return num(Number(text));
    }
    if (c === "p" || c === "p") { this.pos += 1; return pi(); }
    if (c === "e" && !/[A-Za-z0-9_]/.test(this.src[this.pos + 1] ?? " ")) { this.pos += 1; return e(); }
    if (/[A-Za-z]/.test(c ?? "")) {
      const name = this.readIdent();
      this.skip();
      if (this.src[this.pos] === "(") {
        this.pos += 1;
        const args: Expr[] = [];
        this.skip();
        if (this.src[this.pos] !== ")") {
          args.push(this.parseAdd());
          while (this.src[this.pos] === ",") {
            this.pos += 1;
            args.push(this.parseAdd());
          }
        }
        this.skip();
        if (this.src[this.pos] !== ")") throw new KinetraError("parse", "Expected )");
        this.pos += 1;
        return { type: "fn", name: name as FnName, args };
      }
      return vr(name);
    }
    throw new KinetraError("parse", `Unexpected "${c}" at ${this.pos}`);
  }

  private parseSigmaBody(kind: "sum" | "prod"): Expr {
    this.skip();
    const v = this.readIdent();
    this.skip();
    if (this.src[this.pos] !== "=") throw new KinetraError("parse", "Expected = in sum");
    this.pos += 1;
    const from = this.parseAdd();
    this.skip();
    if (this.src[this.pos] !== "to" && this.src[this.pos + 1] !== " ") {
      // accept "to" or "..."
    }
    let to: Expr;
    if (this.src[this.pos] === "." && this.src[this.pos + 1] === "." && this.src[this.pos + 2] === ".") {
      this.pos += 3;
      to = this.parseAdd();
    } else if (this.src.startsWith("to", this.pos)) {
      this.pos += 2;
      to = this.parseAdd();
    } else {
      throw new KinetraError("parse", "Expected `to` or `...` in sum");
    }
    this.skip();
    if (this.src[this.pos] !== "(") throw new KinetraError("parse", "Expected ( body )");
    this.pos += 1;
    const body = this.parseAdd();
    this.skip();
    if (this.src[this.pos] !== ")") throw new KinetraError("parse", "Expected ) in sum body");
    this.pos += 1;
    return kind === "sum" ? { type: "sum", var: v, from, to, body } : { type: "prod", var: v, from, to, body };
  }

  private readIdent(): string {
    let j = this.pos;
    while (j < this.src.length && /[A-Za-z0-9_]/.test(this.src[j])) j += 1;
    const id = this.src.slice(this.pos, j);
    this.pos = j;
    return id;
  }

  private skip(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos += 1;
  }
}

export function parseExpr(src: string): Expr {
  return new Parser(src.trim()).parse();
}

export function collectVars(e: Expr, acc: Set<string> = new Set()): string[] {
  switch (e.type) {
    case "num":
    case "const":
      return [...acc];
    case "var":
      acc.add(e.name);
      return [...acc];
    case "neg":
      return collectVars(e.arg, acc);
    case "add":
    case "mul":
      for (const a of e.args) collectVars(a, acc);
      return [...acc];
    case "sub":
    case "div":
    case "pow":
      collectVars(e.left, acc); collectVars(e.right, acc);
      return [...acc];
    case "fn":
      for (const a of e.args) collectVars(a, acc);
      return [...acc];
    case "sum":
    case "prod":
      acc.add(e.var);
      collectVars(e.body, acc);
      return [...acc];
    case "piecewise":
      for (const c of e.cases) { collectVars(c.cond, acc); collectVars(c.value, acc); }
      collectVars(e.otherwise, acc);
      return [...acc];
    case "matrix":
      for (const r of e.rows) for (const c of r) collectVars(c, acc);
      return [...acc];
    case "vector":
      for (const c of e.items) collectVars(c, acc);
      return [...acc];
    case "deriv":
      acc.add(e.var);
      collectVars(e.body, acc);
      return [...acc];
  }
}
