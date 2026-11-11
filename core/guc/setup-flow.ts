// A subject's setup thread as a small state machine: which question comes next, what Clem says, and how a typed reply
// is read. It runs locally and instantly; only a reply it can't read goes to the AI (src/guc/setup.ts), whose JSON
// comes back through `readAiReply`. The state lives in the engine's subject_settings, so a restart resumes it.
import { cardBlock, type ClemCard } from "./cards.ts";
import { matchCourse, type MatchCourse } from "./match.ts";
import { NO, YES, parseSaveRules, SAVE_KINDS, type SaveRules } from "./rules.ts";
import { parseCheckSchedule, type CheckTime } from "./schedule-rules.ts";
import { checkSchema, type SettingsPatch } from "./settings.ts";

export const SETUP_STEPS = ["link", "save", "check", "drive", "storage"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export type SetupState = { done: Partial<Record<SetupStep, "answered" | "skipped">>; started: number; finished?: boolean };
/** `linked`: a CMS course is linked (save and check are about its files). `vps`: a VPS is connected (where files live). */
export type SetupContext = { linked: boolean; vps: boolean };

export const startSetup = (now: number, linked = false): SetupState => ({ done: linked ? { link: "answered" } : {}, started: now });
/** Storage is asked only with a VPS; save rules and checks only once a course is linked. */
export function applies(step: SetupStep, ctx: SetupContext) {
  if (step === "storage") return ctx.vps;
  if (step === "save" || step === "check") return ctx.linked;
  return true;
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
};
const b = (s: string) => `**${s}**`;
/** What Clem says for a step: one short question and its card. */
export function setupMessage(step: SetupStep | "done", i: SetupInfo) {
  const hi = i.first ? (i.linked && i.course ? `${b(i.course.code)} is linked to ${b(i.subject)}. A few quick questions and it's set.\n\n` : `Let's set up ${b(i.subject)}. A few quick questions, one at a time.\n\n`) : "";
  const card = (c: ClemCard) => "\n\n" + cardBlock(c);
  const id = i.subjectId;
  switch (step) {
    case "link": {
      const ask = i.course && i.sure ? `This looks like ${b(i.course.code)} (${i.course.name}) on CMS. Link it?`
        : i.course ? `Is this ${b(i.course.code)} (${i.course.name}) on CMS? Pick the right course below, or skip if it isn't on CMS.`
        : `I couldn't find ${b(i.subject)} among your CMS courses. Pick one below, or skip if it isn't on CMS.`;
      return hi + ask + card({ type: "course_link", subjectId: id, setup: true, ...(i.course && !i.linked ? { suggest: i.course.key } : {}) });
    }
    case "save": return hi + `What should I save from CMS? I'd keep ${i.save.toLowerCase()}. Change anything below, or just tell me.` + card({ type: "save_rules", subjectId: id, setup: true });
    case "check": return hi + `When should I check CMS for new files? ${i.check}.` + card({ type: "check_schedule", subjectId: id, setup: true });
    case "drive": return hi + "Should I also keep a copy of saved files in a Google Drive folder?" + card({ type: "drive_folder", subjectId: id, setup: true });
    case "storage": return hi + "Where should the files live, on this device or on your VPS?" + card({ type: "storage", subjectId: id, setup: true });
    default: return `All set${i.linked && i.course ? ` with ${b(i.course.code)}` : ""}. Change anything here or on the subject page, or just tell me (like "stop saving videos").` + card({ type: "setup_done", subjectId: id });
  }
}

export type Reply = { kind: "confirm" } | { kind: "skip" } | { kind: "link"; courseKey: string } | { kind: "settings"; patch: SettingsPatch } | { kind: "unknown" };
export type ReplyContext = { courses: MatchCourse[]; save: SaveRules; suggested: CheckTime[] };

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
    const r = parseSaveRules(t, ctx.save);
    return r ? { kind: "settings", patch: { save: r.rules } } : NO.test(t) ? { kind: "skip" } : { kind: "unknown" };
  }
  if (step === "check") {
    if (YES.test(t) && ctx.suggested.length) return { kind: "confirm" };
    const s = parseCheckSchedule(t, ctx.suggested);
    return s ? { kind: "settings", patch: { check: s } } : { kind: "unknown" };
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
  save: `What to save? {"action":"set","save":{${SAVE_KINDS.map((k) => `"${k}":true|false`).join(",")}}} giving only the kinds they mention, or {"action":"confirm"} to keep the suggestion.`,
  check: 'When to check? {"action":"set","check":{"mode":"custom","times":[{"day":0-6 (0 Sunday),"time":"HH:MM"}]}}, {"action":"set","check":{"mode":"off","times":[]}}, or {"action":"confirm"} for after each lecture.',
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
  if (step === "save" && json.save && typeof json.save === "object") {
    const kinds = Object.fromEntries(SAVE_KINDS.filter((k) => typeof json.save[k] === "boolean").map((k) => [k, json.save[k]]));
    return Object.keys(kinds).length ? { kind: "settings", patch: { save: { kinds } } } : { kind: "unknown" };
  }
  if (step === "check") { const c = checkSchema.safeParse({ tz: "Africa/Cairo", ...json.check }); return c.success ? { kind: "settings", patch: { check: c.data } } : { kind: "unknown" }; }
  if (step === "drive" && typeof json.drive?.enabled === "boolean") return { kind: "settings", patch: { drive: { enabled: json.drive.enabled } } };
  if (step === "storage" && ["device", "vps"].includes(json.storage?.location)) return { kind: "settings", patch: { storage: { location: json.storage.location } } };
  return { kind: "unknown" };
}

/** What Clem says when neither it nor the AI could read a reply. */
export const NOT_UNDERSTOOD: Record<SetupStep, string> = {
  link: "Sorry, I didn't catch which course. Pick it in the card above, or say skip.",
  save: 'Sorry, I didn\'t catch that. Tap what to keep in the card above, or say something like "only slides and assignments".',
  check: 'Sorry, I didn\'t catch the time. Try "after each lecture" or "every day at 8pm".',
  drive: "Should I copy files to Google Drive? Yes or no is fine.",
  storage: "On this device or on your VPS?",
};
