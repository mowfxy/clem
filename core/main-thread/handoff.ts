import { scoreSpaces, type RouteSpace } from './route.ts';

/**
 * The main thread hands subject and project work to a chat of its own (docs/MAIN-THREAD.md "Hand-off"). The main-thread
 * AI decides, always: no rule hands a message off before it answers (owner, 2026-11-27: "the AI controls everything").
 * The window gives it the spaces the message may be about (`spaceHints`) and the ones the person @mentioned, and the AI
 * calls `clem.handoff`, once per place a message belongs (several subjects or projects get several calls). It continues
 * the space's thread that is about the same topic (`thread`, from `spaceThreads`) or opens a new one, runs it on that
 * thread's AI (a new one on the AI the person used last), and the answer and files come back to the main thread.
 * A subject or project chat can post into another thread of its own space the same way (SPACE_POST_GUIDE).
 */
export const HANDOFF_ACTION = 'clem.handoff';

/** Said in every main-thread request (MAIN_THREAD_NOTE): byte-stable. */
export const HANDOFF_GUIDE = `Subject and project work happens in its own chats, not here. When the person asks a question or gives a task about the material of one of their subjects or projects (explain or solve something from it, summarize a lecture, make a PDF, slides, a document, flashcards, a quiz or a visual from it, help studying its content, work on a project), do not do it yourself: call {"kinetra":{"action":"clem.handoff","space":"<the subject or project, by name>","thread":"<the id of its thread to continue, or leave out for a new one>","task":"<their request, complete and self-contained, in their words>"}}. Not every request needs a new thread: when one of that space's threads is clearly about the same topic or work (the threads of the spaces this message may be about are listed with it; {"kinetra":{"action":"clem.threads","space":"<name>"}} lists any space's), continue it with its id; open a new one only when none fits. Clem runs it there with that space's files, and the result comes back to this thread by itself. Then reply with one short line ("On it in Circuits."), never the answer itself. A message about several subjects or projects gets one call per place, each with its own part of the request; one call per separate request. Naming a subject is never by itself a reason to hand off: only work on its material is ("plan my week for Math", "move my Chemistry revision to Thursday", "when is the Physics quiz" stay here). Keep here and answer yourself: their schedule, classes, deadlines, what an upcoming quiz, exam or assignment covers and when it is, grades, announcements, reminders, watches, routines, plans and study time, sending them a CMS file (guc.* and telegram.sendFile), settings, Telegram, small talk, and questions across several subjects. When you can't tell which subject it is, ask. A subject or project the person @mentioned is their own choice of space: hand its work off there (or answer here with its files when it isn't work on its material), never to another one.`;

/** What the main-thread AI is told with a message about the spaces it may be about: the ones the person @mentioned (their
 *  choice) and the ones its words name most surely (`scoreSpaces`). Context only: the AI decides whether to hand off. */
export function spaceHints(text: string, spaces: RouteSpace[], mentions: string[] = [], threads?: (spaceId: string) => string): string {
  const named = (id: string) => spaces.find((s) => s.id === id);
  const mentioned = mentions.map(named).filter((s): s is RouteSpace => !!s);
  const likely = scoreSpaces(text, spaces).filter((c) => c.score >= 0.5 && !mentions.includes(c.spaceId)).slice(0, 3)
    .map((c) => named(c.spaceId)).filter((s): s is RouteSpace => !!s);
  const label = (s: RouteSpace) => `"${s.name}" (${s.kind})`;
  return [
    mentioned.length ? `The person @mentioned ${mentioned.map(label).join(" and ")} in this message: their choice of space. If it is work on its material, hand it off there.` : "",
    likely.length ? `Spaces this message may be about, by their names in it: ${likely.map(label).join(", ")}. Hand off only when it asks for work on that space's material.` : "",
  ].filter(Boolean).join(" ") + (threads ? [...mentioned, ...likely].map((s) => { const list = threads(s.id); return list ? `\nThreads in "${s.name}" (newest first):\n${list}` : ""; }).join("") : "");
}

/** A thread of a subject or project, as the AI sees it when choosing where work goes. */
export type ThreadInfo = { id: string; title: string; updated: number; gist: string };
type ThreadChat = { id: string; title: string; spaceId?: string | null; kind?: 'main'; temporary?: boolean; archived?: unknown; setup?: unknown; updated: number; summary?: string; messages: { role: string; content: string }[] };
/** A space's threads a hand-off can continue: not archived, temporary or a setup thread, newest first. The gist is the
 *  chat's summary, else its latest request. */
export function spaceThreads(chats: ThreadChat[], spaceId: string, { exclude, limit = 6 }: { exclude?: string; limit?: number } = {}): ThreadInfo[] {
  return chats.filter((c) => c.spaceId === spaceId && c.kind !== 'main' && !c.temporary && !c.archived && !c.setup && c.id !== exclude && c.messages.length)
    .sort((a, b) => b.updated - a.updated).slice(0, limit)
    .map((c) => {
      const asked = [...c.messages].reverse().find((m) => m.role === 'user')?.content || '';
      const gist = (c.summary || asked).replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
      return { id: c.id, title: c.title.trim() || 'Untitled', updated: c.updated, gist: gist.length > 140 ? gist.slice(0, 139).trimEnd() + '…' : gist };
    });
}
const ago = (ms: number) => ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} d ago`;
/** One line a thread, for the AI: its id (what `thread` takes), title, last activity and gist. */
export function threadLines(threads: ThreadInfo[], now = Date.now()) {
  return threads.map((t) => `- ${t.id}: "${t.title}" (${ago(now - t.updated)})${t.gist ? ` · ${t.gist}` : ''}`).join('\n');
}

/** Said in a subject or project chat that has other threads (src/App.tsx): it can post into one of them. Byte-stable. */
export const SPACE_POST_GUIDE = `This subject or project has other threads, listed below with their ids. When part of the person's request belongs in one of them (it continues that thread's own work, or they ask you to send it there), call {"kinetra":{"action":"clem.handoff","thread":"<its id>","task":"<that part, complete and self-contained>"}}: it runs in that thread with its history, and its answer comes back here by itself; then say so in one short line. "thread":"new" opens a new thread in this space, only when the person wants the work kept apart. Everything else you answer here yourself, as usual.`;

/** The note a handed message carries: where it came from, then the last few turns there (`carriedNote`). Shown folded
 *  above the message and sent to the receiving AI as data. */
export function carriedFrom(where: string, note: string) {
  return `Sent here from ${where}.${note ? `\nWhat was said there just before:\n${note}` : ''}`;
}

/** The folded note's label above a handed message: where it came from. Notes from before `carriedFrom` came from the
 *  main thread. */
export function carriedLabel(carried: string) {
  const from = /^Sent here from ([^\n]*?)\.(?:\s|$)/.exec(carried)?.[1];
  if (!from || /main thread$/.test(from)) return 'From your main thread';
  const thread = /^their "(.*)" thread(?: in (.+))?$/.exec(from);
  return thread ? `From “${thread[1]}”${thread[2] ? ` in ${thread[2]}` : ''}` : `From ${from}`;
}

/** What a finished hand-off brings back to the chat that passed it: the receiving thread's first answer after the very
 *  message the hand-off sent (`user`, its id), never an older answer of that thread. When that message never reached the
 *  thread (Clem offline, no AI connected), `ran` is false and the line says so with the request, so nothing is lost. */
export function handoffResult(messages: { id: string; role: string; content: string; attachments?: string[] }[], user: string, name: string, task: string) {
  const at = messages.findIndex((m) => m.id === user);
  if (at < 0) return { ran: false as const, content: `I couldn't pass this to ${name}: it never reached it (Clem was offline, or no AI was connected). What you asked: “${task.length > 300 ? task.slice(0, 299) + '…' : task}”. Ask again and I'll send it.` };
  const reply = messages.slice(at + 1).find((m) => m.role === 'assistant');
  return { ran: true as const, ...broughtMessage(reply, name) };
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
