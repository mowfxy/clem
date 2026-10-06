/** A small, safe arithmetic language for model-authored visuals and checks.
 *  It never touches `eval`: text is parsed into closures over a fixed vocabulary. */
export type Vars = Record<string, number>;
export type Compiled = ((vars: Vars) => number) & { names: string[] };

const fns: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign, min: Math.min, max: Math.max, hypot: Math.hypot, pow: Math.pow,
  mod: (a, b) => ((a % b) + b) % b, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  deg: v => v * 180 / Math.PI, rad: v => v * Math.PI / 180,
  step: v => (v >= 0 ? 1 : 0), lerp: (a, b, t) => a + (b - a) * t,
  // Factorial for non-negative integers up to 170 (larger values overflow).
  fact: v => { if (v < 0 || v > 170 || v !== Math.floor(v)) return NaN; let r = 1; for (let i = 2; i <= v; i++) r *= i; return r; },
};
const consts: Vars = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, g0: 9.80665 };
export const expressionFunctions = Object.keys(fns);

type Tok = { k: 'n'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ k: 'n', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(?:<=|>=|==|!=|&&|\|\||\*\*|[-+*/%^(),<>?:!])/.exec(src.slice(i));
    if (op) { out.push({ k: 'op', v: op[0] === '**' ? '^' : op[0] }); i += op[0].length; continue; }
    // Common typography from models: ×, ·, −, ÷, π, θ-style names are rejected except these.
    const map: Record<string, string> = { '×': '*', '·': '*', '−': '-', '÷': '/', 'π': 'pi' };
    if (map[c]) { const m = map[c]; out.push(m === 'pi' ? { k: 'id', v: 'pi' } : { k: 'op', v: m }); i++; continue; }
    throw Error(`Unexpected “${c}” in expression`);
  }
  return out;
}

type Node = (v: Vars) => number;
/** Compile an expression. `allowed` restricts variable names; unknown names fail at compile time. */
export function compile(src: string, allowed?: Iterable<string>): Compiled {
  if (typeof src !== 'string' || !src.trim()) throw Error('Empty expression');
  if (src.length > 600) throw Error('Expression is too long');
  const toks = lex(src), names = new Set<string>(), allow = allowed ? new Set(allowed) : null;
  let p = 0, nodes = 0;
  const peek = () => toks[p], eat = (v?: string) => { const t = toks[p]; if (!t || (v !== undefined && t.v !== v)) throw Error(`Expected ${v ?? 'more'} in expression`); p++; return t; };
  const count = () => { if (++nodes > 500) throw Error('Expression is too complex'); };
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  function ternary(): Node {
    const cond = or();
    if (isOp('?')) { eat('?'); const a = ternary(); eat(':'); const b = ternary(); count(); return v => (cond(v) ? a(v) : b(v)); }
    return cond;
  }
  function or(): Node { let l = and(); while (isOp('||')) { eat(); const a = l, b = and(); count(); l = v => (a(v) || b(v) ? 1 : 0); } return l; }
  function and(): Node { let l = cmp(); while (isOp('&&')) { eat(); const a = l, b = cmp(); count(); l = v => (a(v) && b(v) ? 1 : 0); } return l; }
  function cmp(): Node {
    let l = add();
    while (peek()?.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek()!.v as string)) {
      const o = eat().v, a = l, b = add(); count();
      l = o === '<' ? v => +(a(v) < b(v)) : o === '>' ? v => +(a(v) > b(v)) : o === '<=' ? v => +(a(v) <= b(v)) : o === '>=' ? v => +(a(v) >= b(v)) : o === '==' ? v => +(Math.abs(a(v) - b(v)) < 1e-12) : v => +(Math.abs(a(v) - b(v)) >= 1e-12);
    }
    return l;
  }
  function add(): Node { let l = mul(); while (isOp('+') || isOp('-')) { const o = eat().v, a = l, b = mul(); count(); l = o === '+' ? v => a(v) + b(v) : v => a(v) - b(v); } return l; }
  function mul(): Node {
    let l = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('%')) { const o = eat().v, a = l, b = unary(); count(); l = o === '*' ? v => a(v) * b(v) : o === '/' ? v => a(v) / b(v) : v => a(v) % b(v); continue; }
      // Implicit multiplication: 2x, 2(x+1), (a)(b), 3pi
      const t = peek();
      if (t && (t.k === 'id' || t.k === 'n' || (t.k === 'op' && t.v === '('))) { const a = l, b = unary(); count(); l = v => a(v) * b(v); continue; }
      return l;
    }
  }
  function unary(): Node {
    if (isOp('-')) { eat(); const a = unary(); count(); return v => -a(v); }
    if (isOp('+')) { eat(); return unary(); }
    if (isOp('!')) { eat(); const a = unary(); count(); return v => +!a(v); }
    return power();
  }
  function power(): Node {
    const base = atom();
    if (isOp('^')) { eat(); const exp = unary(); count(); return v => Math.pow(base(v), exp(v)); }
    return base;
  }
  function atom(): Node {
    const t = eat(); count();
    if (t.k === 'n') { const n = t.v; return () => n; }
    if (t.k === 'op' && t.v === '(') { const inner = ternary(); eat(')'); return inner; }
    if (t.k === 'id') {
      const name = t.v as string;
      // Own names only: "constructor", "toString" or "__proto__" are not functions, constants or variables here.
      const fn = Object.hasOwn(fns, name) ? fns[name] : undefined, isConst = Object.hasOwn(consts, name);
      // A known variable or constant before '(' multiplies: k(x-1), A(1-x), pi(r^2). mul() handles the '('.
      if (isOp('(') && (fn || !(allow?.has(name) || isConst))) {
        if (!fn) throw Error(`Unknown function ${name}()`);
        eat('(');
        const args: Node[] = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { eat(); args.push(ternary()); } }
        eat(')');
        if (args.length > 8) throw Error(`Too many arguments for ${name}()`);
        return v => fn(...args.map(a => a(v)));
      }
      if (allow ? !allow.has(name) && !isConst : false) throw Error(`Unknown name “${name}”`);
      names.add(name);
      if (isConst && !(allow?.has(name))) { const c = consts[name]; return () => c; }
      return v => { const x = Object.hasOwn(v, name) ? v[name] : undefined; if (x === undefined) { if (isConst) return consts[name]; throw Error(`Missing value for ${name}`); } return x; };
    }
    throw Error(`Unexpected “${t.v}” in expression`);
  }
  const root = ternary();
  if (p < toks.length) throw Error(`Unexpected “${toks[p].v}” in expression`);
  const fn = ((v: Vars) => root(v)) as Compiled;
  fn.names = [...names];
  return fn;
}

/** A number, or an expression string compiled against `allowed` names. */
export function numeric(value: number | string, allowed?: Iterable<string>): Compiled {
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('Numbers must be finite'); const f = Object.assign(() => value, { names: [] as string[] }); return f; }
  return compile(value, allowed);
}

/** Evaluate once; non-finite or failing results become NaN. */
export function safeEval(fn: Compiled, vars: Vars) {
  try { const r = fn(vars); return typeof r === 'number' ? r : NaN; } catch { return NaN; }
}
