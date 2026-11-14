// Who a GUC mail is for. The university sends the same message to every student, about courses most of them don't
// take, so a new mail is news for this student only when it is clearly theirs: it names a course they are enrolled in
// this term, or it was written to them alone. Everything else stays in the hub's Mail tab and is never told, pushed or
// judged by the model. Rules only, no model. Pure.
import { codeKey, codesIn } from "./codes.ts";
import type { GucCourse, GucMail } from "./types.ts";

export type MailAbout =
  | { about: "course"; courseKey: string; code: string }
  | { about: "personal" }
  /** `other`: it names courses, none of them theirs. */
  | { about: "everyone"; other?: true };

/** Senders that write to lists, never to one person. */
const BULK = /no-?reply|do not reply|notif(y|ication)|newsletter|mailer|bounce|updates?[.@]|news[.@]|marketing/i;
/** A recipient that is a list, not a person. */
const LIST = /\b(students?|all|everyone|group|staff|faculty|undisclosed|list|class|batch|members)\b/i;
const NOT_CODES = new Set(["IMAGE", "EXT", "TEL", "FAX", "ROOM", "HALL", "EGP", "USD", "EUR", "LE", "NO", "ID", "PM", "AM", "BOX", "IMG", "REF"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);

/** The courses the student takes now: the active ones of the newest term. */
export function enrolled(courses: GucCourse[]) {
  const latest = Math.max(0, ...courses.map((c) => c.seasonId));
  return courses.filter((c) => c.active && c.seasonId === latest);
}

/** `username`: the GUC sign-in name ("first.last"), which is how Clem knows a message names the student. */
export function mailAbout(m: Pick<GucMail, "from" | "subject" | "preview" | "to">, o: { courses: GucCourse[]; username?: string }): MailAbout {
  const mine = enrolled(o.courses), text = `${m.subject} ${m.preview || ""}`;
  // A course code decides it: one of theirs makes it that course's news; only other courses' codes make it not theirs.
  const codes = codesIn(text);
  for (const code of codes) { const c = mine.find((x) => codeKey(x.code) === codeKey(code)); if (c) return { about: "course", courseKey: c.key, code: c.code }; }
  // Another course's code is written in capitals ("AE 301", "CSEN501"); "image001", "Ext 123" and prices are not codes.
  if ([...text.matchAll(/\b([A-Z]{2,5})\s?-?\s?\d{3}[A-Za-z]?\b/g)].some((x) => !NOT_CODES.has(x[1]))) return { about: "everyone", other: true };
  // No code: the course's full name in the subject line is as clear.
  const subject = m.subject.toLowerCase();
  for (const c of mine) { const name = c.name.replace(/\([^)]*\)/g, "").trim().toLowerCase(); if (name.length >= 10 && subject.includes(name)) return { about: "course", courseKey: c.key, code: c.code }; }
  if (BULK.test(m.from)) return { about: "everyone" };
  const me = words((o.username || "").replace(/^.*\\/, "").replace(/@.*$/, ""));
  // Written to one person, and that person is the student.
  if (m.to !== undefined) {
    const to = m.to.split(";").map((x) => x.trim()).filter(Boolean);
    if (to.length !== 1 || LIST.test(to[0])) return { about: "everyone" };
    const names = new Set(words(to[0]));
    return !me.length || me.every((w) => names.has(w)) ? { about: "personal" } : { about: "everyone" };
  }
  // A message kept before recipients were read: it greets the student by name, or answers a message they wrote.
  const first = me[0];
  if (first && new RegExp(`^\\W*(hello|hi|hey|dear)\\s+${first}\\b|\\bOn [^.]{6,60}, ${first}\\b`, "i").test(m.preview || "")) return { about: "personal" };
  return { about: "everyone" };
}
