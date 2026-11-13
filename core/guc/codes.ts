// GUC course codes in one canonical form, "CSEN 701": the CMS writes "(|CSEN701|)", the portal "CSEN 701 Tut", people
// "csen-701". Every parser, read, match and link compares through here, so the schedule, the CMS and subjects agree.

const CODE = /\b([A-Za-z]{2,5})\s?-?\s?(\d{3}[A-Za-z]?)\b/;

/** The first course code in `text`, as "CSEN 701", or "" when there is none. */
export function normCode(text: string) {
  const m = CODE.exec(text || "");
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : "";
}
/** `text` with its course code (if any) written the canonical way. */
export const withCode = (text: string) => (text || "").replace(CODE, (_, a: string, b: string) => `${a.toUpperCase()} ${b.toUpperCase()}`);
/** For comparing: "CSEN701", or the text itself (lowercased, no spaces) when it holds no code. */
export const codeKey = (text: string) => normCode(text).replace(" ", "") || (text || "").replace(/\s+/g, "").toLowerCase();
export const sameCode = (a: string, b: string) => !!a && !!b && codeKey(a) === codeKey(b);
/** Every course code in `text`, canonical and once each ("CSEN 301", "MATH 301"). */
export function codesIn(text: string) {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(new RegExp(CODE.source, "g"))) out.add(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
  return [...out];
}
