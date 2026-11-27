import { scoreSpaces, type RouteSpace } from './route.ts';

/**
 * The main thread hands subject and project work to a chat of its own (docs/MAIN-THREAD.md "Hand-off"). The main-thread
 * AI decides, always: no rule hands a message off before it answers (owner, 2026-11-27: "the AI controls everything").
 * The window gives it the spaces the message may be about (`spaceHints`) and the ones the person @mentioned, and the AI
 * calls `clem.handoff`. A NEW chat is opened in that space, run on the AI the person used last, and its answer and files
 * come back to the main thread (and to Telegram when they wrote from there).
 */
export const HANDOFF_ACTION = 'clem.handoff';

/** Said in every main-thread request (MAIN_THREAD_NOTE): byte-stable. */
export const HANDOFF_GUIDE = `Subject and project work happens in its own chat, not here. When the person asks a question or gives a task about the material of one of their subjects or projects (explain or solve something from it, summarize a lecture, make a PDF, slides, a document, flashcards, a quiz or a visual from it, help studying its content, work on a project), do not do it yourself: call {"kinetra":{"action":"clem.handoff","space":"<the subject or project, by name>","task":"<their request, complete and self-contained, in their words>"}}. Clem opens a new chat there, their latest AI does it with that space's files, and the result comes back to this thread by itself (and to Telegram when they wrote from there). Then reply with one short line ("On it in Circuits."), never the answer itself. One call per separate request. Naming a subject is never by itself a reason to hand off: only work on its material is ("plan my week for Math", "move my Chemistry revision to Thursday", "when is the Physics quiz" stay here). Keep here and answer yourself: their schedule, classes, deadlines, what an upcoming quiz, exam or assignment covers and when it is, grades, announcements, reminders, watches, routines, plans and study time, sending them a CMS file (guc.* and telegram.sendFile), settings, Telegram, small talk, and questions across several subjects. When you can't tell which subject it is, ask. A subject or project the person @mentioned is their own choice of space: hand its work off there (or answer here with its files when it isn't work on its material), never to another one.`;

/** What the main-thread AI is told with a message about the spaces it may be about: the ones the person @mentioned (their
 *  choice) and the ones its words name most surely (`scoreSpaces`). Context only: the AI decides whether to hand off. */
export function spaceHints(text: string, spaces: RouteSpace[], mentions: string[] = []): string {
  const named = (id: string) => spaces.find((s) => s.id === id);
  const mentioned = mentions.map(named).filter((s): s is RouteSpace => !!s);
  const likely = scoreSpaces(text, spaces).filter((c) => c.score >= 0.5 && !mentions.includes(c.spaceId)).slice(0, 3)
    .map((c) => named(c.spaceId)).filter((s): s is RouteSpace => !!s);
  const label = (s: RouteSpace) => `"${s.name}" (${s.kind})`;
  return [
    mentioned.length ? `The person @mentioned ${mentioned.map(label).join(" and ")} in this message: their choice of space. If it is work on its material, hand it off there.` : "",
    likely.length ? `Spaces this message may be about, by their names in it: ${likely.map(label).join(", ")}. Hand off only when it asks for work on that space's material.` : "",
  ].filter(Boolean).join(" ");
}

/** What only the main thread can do, asked in a subject or project chat (owner, 2026-11-16: "any message asked to a
 *  normal thread that only the main thread can answer… sends a message to main thread"). The chat's AI decides, through
 *  `clem.toMain` (src/App.tsx toMainTool); no rule sends a message up before it answers. Byte-stable. */
export const TO_MAIN_ACTION = 'clem.toMain';
export const TO_MAIN_GUIDE = `This chat is one subject or project; the person's main thread is their organizer. When they ask here for something that is the main thread's (a reminder, an alarm, a watch, muting or unmuting news, a routine, quiet hours, Telegram, undoing what Clem did by itself, Coming up and deadlines, their schedule, classes or rooms, grades, announcements, what an upcoming quiz, exam or assignment covers and when it is, study time across their week) and you have no tool for it here, call {"kinetra":{"action":"clem.toMain","task":"<their request, complete and self-contained, in their words>"}}. The main thread does it with its own tools and its answer is shown in this chat too. Then reply with one short line ("I sent that to your main thread; its answer will show up here."), never the answer itself. Work on this space's material (explain, solve, summarize, make a file, flashcards, a quiz, a visual) always stays here, and so does anything you can do yourself.`;
/** What clem.toMain answers when the main thread can take it. */
export const SENT_UP = "That's one for your main thread, so I sent it there. The answer will show up there and here.";

/** The space a `clem.handoff` names: its id, its exact name, a course code, or one clearly closest by name. */
export function resolveSpace<T extends RouteSpace>(name: string, spaces: T[]): T | undefined {
  const q = (name || '').trim();
  if (!q) return undefined;
  const exact = spaces.find((s) => s.id === q) || spaces.find((s) => s.name.trim().toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const [best, next] = scoreSpaces(q, spaces);
  if (!best || best.score < 0.6 || (next && best.score - next.score < 0.1)) return undefined;
  return spaces.find((s) => s.id === best.spaceId);
}

type ChatLike = { kind?: 'main'; temporary?: boolean; archived?: unknown; setup?: unknown; model?: string; reasoning?: string; updated: number };
/** The AI the person used last: the model of their most recently active chat (not the main thread, whose model is the
 *  organizer's) that is still connected. Falls back to `fallback` (the default model). */
export function lastUsedModel(chats: ChatLike[], connected: (model: string) => boolean, fallback: { model: string; reasoning?: string }) {
  const last = chats.filter((c) => c.kind !== 'main' && !c.temporary && !c.archived && !c.setup && c.model && connected(c.model))
    .sort((a, b) => b.updated - a.updated)[0];
  return last ? { model: last.model!, reasoning: last.reasoning || undefined } : fallback;
}

/** A new chat's first title, from the task (the model names it properly when it answers). */
export function taskTitle(task: string) {
  const line = task.replace(/^\/\w+\s*/, '').replace(/\s+/g, ' ').trim();
  return line.length > 70 ? line.slice(0, 69).trimEnd() + '…' : line || 'New chat';
}

/** What a finished hand-off brings back to the main thread: the subject chat's answer (the files it made come with it,
 *  as attachments), or a short line when it ended without one. Visuals and figures are not brought: the main thread
 *  says they are done and the person opens the chat to see them. */
const VISUAL_FENCE = /```(?:visual|kinetra)[^\S\n]*\n[\s\S]*?```/g;
export function broughtText(answer: string | undefined, space: string) {
  const full = (answer || '').trim(), text = full.replace(VISUAL_FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text !== full) return `${text ? text + '\n\n' : ''}Done: the visual is in the ${space} chat. Open it to see it.`;
  return text || `The chat in ${space} ended without an answer. Open it to see what happened.`;
}
/** The main-thread message a finished hand-off posts (src/App.tsx finishHandoff): the answer's words without its
 *  visuals, and the files the work made (PDF, Word, slides, sheets) as the message's own attachments. */
export function broughtMessage(reply: { content?: string; attachments?: string[] } | undefined, space: string) {
  const attachments = reply?.attachments || [];
  return { content: broughtText(reply?.content, space), ...(attachments.length ? { attachments } : {}) };
}
