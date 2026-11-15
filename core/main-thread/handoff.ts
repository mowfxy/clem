import { routeMessage, scoreSpaces, type RouteSpace } from './route.ts';

/**
 * The main thread hands subject and project work to a chat of its own (docs/MAIN-THREAD.md "Hand-off"). A message that
 * clearly names one space is handed off by the window's rules (`routeMessage`) before the AI sees it; anything else is
 * the main-thread AI's call, through `clem.handoff`. Either way a NEW chat is opened in that space, run on the AI the
 * person used last, and its answer and files come back to the main thread (and to Telegram when they wrote from there).
 */
export const HANDOFF_ACTION = 'clem.handoff';

/** Said in every main-thread request (MAIN_THREAD_NOTE): byte-stable. */
export const HANDOFF_GUIDE = `Subject and project work happens in its own chat, not here. When the person asks a question or gives a task about the material of one of their subjects or projects (explain or solve something from it, summarize a lecture, make a PDF, slides, a document, flashcards, a quiz or a visual from it, help studying its content, work on a project), do not do it yourself: call {"kinetra":{"action":"clem.handoff","space":"<the subject or project, by name>","task":"<their request, complete and self-contained, in their words>"}}. Clem opens a new chat there, their latest AI does it with that space's files, and the result comes back to this thread by itself (and to Telegram when they wrote from there). Then reply with one short line ("On it in Circuits."), never the answer itself. One call per separate request. Naming a subject is never by itself a reason to hand off: only work on its material is ("plan my week for Math", "move my Chemistry revision to Thursday", "when is the Physics quiz" stay here). Keep here and answer yourself: their schedule, classes, deadlines, what an upcoming quiz, exam or assignment covers and when it is, grades, announcements, reminders, watches, routines, plans and study time, sending them a CMS file (guc.* and telegram.sendFile), settings, Telegram, small talk, and questions across several subjects. When you can't tell which subject it is, ask.`;

/** The organizer's own business: these stay in the main thread even when they name a subject ("remind me about the
 *  Circuits quiz", "stop telling me about new files in Math", "when is the Physics midterm"). */
const ORGANIZER = /\b(plan(s|ning|ned)?|re-?schedul\w*|postpone|move (my|the|it)|push (it |my |the )?(back|to)|revision (sessions?|slots?|time|blocks?)|study (blocks?|slots?|hours?)|block (out |off )?(\d|an? |some |time)|exam dates?|this week|next week|my week|remind(er|ers)?|alarm|watch (for|out)|keep an eye|ping me|tell me (when|if)|let me know (when|if)|notify|mute|unmute|stop (telling|sending|pinging)|undo|routine|schedule|timetable|calendar|study (time|sessions?|plan)|plan my|my plan|deadlines?|due|when (is|are|'s)|what time|which room|room|grades?|marks?|transcript|gpa|announcements?|mail|telegram|send me|settings?|quiet hours)\b/i;
/** Questions about their own assessments ("what's my quiz 2 math about", "what does the Circuits midterm cover") are
 *  read from the CMS here, not worked on in a subject chat. */
const ASSESSMENT = /\b(quiz(zes)?(?! me)|exams?|midterms?|finals?|tests?(?! me)|assignments?|assessments?)\b[^.?!\n]*\b(about|cover(s|ed|ing)?|includes?|weight|worth|format)\b|\bwhat('s| is| are)? on (my|the)\b/i;
export function organizerAsk(text: string) { return ORGANIZER.test(text) || ASSESSMENT.test(text); }

/** The window hands a message off by rule only when it asks for work on the material (explain, solve, make, draw…);
 *  a plain question that names a subject stays with the main-thread AI, which reads the CMS or calls clem.handoff. */
const WORK = /^\/\w+|\b(explain|solve|summari[sz]e|summary|make|create|generate|write|draft|draw|visuali[sz]e|plot|diagram|teach|walk me through|go (over|through)|help me|quiz me|test me|practi[cs]e|exercises?|flashcards?|slides?|pdf|outline|translate|prove|derive|calculate|compute|study guide|cheat ?sheet|worksheet)\b/i;
export function workAsk(text: string) { return WORK.test(text.trim()) && !organizerAsk(text); }

/** The window's rule before the AI sees a main-thread message (src/App.tsx `send`): the space it hands off to, or
 *  undefined to keep it here. Only work on a space's material is handed off, @mentioned or clearly named; merely naming
 *  a subject never is, and planning, scheduling, deadlines, reminders, grades and what an exam covers stay. */
export function handsOff(text: string, spaces: RouteSpace[], mentions: string[] = []): string | undefined {
  if (!workAsk(text)) return undefined;
  const route = routeMessage(text, spaces, { mentions });
  return route.kind === "handoff" ? route.spaceId : undefined;
}

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
