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

/** A class group as the student says it: "3MIET T014" → T14 (tutorial 14), "L002" → L2 (lecture 2), "P014" → P14 (lab
 *  14); tolerant of "3 IET&MET II CPS T040" (T40). The last T/L/P number in the text wins; undefined when there is none. */
export function shortGroup(group: string): { kind: "T" | "L" | "P"; n: number; label: string } | undefined {
  const all = [...(group || "").matchAll(/(?:^|[^A-Za-z])([TLPtlp])\s?0*(\d{1,3})(?!\d)/g)];
  const m = all.at(-1);
  if (!m) return undefined;
  const kind = m[1].toUpperCase() as "T" | "L" | "P", n = Number(m[2]);
  return { kind, n, label: kind + n };
}
const GROUP_KIND: Record<string, string> = { T: "tutorial", L: "lecture", P: "lab" };
/** "tutorial group T14", "lecture group 2", "lab group P14". */
export const groupWords = (g: { kind: string; n: number; label: string }) => g.kind === "L" ? `lecture group ${g.n}` : `${GROUP_KIND[g.kind]} group ${g.label}`;

/** Whether a line of a post names the group: "T14", "T13 - T17", "T11,T12,T14" and "T 13–17" all include T14. */
export function groupIn(text: string, g: { kind: string; n: number }) {
  const k = g.kind;
  for (const m of (text || "").matchAll(new RegExp(String.raw`(?:^|[^A-Za-z])${k}\s?0*(\d{1,3})(?:\s*(?:-|–|—|to)\s*(?:${k}\s?)?0*(\d{1,3}))?(?!\d)`, "gi"))) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (g.n >= Math.min(a, b) && g.n <= Math.max(a, b) && Math.abs(b - a) <= 60) return true;
  }
  return false;
}
