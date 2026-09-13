/**
 * Prompt injection defense.
 *
 * Treats retrieved text strictly as data. The sanitizer strips or escapes
 * control sequences that can be abused to override system instructions,
 * and detects well-known injection patterns so callers can refuse to feed
 * the source to the model.
 */

import { KinetraError } from "../errors.js";

const SUSPICIOUS_PATTERNS: RegExp[] = [
  /ignore (?:all )?(?:previous|prior) (?:instructions?|prompts?)/i,
  /disregard (?:the )?(?:system|above) (?:prompt|message)/i,
  /you are now (?:a|an|the) [^\n.]{1,60}/i,
  /reveal (?:your|the) (?:system|hidden) (?:prompt|instructions?)/i,
  /print (?:your|the) (?:system|initial) (?:prompt|message)/i,
  /<\s*system\s*>/i,
];

export interface SanitizationResult {
  text: string;
  hadInjection: boolean;
  patterns: string[];
}

/**
 * Strip control characters (except newlines), collapse excessive whitespace,
 * and mark suspiciously instruction-like phrases.
 */
export function sanitize(text: string): SanitizationResult {
  if (typeof text !== "string") {
    throw new KinetraError("validation", "sanitize() expects a string", { got: typeof text });
  }
  let out = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  // Neutralize markdown headings that pretend to be system messages.
  out = out.replace(/^#{1,6}\s*system\s*[:\-]/gim, "# ");
  const patterns: string[] = [];
  for (const pat of SUSPICIOUS_PATTERNS) {
    if (pat.test(out)) {
      patterns.push(pat.source);
      // Replace the trigger with a bracketed marker so the model can see
      // that the surrounding source was flagged, without obeying it.
      out = out.replace(pat, "[injection-flag]");
    }
  }
  return { text: out, hadInjection: patterns.length > 0, patterns };
}

/**
 * Hard refusal: throws if any pattern matches. Use when the caller cannot
 * tolerate even a flagged document reaching the model.
 */
export function assertSafe(text: string): void {
  const res = sanitize(text);
  if (res.hadInjection) {
    throw new KinetraError("security", "Source text contains prompt-injection markers", {
      patterns: res.patterns,
    });
  }
}

/**
 * Wraps user-controlled text in a clearly-labelled block so the model can
 * distinguish retrieved content from instructions.
 */
export function fenceAsContext(text: string, label: string = "source"): string {
  return `<<<${label}>>>\n${text}\n<<</${label}>>>`;
}
