// A subject's setup thread as a small state machine: which question comes next, what Clem says, and how a typed reply
// is read. It runs locally and instantly; only a reply it can't read goes to the AI (src/guc/setup.ts), whose JSON
// comes back through `readAiReply`. The state lives in the engine's subject_settings, so a restart resumes it.
import type { ClemCard, SettingsUpdateCard } from "./cards.ts";
import { TZ } from "./hub.ts";
import { matchCourse, type MatchCourse } from "./match.ts";
import { AI_RULES_FORMAT, aiSaveRules, NO, YES, convertSaveRules, describeSaveRules, fromAi, rulesPatch, SAVE_KINDS, SAVE_LABELS, type SaveKind, type SaveRules } from "./rules.ts";
import { convertCheckSchedule, describeChecks, type CheckTime, type ScheduleContext } from "./schedule-rules.ts";
import { checkSchema, type SettingsPatch } from "./settings.ts";

export const SETUP_STEPS = ["link", "save", "check", "drive", "storage"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type SetupState = { done: Partial<Record<SetupStep, "answered" | "skipped">>; started: number; finished?: boolean };
/** `linked`: a CMS course is linked (save and check are about its files). `vps`: a VPS is connected (where files live). */
export type SetupContext = { linked: boolean; vps: boolean };

/** Already linked (made from a course, or a sure match): there is nothing to ask, so it starts finished. */
export const startSetup = (now: number, linked = false): SetupState => ({ done: linked ? { link: "answered" } : {}, started: now, ...(linked ? { finished: true } : {}) });
/** Setup asks one thing, and only when Clem can't tell: which CMS course the subject is. What to keep isn't asked per
 *  subject: every subject starts from what the person said for all their courses (ALL_SUBJECTS), and Clem says what
 *  that is. When to check, the Drive copy and storage keep their defaults until the person says otherwise in chat. */
export function applies(step: SetupStep, _ctx: SetupContext) {
  return step === "link";
}
/** The first step not yet answered or skipped that applies, or null when setup is done. */
export function nextStep(state: SetupState, ctx: SetupContext): SetupStep | null {
  return SETUP_STEPS.find((s) => !state.done[s] && applies(s, ctx)) ?? null;
}
/** Marks `step` answered or skipped. Changing an earlier answer later (a card, a message) keeps the flow where it is. */
export function answer(state: SetupState, step: SetupStep, how: "answered" | "skipped", ctx: SetupContext): SetupState {
  const done = { ...state.done, [step]: state.done[step] === "answered" ? "answered" : how };
  const next = { ...state, done };
  return nextStep(next, ctx) ? next : { ...next, finished: true };
}
/** After a restart: the question still to post (its card isn't in the thread yet), "done" for the closing note, or null. */
export function toPost(state: SetupState, ctx: SetupContext, posted: (SetupStep | "done")[]): SetupStep | "done" | null {
  const next = nextStep(state, ctx);
  if (next) return posted.includes(next) ? null : next;
  return posted.includes("done") ? null : "done";
}

const CARD_STEP: Partial<Record<ClemCard["type"], SetupStep>> = { course_link: "link", save_rules: "save", check_schedule: "check", drive_folder: "drive", storage: "storage" };
/** The setup step a card of the thread asks, or "done" for the closing summary. */
export const stepOfCard = (card: ClemCard): SetupStep | "done" | undefined => (card.type === "setup_done" ? "done" : "setup" in card && card.setup ? CARD_STEP[card.type] : undefined);

export type SetupInfo = {
  subjectId: string; subject: string;
  /** The linked course, or the best guess at it. */
  course?: { key: string; code: string; name: string }; linked: boolean; sure?: boolean; others?: number;
  save: string; check: string; first?: boolean;
  /** "Store my files on my VPS" is on: files go there, so the step only says so. */
  vpsFiles?: boolean;
  /** This term's other courses, for a link question with no sure match ("CSEN 301 Data Structures"). */
  choices?: string[];
  /** Said before the question ("Linked to **CSEN 301**."). */
  lead?: string;
};
const b = (s: string) => `**${s}**`;
/** What Clem says for a step, as plain chat text: no cards to tap, the person answers in their own words. */
export function setupMessage(step: SetupStep | "done", i: SetupInfo) {
  const course = i.course ? `${b(i.course.code)} (${i.course.name})` : "";
  switch (step) {
    case "link": {
      const list = i.choices?.length ? `

This term on CMS you have: ${i.choices.slice(0, 12).join(", ")}.` : "";
      if (i.course) return `Is ${b(i.subject)} ${course} on CMS? Tell me yes, or which course it is instead, or that it isn't on CMS.` + list;
      return `Which CMS course is ${b(i.subject)}? Just tell me its code or name, or that it isn't on CMS.` + list;
    }
    case "save": case "check": case "drive": case "storage": return "";
    // Nothing is asked: Clem says what it does, and how to change it.
    default: return i.linked && i.course
      ? `${i.lead || `${b(i.subject)} is linked to ${course}.`} I watch it on CMS every few minutes: I keep ${i.save.toLowerCase()} the moment they're posted, and tell you here about its announcements, grades and deadlines.

Want something else kept? Just say it ("everything", "no videos", "only PDFs"), for this course or for all of them.`
      : `Okay, ${b(i.subject)} stays off CMS. You can link it any time from its CMS tab, or tell me its course code.`;
  }
}

/** `ask`: something only the person knows (an exam date); Clem says `text` and waits. */
export type Reply = { kind: "confirm" } | { kind: "skip" } | { kind: "link"; courseKey: string } | { kind: "settings"; patch: SettingsPatch } | { kind: "ask"; text: string } | { kind: "unknown" };
export type ReplyContext = { courses: MatchCourse[]; save: SaveRules; suggested: CheckTime[] } & Omit<ScheduleContext, "suggested">;

/** A typed reply to the current step, read locally: yes, skip, a course, or the setting it describes. */
export function readReply(step: SetupStep, text: string, ctx: ReplyContext): Reply {
  const t = text.trim();
  if (!t) return { kind: "unknown" };
  if (/^(skip|not now|later|maybe later|pass|next)\b/i.test(t)) return { kind: "skip" };
  if (step === "link") {
    if (YES.test(t) || /^link( it)?\b/i.test(t)) return { kind: "confirm" };
    if (NO.test(t) || /\b(not on cms|isn't on cms|no cms)\b/i.test(t)) return { kind: "skip" };
    const m = matchCourse({ name: t.replace(/^(it'?s|it is|link( it)? to|use|the)\s+/i, "") }, ctx.courses);
    return m.best && m.sure ? { kind: "link", courseKey: m.best.item.key } : { kind: "unknown" };
  }
  if (step === "save") {
    if (YES.test(t)) return { kind: "confirm" };
    const r = convertSaveRules(t, ctx.save);
    return !("needsAI" in r) ? { kind: "settings", patch: { save: rulesPatch(r.rules) } } : NO.test(t) ? { kind: "skip" } : { kind: "unknown" };
  }
  if (step === "check") {
    if (YES.test(t) && ctx.suggested.length) return { kind: "confirm" };
    const s = convertCheckSchedule(t, ctx);
    return "mode" in s ? { kind: "settings", patch: { check: s } } : "ask" in s ? { kind: "ask", text: s.ask } : { kind: "unknown" };
  }
  if (step === "drive") {
    if (YES.test(t) || /\b(turn (it )?on|enable|sync( it)?|yes please)\b/i.test(t)) return { kind: "settings", patch: { drive: { enabled: true } } };
    if (NO.test(t) || /\b(off|disable|don't|do not|no drive)\b/i.test(t)) return { kind: "settings", patch: { drive: { enabled: false } } };
    return { kind: "unknown" };
  }
  if (/\b(vps|server|cloud)\b/i.test(t)) return { kind: "settings", patch: { storage: { location: "vps" } } };
  if (/\b(device|computer|laptop|pc|here|local(ly)?|this one)\b/i.test(t) || YES.test(t)) return { kind: "settings", patch: { storage: { location: "device" } } };
  return { kind: "unknown" };
}

const ASK: Record<SetupStep, string> = {
  link: 'Which CMS course is it? {"action":"link","course":"<key from the list>"} or {"action":"skip"}.',
  save: `What to save? {"action":"set","rules":${AI_RULES_FORMAT}}, or {"action":"confirm"} to keep the suggestion.`,
  check: 'When to check? {"action":"set","check":{"mode":"custom","times":[{"day":0-6 (0 Sunday),"time":"HH:MM"}],"every":{"minutes":N (30 or more),"from":"HH:MM","to":"HH:MM","days":[0-6]} (only for a repeat),"during":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} (only for a date range)}}, {"action":"set","check":{"mode":"off","times":[]}}, or {"action":"confirm"} for after each lecture. At GUC "weekdays" are Saturday to Thursday (6,0,1,2,3,4).',
  drive: 'Copy to Google Drive? {"action":"set","drive":{"enabled":true|false}}.',
  storage: 'Where files live? {"action":"set","storage":{"location":"device"|"vps"}}.',
};
/** The side request for a reply `readReply` couldn't read: what the step asks and the JSON to answer with. */
export function interpretPrompt(step: SetupStep, text: string, courses: MatchCourse[]) {
  const list = step === "link" ? "\nCourses:\n" + courses.slice(0, 40).map((c) => `${c.key}: ${c.code} ${c.name}`).join("\n") : "";
  return [
    { role: "system", content: `You read one reply in a short setup chat for a university subject in Clem. Times are Africa/Cairo. Answer with JSON only, no prose. If the reply doesn't answer the question, return {"action":"unknown"}. If they want to skip, {"action":"skip"}.\nQuestion: ${ASK[step]}${list}` },
    { role: "user", content: text.slice(0, 600) },
  ];
}
/** The AI's JSON for `step` as a reply, or unknown when it isn't one. */
export function readAiReply(step: SetupStep, json: any, courses: MatchCourse[]): Reply {
  const a = json?.action;
  if (a === "skip") return { kind: "skip" };
  if (a === "confirm") return { kind: "confirm" };
  if (step === "link" && a === "link") return courses.some((c) => c.key === json.course) ? { kind: "link", courseKey: json.course } : { kind: "unknown" };
  if (a !== "set") return { kind: "unknown" };
  if (step === "save" && json.rules && typeof json.rules === "object") { const r = aiSaveRules.safeParse(json.rules); return r.success && Object.keys(r.data).length ? { kind: "settings", patch: { save: r.data } } : { kind: "unknown" }; }
  if (step === "save" && json.save && typeof json.save === "object") {
    const kinds = Object.fromEntries(SAVE_KINDS.filter((k) => typeof json.save[k] === "boolean").map((k) => [k, json.save[k]]));
    return Object.keys(kinds).length ? { kind: "settings", patch: { save: { kinds } } } : { kind: "unknown" };
  }
  if (step === "check") { const c = checkSchema.safeParse({ tz: "Africa/Cairo", ...json.check }); return c.success ? { kind: "settings", patch: { check: c.data } } : { kind: "unknown" }; }
  if (step === "drive" && typeof json.drive?.enabled === "boolean") return { kind: "settings", patch: { drive: { enabled: json.drive.enabled } } };
  if (step === "storage" && ["device", "vps"].includes(json.storage?.location)) return { kind: "settings", patch: { storage: { location: json.storage.location } } };
  return { kind: "unknown" };
}

/** A settings_update block as the settings patch it makes, through the same converters a typed reply uses: the person's
 *  words (saveText, checkText) are read by Clem; structured fields pass the strict schemas; what doesn't read is left out. */
export function updatePatch(u: SettingsUpdateCard, ctx: { save?: SaveRules } & ScheduleContext = {}): SettingsPatch {
  const words = u.saveText ? convertSaveRules(u.saveText, ctx.save) : undefined, when = u.checkText ? convertCheckSchedule(u.checkText, ctx) : undefined;
  const save = words && !("needsAI" in words) ? rulesPatch(words.rules) : u.rules || u.save ? { ...u.rules, ...(u.save || u.rules?.kinds ? { kinds: { ...u.rules?.kinds, ...u.save } } : {}) } : undefined;
  const check = when && "mode" in when ? when : u.check ? { ...u.check, times: u.check.mode === "off" ? [] : u.check.times, tz: TZ } : undefined;
  return {
    ...(save ? { save } : {}),
    ...(check ? { check } : {}),
    ...(u.drive ? { drive: u.drive } : {}),
    ...(u.storage ? { storage: u.storage } : {}),
  };
}
/** "Stopped saving videos", "Saving links too", "Checks: Every day at 21:00", "Unlinked from CMS". */
export function updateSummary(u: SettingsUpdateCard) {
  const list = (ks: string[]) => ks.map((k) => SAVE_LABELS[k as SaveKind].toLowerCase()).join(" and ");
  const off = Object.entries(u.save || {}).filter(([, v]) => !v).map(([k]) => k), on = Object.entries(u.save || {}).filter(([, v]) => v).map(([k]) => k);
  const parts = [
    on.length ? `Saving ${list(on)} too` : "", off.length ? `Stopped saving ${list(off)}` : "",
    u.rules || u.saveText ? "Save rules updated" : "", u.checkText ? "Checks updated" : "",
    u.check ? (u.check.mode === "off" ? "Checks turned off" : u.check.mode === "after_lectures" ? "Checking after each lecture" : `Checks: ${describeChecks({ ...u.check, tz: TZ })}`) : "",
    u.drive ? `Drive copy turned ${u.drive.enabled ? "on" : "off"}` : "", u.storage ? `Files now live ${u.storage.location === "vps" ? "on your VPS" : "on this device"}` : "",
    u.unlink ? "Unlinked from CMS" : "", u.checkNow ? "Checking CMS now" : "",
  ].filter(Boolean);
  return (parts.join(" · ") || "No change") + (u.everywhere && parts.length ? " · for all your courses" : "");
}

/** What Clem says when neither it nor the AI could read a reply. */
export const NOT_UNDERSTOOD: Record<SetupStep, string> = {
  link: "I couldn't tell which course you mean. Try its code (like CSEN 301), or say it isn't on CMS.",
  save: 'I didn\'t quite get what to keep. Something like "everything", "only slides and assignments" or "no videos" works.',
  check: 'Sorry, I didn\'t catch the time. Try "after each lecture" or "every day at 8pm".',
  drive: "Should I copy files to Google Drive? Yes or no is fine.",
  storage: "On this device or on your VPS?",
};
