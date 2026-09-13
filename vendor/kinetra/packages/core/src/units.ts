/**
 * Kinetra units system.
 *
 * A quantity is a (value, dimension) pair. Kinetra tracks dimensions as 7
 * SI base exponents (kg, m, s, A, K, mol, cd). Every other unit is a
 * derived linear combination of these exponents.
 *
 * Arithmetic operations verify dimension compatibility and refuse to
 * silently mix mismatched units.
 */

export type BaseDimension = "kg" | "m" | "s" | "A" | "K" | "mol" | "cd";

export type Dim = Readonly<Record<BaseDimension, number>>;

export function dim(parts: Partial<Record<BaseDimension, number>> = {}): Dim {
  return {
    kg: parts.kg ?? 0,
    m: parts.m ?? 0,
    s: parts.s ?? 0,
    A: parts.A ?? 0,
    K: parts.K ?? 0,
    mol: parts.mol ?? 0,
    cd: parts.cd ?? 0,
  };
}

export function dimEqual(a: Dim, b: Dim): boolean {
  for (const k of Object.keys(a) as BaseDimension[]) {
    if (Math.abs(a[k] - b[k]) > 1e-12) return false;
  }
  return true;
}

export function dimMul(a: Dim, b: Dim): Dim {
  return {
    kg: a.kg + b.kg,
    m: a.m + b.m,
    s: a.s + b.s,
    A: a.A + b.A,
    K: a.K + b.K,
    mol: a.mol + b.mol,
    cd: a.cd + b.cd,
  };
}

export function dimDiv(a: Dim, b: Dim): Dim {
  return {
    kg: a.kg - b.kg,
    m: a.m - b.m,
    s: a.s - b.s,
    A: a.A - b.A,
    K: a.K - b.K,
    mol: a.mol - b.mol,
    cd: a.cd - b.cd,
  };
}

export function dimPow(a: Dim, k: number): Dim {
  return {
    kg: a.kg * k,
    m: a.m * k,
    s: a.s * k,
    A: a.A * k,
    K: a.K * k,
    mol: a.mol * k,
    cd: a.cd * k,
  };
}

export function dimToString(d: Dim): string {
  const parts: string[] = [];
  for (const k of Object.keys(d) as BaseDimension[]) {
    const e = d[k];
    if (e === 0) continue;
    parts.push(e === 1 ? k : `${k}^${e}`);
  }
  return parts.length === 0 ? "dimensionless" : parts.join("*");
}

export interface UnitDef {
  /** Symbol, e.g. "m", "kg", "V". */
  symbol: string;
  /** Multiplier to convert a value expressed in this unit to the SI base. */
  toBase: number;
  /** Dimensional signature. */
  dim: Dim;
  /** Human readable name. */
  name: string;
}

export const UNITS: Record<string, UnitDef> = {
  // dimensionless
  "": { symbol: "", toBase: 1, dim: dim(), name: "dimensionless" },
  rad: { symbol: "rad", toBase: 1, dim: dim(), name: "radian" },
  deg: { symbol: "deg", toBase: Math.PI / 180, dim: dim(), name: "degree" },
  // length
  m: { symbol: "m", toBase: 1, dim: dim({ m: 1 }), name: "metre" },
  cm: { symbol: "cm", toBase: 1e-2, dim: dim({ m: 1 }), name: "centimetre" },
  mm: { symbol: "mm", toBase: 1e-3, dim: dim({ m: 1 }), name: "millimetre" },
  km: { symbol: "km", toBase: 1e3, dim: dim({ m: 1 }), name: "kilometre" },
  // time
  s: { symbol: "s", toBase: 1, dim: dim({ s: 1 }), name: "second" },
  ms: { symbol: "ms", toBase: 1e-3, dim: dim({ s: 1 }), name: "millisecond" },
  us: { symbol: "us", toBase: 1e-6, dim: dim({ s: 1 }), name: "microsecond" },
  ns: { symbol: "ns", toBase: 1e-9, dim: dim({ s: 1 }), name: "nanosecond" },
  min: { symbol: "min", toBase: 60, dim: dim({ s: 1 }), name: "minute" },
  h: { symbol: "h", toBase: 3600, dim: dim({ s: 1 }), name: "hour" },
  // mass
  kg: { symbol: "kg", toBase: 1, dim: dim({ kg: 1 }), name: "kilogram" },
  g: { symbol: "g", toBase: 1e-3, dim: dim({ kg: 1 }), name: "gram" },
  mg: { symbol: "mg", toBase: 1e-6, dim: dim({ kg: 1 }), name: "milligram" },
  // current
  A: { symbol: "A", toBase: 1, dim: dim({ A: 1 }), name: "ampere" },
  mA: { symbol: "mA", toBase: 1e-3, dim: dim({ A: 1 }), name: "milliampere" },
  uA: { symbol: "uA", toBase: 1e-6, dim: dim({ A: 1 }), name: "microampere" },
  // electric potential
  V: { symbol: "V", toBase: 1, dim: dim({ kg: 1, m: 2, s: -3, A: -1 }), name: "volt" },
  mV: { symbol: "mV", toBase: 1e-3, dim: dim({ kg: 1, m: 2, s: -3, A: -1 }), name: "millivolt" },
  kV: { symbol: "kV", toBase: 1e3, dim: dim({ kg: 1, m: 2, s: -3, A: -1 }), name: "kilovolt" },
  // charge
  C: { symbol: "C", toBase: 1, dim: dim({ A: 1, s: 1 }), name: "coulomb" },
  // resistance
  ohm: { symbol: "ohm", toBase: 1, dim: dim({ kg: 1, m: 2, s: -3, A: -2 }), name: "ohm" },
  kohm: { symbol: "kohm", toBase: 1e3, dim: dim({ kg: 1, m: 2, s: -3, A: -2 }), name: "kiloohm" },
  Mohm: { symbol: "Mohm", toBase: 1e6, dim: dim({ kg: 1, m: 2, s: -3, A: -2 }), name: "megaohm" },
  // capacitance / inductance
  F: { symbol: "F", toBase: 1, dim: dim({ kg: -1, m: -2, s: 4, A: 2 }), name: "farad" },
  uF: { symbol: "uF", toBase: 1e-6, dim: dim({ kg: -1, m: -2, s: 4, A: 2 }), name: "microfarad" },
  nF: { symbol: "nF", toBase: 1e-9, dim: dim({ kg: -1, m: -2, s: 4, A: 2 }), name: "nanofarad" },
  pF: { symbol: "pF", toBase: 1e-12, dim: dim({ kg: -1, m: -2, s: 4, A: 2 }), name: "picofarad" },
  H: { symbol: "H", toBase: 1, dim: dim({ kg: 1, m: 2, s: -2, A: -2 }), name: "henry" },
  mH: { symbol: "mH", toBase: 1e-3, dim: dim({ kg: 1, m: 2, s: -2, A: -2 }), name: "millihenry" },
  // force, energy, power
  N: { symbol: "N", toBase: 1, dim: dim({ kg: 1, m: 1, s: -2 }), name: "newton" },
  J: { symbol: "J", toBase: 1, dim: dim({ kg: 1, m: 2, s: -2 }), name: "joule" },
  W: { symbol: "W", toBase: 1, dim: dim({ kg: 1, m: 2, s: -3 }), name: "watt" },
  mW: { symbol: "mW", toBase: 1e-3, dim: dim({ kg: 1, m: 2, s: -3 }), name: "milliwatt" },
  kW: { symbol: "kW", toBase: 1e3, dim: dim({ kg: 1, m: 2, s: -3 }), name: "kilowatt" },
  // frequency / angular
  Hz: { symbol: "Hz", toBase: 1, dim: dim({ s: -1 }), name: "hertz" },
  kHz: { symbol: "kHz", toBase: 1e3, dim: dim({ s: -1 }), name: "kilohertz" },
  MHz: { symbol: "MHz", toBase: 1e6, dim: dim({ s: -1 }), name: "megahertz" },
  GHz: { symbol: "GHz", toBase: 1e9, dim: dim({ s: -1 }), name: "gigahertz" },
  radps: { symbol: "rad/s", toBase: 1, dim: dim({ s: -1 }), name: "radians per second" },
  // magnetic
  T: { symbol: "T", toBase: 1, dim: dim({ kg: 1, s: -2, A: -1 }), name: "tesla" },
  // temperature
  K: { symbol: "K", toBase: 1, dim: dim({ K: 1 }), name: "kelvin" },
  Cdeg: { symbol: "C", toBase: 1, dim: dim({ K: 1 }), name: "celsius" },
};

export interface Quantity {
  value: number;
  unit: string;
  dim: Dim;
}

export function quantity(value: number, unit: string): Quantity {
  const def = UNITS[unit];
  if (!def) {
    throw new Error(`Unknown unit: ${unit}`);
  }
  return { value, unit, dim: def.dim };
}

export function quantitySi(value: number, dim: Dim): Quantity {
  return { value, unit: "", dim };
}

export function convert(q: Quantity, toUnit: string): Quantity {
  const from = UNITS[q.unit];
  const to = UNITS[toUnit];
  if (!from) throw new Error(`Unknown source unit: ${q.unit}`);
  if (!to) throw new Error(`Unknown target unit: ${toUnit}`);
  if (!dimEqual(from.dim, to.dim)) {
    throw new Error(`Incompatible dimensions: ${dimToString(from.dim)} -> ${dimToString(to.dim)}`);
  }
  return { value: (q.value * from.toBase) / to.toBase, unit: toUnit, dim: to.dim };
}

export function addQ(a: Quantity, b: Quantity): Quantity {
  if (!dimEqual(a.dim, b.dim)) {
    throw new Error(`Cannot add ${dimToString(a.dim)} and ${dimToString(b.dim)}`);
  }
  const inA = UNITS[a.unit]!.toBase;
  const inB = UNITS[b.unit]!.toBase;
  const sum = a.value * inA + b.value * inB;
  const outUnit = a.unit || b.unit;
  return { value: sum / UNITS[outUnit]!.toBase, unit: outUnit, dim: a.dim };
}

export function subQ(a: Quantity, b: Quantity): Quantity {
  if (!dimEqual(a.dim, b.dim)) {
    throw new Error(`Cannot subtract ${dimToString(a.dim)} and ${dimToString(b.dim)}`);
  }
  return addQ(a, quantity(-b.value, b.unit));
}

export function mulQ(a: Quantity, b: Quantity): Quantity {
  return {
    value: a.value * b.value,
    unit: a.unit && b.unit ? `${a.unit}*${b.unit}` : a.unit || b.unit,
    dim: dimMul(a.dim, b.dim),
  };
}

export function divQ(a: Quantity, b: Quantity): Quantity {
  if (b.value === 0) throw new Error("Division by zero quantity");
  return {
    value: a.value / b.value,
    unit: a.unit && b.unit ? `${a.unit}/${b.unit}` : a.unit || b.unit,
    dim: dimDiv(a.dim, b.dim),
  };
}

export function scaleQ(a: Quantity, k: number): Quantity {
  return { value: a.value * k, unit: a.unit, dim: a.dim };
}

export function isCompatible(a: Quantity, b: Quantity): boolean {
  return dimEqual(a.dim, b.dim);
}
