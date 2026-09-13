/**
 * A tiny Result type for functions that should not throw across the public
 * surface. Most Kinetra code throws concrete errors for catastrophic cases
 * and returns Result for recoverable validation flows.
 */

import { KinetraError } from "./errors.js";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: KinetraError };
export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(
  code: ConstructorParameters<typeof KinetraError>[0],
  message: string,
  detail: Record<string, unknown> = {},
): Err {
  return { ok: false, error: new KinetraError(code, message, detail) };
}

export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw r.error;
}

export function map<T, U>(r: Result<T>, fn: (v: T) => U): Result<U> {
  return r.ok ? ok(fn(r.value)) : r;
}
