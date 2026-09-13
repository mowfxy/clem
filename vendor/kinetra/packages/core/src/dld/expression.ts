/**
 * Boolean expression AST and string parser.
 *
 * Grammar (lowest to highest precedence):
 *   expr   := or-expr
 *   or     := xor ("+"|"or" xor)*
 *   xor    := and ("?" and)*
 *   and    := not (("*"|"·"|"and") not | implicit-AND)*
 *   not    := "!" | "~" | "not" not | primary
 *   primary:= "(" expr ")" | VAR | "0" | "1"
 *
 * Variables are SINGLE UPPERCASE letters. This keeps the implicit-AND
 * production deterministic: !AB parses as (!A) AND B rather than
 * NOT(AB), and AB parses as A AND B.
 *
 * Operator synonyms: + | or, * | and | ·, ! | not | ~, ? | xor.
 */

import { KinetraError } from "../errors.js";

export type BoolExpr =
  | { type: "const"; value: 0 | 1 }
  | { type: "var"; name: string }
  | { type: "not"; arg: BoolExpr }
  | { type: "and"; args: BoolExpr[] }
  | { type: "or"; args: BoolExpr[] }
  | { type: "xor"; args: BoolExpr[] };

export function constant(v: 0 | 1): BoolExpr {
  return { type: "const", value: v };
}

export function variable(name: string): BoolExpr {
  if (!/^[A-Za-z]$/.test(name)) {
    throw new KinetraError("validation", "Invalid variable name: " + name);
  }
  return { type: "var", name: name.toUpperCase() };
}

export function not(arg: BoolExpr): BoolExpr {
  return { type: "not", arg };
}

export function and(...args: BoolExpr[]): BoolExpr {
  if (args.length === 0) return constant(1);
  if (args.length === 1) return args[0];
  return { type: "and", args };
}

export function or(...args: BoolExpr[]): BoolExpr {
  if (args.length === 0) return constant(0);
  if (args.length === 1) return args[0];
  return { type: "or", args };
}

export function xor(...args: BoolExpr[]): BoolExpr {
  if (args.length === 0) return constant(0);
  if (args.length === 1) return args[0];
  return { type: "xor", args };
}

export function collectVariables(e: BoolExpr): string[] {
  const out = new Set<string>();
  walk(e, (n) => { if (n.type === "var") out.add(n.name); });
  return [...out].sort();
}

export function walk(e: BoolExpr, visit: (n: BoolExpr) => void): void {
  visit(e);
  switch (e.type) {
    case "const":
    case "var":
      return;
    case "not":
      walk(e.arg, visit);
      return;
    case "and":
    case "or":
    case "xor":
      for (const a of e.args) walk(a, visit);
      return;
  }
}

// --- Parser -----------------------------------------------------------------

class Parser {
  pos = 0;
  src: string;
  constructor(src: string) { this.src = src; }

  parse(): BoolExpr {
    const e = this.parseOr();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new KinetraError("parse", "Unexpected character at " + this.pos + ": " + this.src[this.pos], { src: this.src });
    }
    return e;
  }

  private parseOr(): BoolExpr {
    let left = this.parseXor();
    while (true) {
      this.skipWs();
      const c = this.src[this.pos];
      if (c === "+" || (c === "o" && this.src.startsWith("or", this.pos))) {
        if (c === "o") this.pos += 2; else this.pos += 1;
        const right = this.parseXor();
        if (left.type === "or") left.args.push(right);
        else left = or(left, right);
      } else break;
    }
    return left;
  }

  private parseXor(): BoolExpr {
    let left = this.parseAnd();
    while (true) {
      this.skipWs();
      if (this.src[this.pos] === "?") {
        this.pos += 1;
        const right = this.parseAnd();
        if (left.type === "xor") left.args.push(right);
        else left = xor(left, right);
      } else if (this.src.startsWith("xor", this.pos) && /[A-Za-z(]/.test(this.src[this.pos + 3] ?? " ")) {
        this.pos += 3;
        const right = this.parseAnd();
        if (left.type === "xor") left.args.push(right);
        else left = xor(left, right);
      } else break;
    }
    return left;
  }

  private parseAnd(): BoolExpr {
    let left = this.parseNot();
    while (true) {
      this.skipWs();
      const c = this.src[this.pos];
      const after = this.src[this.pos + 1] ?? " ";
      // Explicit operators
      if (c === "*" || c === "·") {
        this.pos += 1;
        const right = this.parseNot();
        if (left.type === "and") left.args.push(right);
        else left = and(left, right);
        continue;
      }
      if (c === "a" && this.src.startsWith("and", this.pos) && /[A-Za-z(]/.test(this.src[this.pos + 3] ?? " ")) {
        this.pos += 3;
        const right = this.parseNot();
        if (left.type === "and") left.args.push(right);
        else left = and(left, right);
        continue;
      }
      // Implicit AND: variable/closing paren followed by var, paren, or not
      const startsWithNot = (s: string, p: number) => {
        const cc = s[p];
        if (cc === "!" || cc === "~") return true;
        if (cc === "n" && s.startsWith("not", p) && !/[A-Za-z0-9_]/.test(s[p + 3] ?? "")) return true;
        return false;
      };
      // Implicit AND: anything that begins a new term continues the AND
      // chain. After parseNot, c is either a letter, an opening paren, or a
      // NOT-prefix - all of these mean a new term is starting.
      const isLetter = /^[A-Za-z]$/.test(c ?? "");
      if (isLetter || c === "(" || startsWithNot(this.src, this.pos)) {
        const right = this.parseNot();
        if (left.type === "and") left.args.push(right);
        else left = and(left, right);
        continue;
      }
      break;
    }
    return left;
  }

  private parseNot(): BoolExpr {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === "!" || c === "~") {
      this.pos += 1;
      return not(this.parseNot());
    }
    if (c === "n" && this.src.startsWith("not", this.pos) && !/[A-Za-z0-9_]/.test(this.src[this.pos + 3] ?? "")) {
      this.pos += 3;
      return not(this.parseNot());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): BoolExpr {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === "(") {
      this.pos += 1;
      const e = this.parseOr();
      this.skipWs();
      if (this.src[this.pos] !== ")") {
        throw new KinetraError("parse", "Expected ) at " + this.pos, { src: this.src });
      }
      this.pos += 1;
      return e;
    }
    if (c === "0" || c === "1") {
      this.pos += 1;
      return constant(c === "1" ? 1 : 0);
    }
    if (/[A-Za-z]/.test(c ?? "")) {
      this.pos += 1;
      return variable(c);
    }
    throw new KinetraError("parse", "Unexpected character at " + this.pos + ": " + c, { src: this.src });
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos += 1;
  }
}

export function parseBoolExpr(src: string): BoolExpr {
  return new Parser(src.trim()).parse();
}
