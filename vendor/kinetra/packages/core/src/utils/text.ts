/** Small text utilities shared by ingestion, retrieval, and output layers. */

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function tokenize(s: string): string[] {
  return normalizeWhitespace(s.toLowerCase())
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean);
}

export function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}

export function truncate(s: string, n: number, suffix = "..."): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - suffix.length)) + suffix;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

/** Reject suspicious control characters used in prompt injection attempts. */
export function stripControlChars(s: string, opts: { keepNewlines?: boolean } = {}): string {
  return s.replace(opts.keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
}
