import { z } from 'zod';
import { aiSaveRules } from './rules.ts';
import { checkSchema } from './settings.ts';

/**
 * ```clem-card blocks: the JSON body of a card an assistant message carries (docs/GUC-VPS-ENGINE.md, docs/MAIN-THREAD.md).
 * Main-thread cards, and a subject's GUC cards: these name the subject and draw its live settings from the engine (never a
 * copy frozen in the message); `setup` marks the one the setup thread is asking about. A body that does not match
 * renders nothing.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);

/** A main-thread message continued in a subject's or project's chat. */
export const handoffCard = z.object({ type: z.literal('handoff'), spaceId: text(80), spaceName: text(120), spaceKind: z.enum(['subject', 'project']).optional(), chatId: text(80), title: text(160).optional(), reason: z.enum(['mention', 'match']).optional() });
/** The morning or evening brief. */
export const briefCard = z.object({ type: z.literal('brief'), title: text(120), when: z.enum(['morning', 'evening']).optional(), items: z.array(z.object({ text: text(300), time: text(20).optional(), space: text(120).optional() })).max(20) });
/** A deadline or task coming up. */
/** A deadline coming up, or a reminder the person set (`id`: it can be cancelled; `at`: when it rings, `repeat`;
 *  `rang`: this is it ringing, not being set). */
export const reminderCard = z.object({ type: z.literal('reminder'), title: text(200), due: day.optional(), space: text(120).optional(), spaceId: text(80).optional(), note: text(400).optional(), id: z.string().regex(/^r[\w-]{1,40}$/).optional(), at: day.optional(), repeat: z.enum(['daily', 'weekly']).optional(), rang: z.boolean().optional() });
/** A compact digest line of events from subjects and projects. */
export const digestCard = z.object({ type: z.literal('digest'), title: text(120).optional(), lines: z.array(z.object({ text: text(300), space: text(120).optional(), spaceId: text(80).optional() })).min(1).max(30) });

/** One organizer sweep (docs/MAIN-THREAD.md "Proactivity"): the brief's lines, and what Clem did or offers, each
 *  action line keyed so its Undo or one-tap confirm reads its live state from the engine's organizer_actions. */
export const organizerCard = z.object({
  type: z.literal('organizer'), title: text(120), when: z.enum(['morning', 'midday', 'evening', 'weekly', 'event', 'reminder', 'study']).optional(),
  lines: z.array(z.object({ text: text(300), key: text(200).optional(), space: text(120).optional(), time: text(20).optional(), href: z.string().regex(/^#\/app\/[\w\/%.:-]{0,200}$/).optional() })).min(1).max(30),
});
/** New lectures in a subject: one tap to summarize one or make flashcards from it (nothing is generated on its own). */
export const lectureCard = z.object({ type: z.literal('lecture'), subjectId: text(80), files: z.array(z.object({ id: z.string().regex(/^[\w-]{1,100}$/), name: text(300), saved: z.boolean().optional() })).min(1).max(10) });

/** Something the person asked Clem to watch for ("tell me when the midterm room is posted"), with Stop. */
export const watchCard = z.object({ type: z.literal('watch'), id: z.string().regex(/^[\w-]{1,80}$/), text: text(300), detail: text(300).optional() });
/** A routine Clem made from the person's words (core/proactivity/routines.ts): what starts it, what it does, its webhook
 *  URL when it has one, and Stop. */
export const routineCard = z.object({ type: z.literal('routine'), id: z.string().regex(/^rt[\w-]{4,40}$/), title: text(80), when: text(300), does: text(300).optional(), hook: z.string().max(400).optional() });

const subject = { subjectId: text(80), setup: z.boolean().optional() };
const courseKey = z.string().regex(/^\d{1,10}:\d{1,10}$/);
/** The subject's CMS course: Link / Change / Skip while unlinked (with the best guess), Open and Unlink once linked. */
export const courseLinkCard = z.object({ type: z.literal('course_link'), ...subject, suggest: courseKey.optional() });
export const saveRulesCard = z.object({ type: z.literal('save_rules'), ...subject });
export const checkScheduleCard = z.object({ type: z.literal('check_schedule'), ...subject });
export const driveFolderCard = z.object({ type: z.literal('drive_folder'), ...subject });
export const storageCard = z.object({ type: z.literal('storage'), ...subject });
/** The end of a setup thread: a summary of every setting, each editable. */
export const setupDoneCard = z.object({ type: z.literal('setup_done'), subjectId: text(80) });
/** A change the subject chat's AI made because the person asked ("stop saving videos"). Applied once, when the answer
 *  finishes (src/guc/setup.ts), through the same request a card's edit uses; then drawn as what changed. */
export const settingsUpdateCard = z.object({
  type: z.literal('settings_update'), subjectId: text(80).optional(),
  save: z.partialRecord(z.enum(['slides', 'assignments', 'sheets', 'videos', 'links', 'other']), z.boolean()).optional(),
  /** Kinds and filters together, through core/guc/rules.ts's strict schema. */
  rules: aiSaveRules.optional(),
  /** The person's own words, read by Clem's converters (core/guc/rules.ts, schedule-rules.ts) rather than the AI's guess. */
  saveText: text(300).optional(), checkText: text(300).optional(),
  check: checkSchema.extend({ times: checkSchema.shape.times.default([]), tz: z.string().max(60).optional() }).optional(),
  drive: z.object({ enabled: z.boolean() }).optional(),
  storage: z.object({ location: z.enum(['device', 'vps']) }).optional(),
  unlink: z.literal(true).optional(), checkNow: z.literal(true).optional(),
});
/** Files one check saved into the subject. Names are what CMS called them then; preview, open and summarize read the
 *  saved copy live. */
export const fileSavedCard = z.object({ type: z.literal('file_saved'), subjectId: text(80), files: z.array(z.object({ id: z.string().regex(/^[\w-]{1,100}$/), name: text(300), size: z.number().int().min(0).optional(), week: text(120).optional(), type: text(120).optional() })).min(1).max(50), more: z.number().int().min(0).optional() });
/** News a check found in the subject's course: an announcement, a grade, a deadline added or moved. */
const news = { subjectId: text(80).optional(), title: text(300), detail: text(1200).optional() };
export const announcementCard = z.object({ type: z.literal('announcement'), ...news, id: text(100), courseKey: courseKey.optional() });
export const gradeCard = z.object({ type: z.literal('grade'), ...news });
export const deadlineCard = z.object({ type: z.literal('deadline'), ...news, id: text(160), changed: z.boolean().optional() });
/** New courses a sync found that no subject is linked to (a new semester), posted in the main thread. */
export const newCoursesCard = z.object({ type: z.literal('new_courses'), courses: z.array(z.object({ key: courseKey, code: z.string().max(20), name: text(200) })).min(1).max(20) });

/** Pair Telegram from the main thread: the link, the code and its countdown, then "Connected as @name" with Unpair. Its
 *  state is read live from the account (never frozen in the message), so every copy of it shows the same thing. */
export const telegramPairCard = z.object({ type: z.literal('telegram_pair') });
/** GUC stopped accepting the password (docs/GUC-VPS-ENGINE.md "Password expiry"): Update password while it lasts, read
 *  live from the engine, so an old card says it works again once it does. */
export const gucPasswordCard = z.object({ type: z.literal('guc_password') });

/** "Move everything to my VPS" (up) or back (down) finished: how many files, and any left where they were. */
export const vpsMovedCard = z.object({ type: z.literal('vps_moved'), direction: z.enum(['up', 'down']), files: z.number().int().min(0), bytes: z.number().min(0), failed: z.number().int().min(0).optional() });
/** A VPS command or overwrite the AI asked for that waits for the person's tap (Run it / Cancel); the action itself
 *  stays in the main process under `id`. */
export const vpsConfirmCard = z.object({ type: z.literal('vps_confirm'), id: z.string().regex(/^[a-f0-9]{16}$/), action: z.enum(['run', 'write']), command: z.string().max(600).optional(), path: z.string().max(300).optional(), reason: z.string().max(200).optional() });

export const clemCard = z.discriminatedUnion('type', [handoffCard, briefCard, reminderCard, digestCard, organizerCard, lectureCard, watchCard, routineCard, courseLinkCard, saveRulesCard, checkScheduleCard, driveFolderCard, storageCard, setupDoneCard, settingsUpdateCard, newCoursesCard, fileSavedCard, announcementCard, gradeCard, deadlineCard, telegramPairCard, gucPasswordCard, vpsMovedCard, vpsConfirmCard]);
export type ClemCard = z.infer<typeof clemCard>;
export type HandoffCard = z.infer<typeof handoffCard>;
export type OrganizerCard = z.infer<typeof organizerCard>;
export type LectureCard = z.infer<typeof lectureCard>;
export type WatchCard = z.infer<typeof watchCard>;
export type RoutineCard = z.infer<typeof routineCard>;
export type SettingsUpdateCard = z.infer<typeof settingsUpdateCard>;
export type NewCoursesCard = z.infer<typeof newCoursesCard>;
export type FileSavedCard = z.infer<typeof fileSavedCard>;
export type NewsCard = z.infer<typeof announcementCard> | z.infer<typeof gradeCard> | z.infer<typeof deadlineCard>;

/** Every ```clem-card in a message, in order (the ones this build can't read are left out). */
export function cardsIn(content: string): ClemCard[] {
  return [...content.matchAll(/```clem-card\n([\s\S]*?)\n```/g)].map((m) => readCard(m[1])).filter((c): c is ClemCard => !!c);
}

/** A card from its block's body, or null when it is not JSON or not a card this build knows. */
export function readCard(body: string): ClemCard | null {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return null; }
  const parsed = clemCard.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The fenced block for a card, as it is stored in a message. */
export const cardBlock = (card: ClemCard) => '```clem-card\n' + JSON.stringify(clemCard.parse(card)) + '\n```';
