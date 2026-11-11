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
export const reminderCard = z.object({ type: z.literal('reminder'), title: text(200), due: day.optional(), space: text(120).optional(), spaceId: text(80).optional(), note: text(400).optional() });
/** A compact digest line of events from subjects and projects. */
export const digestCard = z.object({ type: z.literal('digest'), title: text(120).optional(), lines: z.array(z.object({ text: text(300), space: text(120).optional(), spaceId: text(80).optional() })).min(1).max(30) });

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

export const clemCard = z.discriminatedUnion('type', [handoffCard, briefCard, reminderCard, digestCard, courseLinkCard, saveRulesCard, checkScheduleCard, driveFolderCard, storageCard, setupDoneCard, settingsUpdateCard, newCoursesCard, fileSavedCard, announcementCard, gradeCard, deadlineCard]);
export type ClemCard = z.infer<typeof clemCard>;
export type HandoffCard = z.infer<typeof handoffCard>;
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
