/**
 * Kinetra error model. Every recoverable failure should be a KinetraError
 * so callers can branch on `.code` without parsing strings.
 */

export type KinetraErrorCode =
  | "validation"
  | "unsupported"
  | "io"
  | "parse"
  | "missing"
  | "conflict"
  | "timeout"
  | "internal"
  | "provider"
  | "security";

export class KinetraError extends Error {
  readonly code: KinetraErrorCode;
  readonly detail: Record<string, unknown>;
  constructor(
    code: KinetraErrorCode,
    message: string,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "KinetraError";
    this.code = code;
    this.detail = detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      detail: this.detail,
    };
  }
}

export function isKinetraError(e: unknown): e is KinetraError {
  return e instanceof KinetraError;
}

export function asKinetraError(e: unknown): KinetraError {
  if (isKinetraError(e)) return e;
  if (e instanceof Error) {
    return new KinetraError("internal", e.message, { cause: e.message });
  }
  return new KinetraError("internal", String(e), { value: e });
}
