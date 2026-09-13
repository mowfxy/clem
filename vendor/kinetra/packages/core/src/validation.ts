/**
 * Lightweight runtime validators. The library intentionally avoids depending
 * on Zod or similar to keep the bundle small and the behaviour explicit.
 * Each validator returns a structured error instead of throwing.
 */

import { KinetraError } from "./errors.js";

export interface Validator<T> {
  parse(value: unknown, path?: string): T;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function assertString(v: unknown, path: string): string {
  if (typeof v !== "string") {
    throw new KinetraError("validation", `Expected string at ${path}`, {
      path,
      got: typeof v,
    });
  }
  return v;
}

export function assertNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new KinetraError("validation", `Expected finite number at ${path}`, {
      path,
      got: v,
    });
  }
  return v;
}

export function assertInteger(v: unknown, path: string, opts: { min?: number; max?: number } = {}): number {
  const n = assertNumber(v, path);
  if (!Number.isInteger(n)) {
    throw new KinetraError("validation", `Expected integer at ${path}`, { path, value: n });
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new KinetraError("validation", `Value at ${path} below minimum ${opts.min}`, { path, value: n });
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new KinetraError("validation", `Value at ${path} above maximum ${opts.max}`, { path, value: n });
  }
  return n;
}

export function assertArray<T>(v: unknown, path: string, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) {
    throw new KinetraError("validation", `Expected array at ${path}`, { path });
  }
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

export function assertOneOf<T extends string>(v: unknown, opts: readonly T[], path: string): T {
  if (typeof v !== "string" || !opts.includes(v as T)) {
    throw new KinetraError("validation", `Expected one of ${opts.join(", ")} at ${path}`, {
      path,
      got: v,
    });
  }
  return v as T;
}

export function assertBoolean(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") {
    throw new KinetraError("validation", `Expected boolean at ${path}`, { path });
  }
  return v;
}

export function optionalString(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return assertString(v, path);
}

export function makeObjectValidator<T>(name: string, fields: Record<string, (v: unknown, p: string) => unknown>): (v: unknown) => T {
  return (v: unknown) => {
    if (!isPlainObject(v)) {
      throw new KinetraError("validation", `Expected object for ${name}`, { got: typeof v });
    }
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(fields)) {
      out[key] = validator(v[key], `${name}.${key}`);
    }
    return out as T;
  };
}
