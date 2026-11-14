// What Clem says when it says it by rules (docs/MAIN-THREAD.md "Proactivity" → "Plain messages"): a clean sentence for
// every kind of change, a deadline reminder that knows a quiz from an assignment, a reminder ringing, what Clem did on
// its own, and the one closing line that names new files. Used when there is no model, when the model gave no words
// for an item, or when its words named something it was not given. Never a raw event title, never a system's
// boilerplate ("[EXTERNAL EMAIL]", "DO NOT REPLY"). Pure.
import { cairo } from "../guc/hub.ts";
import { dayText, type ProAction } from "./actions.ts";
import type { Change } from "./attention.ts";
import { dueAt, type Deadline } from "./rules.ts";

export type SayContext = { now: number; name: (id?: string) => string | undefined; deadlines?: Deadline[] };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** "CSEN301" → "CSEN 301". */
export const spacedCode = (code?: string) => (code ? squash(code).replace(/^([A-Za-z]{2,5})\s*(\d{3}\w?)\b/, (_, a: string, b: string) => `${a.toUpperCase()} ${b}`) : undefined);
const CODE = /\b([A-Z]{2,5})\s?(\d{3})\b/;

/** The longest run of whole sentences of `text` within `max` characters (line breaks read as " / "); a first sentence
 *  longer than that is cut at a word, with "…". */
export function sentences(text: string, max = 300) {
  const t = squash(text.replace(/\s*\n+\s*/g, " / "));
  // A preview GUC already cut ("…after 10 min of ...") ends at its last whole sentence too.
  const cut = /(?:\.\.\.|…)$/.test(t);
  if (t.length <= max && !cut) return t;
  if (cut) max = Math.min(max, t.length - 1);
  let end = 0;
  for (const m of t.matchAll(/[.!?](?=\s+["“(\[]?[A-Z0-9]|\s*$)/g)) { if (m.index! + 1 > max) break; end = m.index! + 1; }
  if (end >= 20) return t.slice(0, end);
  const part = t.slice(0, max - 1), sp = part.lastIndexOf(" ");
  return (sp > max / 2 ? part.slice(0, sp) : part).replace(/[\s,;:/·.-]+$/, "") + "…";
}
/** A post's prose: its first paragraph when that says something (a table of times below it is the model's to read). */
const prose = (text: string) => { const first = text.trim().split(/\n/)[0].trim(); return first.length >= 40 ? first : text; };
const GREETING = /^(?:dears?|dear (?:all|students?|colleagues|everyone)|hi(?: all| everyone)?|hello(?: all| everyone)?|good (?:morning|afternoon|evening)(?: all| everyone)?)\s*[,.!:]\s*/i;
const AUTOMATED = /notification|no-?reply|do not reply|\bsystem\b|mailer|daemon|\badmin\b|\bportal\b|\bcms\b/i;
/** A mail as Clem would retell it: who wrote (unless a system did), its course and its subject, without the
 *  boilerplate GUC's mail system adds. */
export function cleanMail(title: string) {
  const m = /^Email from (.*?):\s+([\s\S]*)$/.exec(title.trim());
  const sender = squash((m ? m[1] : "").replace(/\s*\(do not reply\)/i, "").replace(/\s*<[^>]*>$/, ""));
  let subject = squash(m ? m[2] : title)
    .replace(/\[EXTERNAL EMAIL\]\s*[-–:]?\s*/gi, "").replace(/^(?:GUC\s+)?Notification System\s*:\s*/i, "")
    .replace(/\s*\[Group:[^\]]*(?:\]|…|$)\s*$/i, "").replace(/^(?:re|fwd?)\s*:\s*/i, "").trim();
  const code = CODE.exec(subject);
  let course: string | undefined;
  if (code && code.index! <= 2) { course = `${code[1]} ${code[2]}`; subject = subject.slice(code.index! + code[0].length).replace(/^\s*[-:–,·]\s*/, "").trim(); }
  return { sender: sender && !AUTOMATED.test(sender) ? sender : undefined, course, subject };
}

/** The course a change is about, as the person would name it: its code when GUC gave one, else its subject's name. */
const courseOf = (c: Change, x: SayContext) => spacedCode(c.code) || (CODE.exec(c.title) ? `${CODE.exec(c.title)![1]} ${CODE.exec(c.title)![2]}` : undefined) || x.name(c.subjectId);
const end = (s: string) => (/[.!?…)"”]$/.test(s.trim()) ? s.trim() : s.trim() + ".");

const ON = /\b(quiz(?:zes)?|exams?|midterms?|finals?|in-?class|test|presentation|lab)\b/i;
const hm12 = (hm: string) => { const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
/** "today", "tomorrow", "on Monday", "on Mon, Nov 23", and " at 3:45 pm" when the time is known. */
export function whenText(at: number, now: number, bare = false) {
  const day = cairo(at).ymd, today = cairo(now).ymd, n = Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  const d = n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 && n < 7 ? "on " + new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) : "on " + dayText(day);
  return bare ? d : `${d} at ${hm12(cairo(at).time)}`;
}
/** A deadline's sentence: a quiz or exam "is on" (with its room when GUC said it), an assignment "is due". `left`: a
 *  reminder this close says how close. */
export function deadlineText(d: Deadline, now: number, name: (id?: string) => string | undefined = () => undefined, o: { left?: number; moved?: boolean } = {}) {
  const course = spacedCode(d.code) || name(d.spaceId), title = squash(d.title);
  const what = course && !title.toLowerCase().includes(course.toLowerCase()) && !title.toLowerCase().replace(/\s/g, "").includes(course.toLowerCase().replace(/\s/g, "")) ? `${course} ${title}` : title;
  const at = dueAt(d.due), bare = /^\d{4}-\d{2}-\d{2}$/.test(d.due), sat = d.kind ? !/^(assignment|project|other)$/i.test(d.kind) : ON.test(title);
  const place = (sat && d.place ? ` in ${d.place}` : "") + (d.either ? ` (${squash(d.either)})` : "");
  const time = bare ? "" : hm12(cairo(at).time);
  if (o.left !== undefined && o.left < 6 * 3600e3 && !(bare && sat)) {
    const h = Math.max(1, Math.round(o.left / 3600e3)), soon = o.left < 3600e3 ? "in under an hour" : `in ${h} hour${h === 1 ? "" : "s"}`;
    return `${what} ${sat ? "is" : "is due"} ${soon}${time ? `, at ${time}` : ""}${place}.`;
  }
  return `${what}${o.moved ? " moved: it" : ""} ${sat ? "is" : "is due"} ${whenText(at, now, bare)}${place}.`;
}

/** A change in plain words, by rules. Never the raw event title of a mail or an announcement. */
export function plainText(c: Change, x: SayContext): string {
  const course = courseOf(c, x);
  switch (c.kind) {
    case "new_mail": {
      const m = cleanMail(c.title), on = m.course || course, body = sentences(prose(c.detail.replace(GREETING, "")), 300);
      const head = [on, m.subject].filter(Boolean).join(", ") + (m.sender ? ` (from ${m.sender})` : "");
      return body ? `${head || "A new email"}: ${body}` : end(head || "You have a new email");
    }
    case "new_announcement": {
      const body = sentences(prose(c.detail.replace(GREETING, "")), 300);
      return body ? `${course || "Your course"}: ${end(body)}` : `${course ? course + " posted" : "There's"} a new announcement.`;
    }
    case "deadline_added": case "deadline_changed": {
      const d = x.deadlines?.find((y) => y.id === c.key.split(":")[1]);
      if (d) return deadlineText(d, x.now, x.name, { moved: c.kind === "deadline_changed" });
      return end(c.title.replace(/:\s*due\s+/, " is due "));
    }
    case "new_grade": {
      const mark = c.detail.split(" · ").pop()?.trim() || "";
      const grade = /^(?:Midterm )?Grade out:\s*(.*)$/i.exec(c.title);
      if (grade) return `Your ${/^Midterm/i.test(c.title) ? grade[1] + " midterm" : grade[1]} grade is out${mark ? ` (${mark})` : ""}.`;
      return `${c.title.replace(/^New mark in /, "New mark in ")}${mark ? ` (${mark})` : ""}.`;
    }
    case "exam_posted": {
      const e = /^Exam seat (posted|changed):\s*(.*)$/i.exec(c.title);
      return e ? `Your ${e[2]} exam seat ${e[1].toLowerCase() === "posted" ? "is out" : "changed"}: ${end(c.detail)}` : end(`${c.title}: ${c.detail}`);
    }
    case "slot_moved": { const at = /·\s*(\S.*)$/.exec(c.detail)?.[1]; return end(`${c.title}${at ? " in " + at : ""}`); }
    case "slot_added": return end(`${c.title}${c.detail ? " in " + c.detail : ""}`);
    case "room_changed": case "slot_cancelled": return end(c.title);
    case "new_material": case "file_saved": return end(`New in ${course || "your course"}: ${fileName(c)}`);
    case "schedule_changed": return "Your timetable changed.";
    // A routine's own kinds ("new_course").
    default: return end(c.detail ? `${c.title}: ${sentences(c.detail, 200)}` : c.title);
  }
}
const fileName = (c: Change) => squash(c.title.replace(/^(?:New in [^:]+|Saved[^:]*):\s*/, "")).slice(0, 80);

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${WORDS[n] || n} ${many}`);
/** The one closing line for routine news, by course: "Also up: Chapter 18 slides in Physics III and two new files in
 *  Math 301." New files are named (two at most a course), other routine posts counted. Undefined when there is none. */
export function alsoLine(items: Change[], x: SayContext) {
  const by = new Map<string, { files: string[]; posts: number }>();
  for (const c of items) {
    const k = x.name(c.subjectId) || courseOf(c, x) || "your courses", g = by.get(k) || { files: [], posts: 0 };
    if (c.kind === "new_material" || c.kind === "file_saved") g.files.push(fileName(c)); else g.posts++;
    by.set(k, g);
  }
  const parts = [...by].slice(0, 3).map(([k, g]) => {
    const files = g.files.length <= 2 ? g.files.join(" and ") : count(g.files.length, "new file", "new files");
    const posts = g.posts ? count(g.posts, "new post", "new posts") : "";
    return `${[files, posts].filter(Boolean).join(" and ")} in ${k}`;
  });
  if (!parts.length) return undefined;
  const more = by.size > 3 ? `, and more in ${count(by.size - 3, "other course", "other courses")}` : "";
  return `Also up: ${parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0]}${more}.`;
}

/** What Clem did on its own, as words in a sentence: "moved “Start: Assignment 2” to Sun, Nov 15". Notes are said
 *  as they are, not here. */
export function didPhrase(a: ProAction, name: (id?: string) => string | undefined) {
  const plan = (id?: string) => (name(id) ? `your ${name(id)} plan` : "your plan");
  switch (a.type) {
    case "plan_task": return a.milestone ? `marked “${a.title}” on ${dayText(a.due!)} in ${plan(a.spaceId)}` : `added “${a.title}” to ${plan(a.spaceId)}${a.due ? ` for ${dayText(a.due)}${a.time ? " at " + a.time : ""}` : ""}`;
    case "time_block": return `set ${a.time} ${dayText(a.day)} aside for “${a.title}”`;
    case "plan_move": return `moved “${a.title}” to ${dayText(a.due)}${a.time ? " at " + a.time : ""}`;
    case "revision_plan": return `planned ${count(a.sessions.length, "revision session", "revision sessions")} before the ${name(a.spaceId) || ""} exam on ${dayText(a.examDate)}`.replace(/the {2}exam/, "the exam");
    case "file_move": return `filed ${a.name} in ${name(a.spaceId) || "its subject"}`;
    case "memory": return `noted that ${a.text.replace(/\.$/, "")}`;
    case "automation": return `can make “${a.name}” a ${a.schedule} routine at ${a.time}`;
    case "note": return a.text;
  }
}
/** "I moved … and filed …." for a few actions; undefined for none. */
export function didText(actions: ProAction[], name: (id?: string) => string | undefined) {
  const xs = actions.filter((a) => a.type !== "note").map((a) => didPhrase(a, name));
  if (!xs.length) return undefined;
  const shown = xs.slice(0, 4), more = xs.length - shown.length;
  return `I ${shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown.at(-1) : shown[0]}${more ? `, and ${count(more, "other change", "other changes")} to your plans` : ""}.`;
}

/** A reminder the person set, ringing: "Reminder: call the TA about the lab." */
export const reminderText = (text: string) => `Reminder: ${end(squash(text).replace(/^remind me to\s+/i, ""))}`;
