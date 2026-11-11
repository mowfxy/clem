import { z } from 'zod';

/**
 * ```clem-card blocks: the JSON body of a card an assistant message carries (docs/GUC-VPS-ENGINE.md, docs/MAIN-THREAD.md).
 * Main-thread cards now; the GUC card types (course_link, save_rules, …) join this union in their step. A body that
 * does not match renders nothing.
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

export const clemCard = z.discriminatedUnion('type', [handoffCard, briefCard, reminderCard, digestCard]);
export type ClemCard = z.infer<typeof clemCard>;
export type HandoffCard = z.infer<typeof handoffCard>;

/** A card from its block's body, or null when it is not JSON or not a card this build knows. */
export function readCard(body: string): ClemCard | null {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return null; }
  const parsed = clemCard.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The fenced block for a card, as it is stored in a message. */
export const cardBlock = (card: ClemCard) => '```clem-card\n' + JSON.stringify(clemCard.parse(card)) + '\n```';
