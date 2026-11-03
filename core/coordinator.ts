/**
 * A project's coordinator: the person talks to it, and it opens threads with subagents it starts for parts of the work.
 * Each subagent gets a role the coordinator names and a brief; the models and thinking levels come from the project's
 * settings. Replies carry a few directives on their own lines, read here and never shown:
 *
 *   [[react: 👍]]                           react to the message being answered (alone: a reaction instead of a reply)
 *   [[thread: Researcher | Title | Brief]]  open a thread with a subagent in that role ([[delegate: …]] is read the same)
 *   [[remember: launch, dates | Fact]]      keep a fact in the project's memory file (core/project-memory.ts)
 *   [[recall: words]]                       look something up in that file before answering
 *   [[summary: One sentence]]               (subagents) what the thread produced, for the coordinator's later turns
 *
 * Only what each turn needs is sent: the last few messages, one-line outcomes of threads instead of their text, and the
 * memory lines that match. Threads run at the same time; their reports come back for one closing reply.
 */
import type { ProjectRoom, ProjectTeam, ProjectThread, Reaction, RoomMessage, Space } from "./types";
import { entry, memoryLines, recall, remember, type MemoryEntry } from "./project-memory.ts";

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🤔", "🙏"];

export const teamOf = (space: Space): ProjectTeam => space.team || {};
export const emptyRoom = (spaceId: string): ProjectRoom => ({ spaceId, messages: [], threads: [] });

/** A subagent's name as shown: the role the coordinator gave it (older threads stored a lower-case id like "researcher"). */
export const roleName = (role: string) => {
  const r = role.trim() || "Subagent";
  return /^[a-z][a-z-]*(-\d+)?$/.test(r) ? r.replace(/-\d+$/, "").replace(/^./, (c) => c.toUpperCase()).replace(/-/g, " ") : r;
};

/** Model and thinking for the coordinator and for subagents; subagents follow the coordinator unless set apart. */
export function modelsOf(team: ProjectTeam, fallback?: string) {
  const coordinator = { model: team.coordinatorModel || fallback, effort: team.coordinatorEffort };
  return { coordinator, agent: team.agentModel ? { model: team.agentModel, effort: team.agentEffort } : { model: coordinator.model, effort: team.agentEffort ?? coordinator.effort } };
}
export type Run = { model?: string; effort?: string };

// ---------------------------------------------------------------- directives

export type Directives = {
  react?: string;
  delegate: { agent: string; title: string; task: string }[];
  remember: { tags: string[]; text: string }[];
  recall: string[];
  summary?: string;
};
const DIRECTIVE = /\[\[\s*(react|delegate|thread|remember|recall|summary)\s*:\s*([\s\S]*?)\]\]/gi;
const isEmoji = (s: string) => /^\p{Extended_Pictographic}/u.test(s) && s.length <= 8;

/** The text to show and the directives in a reply. While streaming, a directive still being written is hidden too. */
export function readReply(raw: string, streaming = false): { text: string; directives: Directives } {
  const d: Directives = { delegate: [], remember: [], recall: [] };
  let text = raw.replace(DIRECTIVE, (_, kind: string, body: string) => {
    const value = body.trim();
    switch (kind.toLowerCase()) {
      case "react": { const e = value.split(/\s+/)[0]; if (isEmoji(e)) d.react = e; break; }
      case "thread": case "delegate": {
        const parts = value.split("|").map((s) => s.trim());
        // Role | Title | Brief; Title | Brief and a bare brief work too.
        const [agent, title, ...rest] = parts.length >= 3 ? parts : parts.length === 2 ? ["Subagent", ...parts] : ["Subagent", "", parts[0]];
        const task = rest.join(" | ").trim() || title || "";
        if (task) d.delegate.push({ agent: (agent || "Subagent").slice(0, 40), title: (title || task).slice(0, 80), task: task.slice(0, 6000) });
        break;
      }
      case "remember": {
        const cut = value.indexOf("|");
        const tags = cut > 0 ? value.slice(0, cut).split(/[\s,]+/).filter(Boolean) : [];
        const fact = (cut > 0 ? value.slice(cut + 1) : value).trim();
        if (fact) d.remember.push({ tags, text: fact });
        break;
      }
      case "recall": if (value) d.recall.push(value.slice(0, 200)); break;
      case "summary": if (value) d.summary = value.slice(0, 300); break;
    }
    return "";
  });
  if (streaming) { const open = text.lastIndexOf("[["); if (open >= 0 && !text.slice(open).includes("]]")) text = text.slice(0, open); }
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), directives: d };
}

// ---------------------------------------------------------------- what each request carries

type Turn = { role: "system" | "user" | "assistant"; content: string };
const HISTORY_CHARS = 7000, HISTORY_COUNT = 14, REPORT_CHARS = 5000;

const nameOf = (by: string) => by === "you" ? "the person" : by === "coordinator" ? "you" : roleName(by);
const reactionNote = (reactions: Reaction[] | undefined) => reactions?.length ? `\n(reactions: ${reactions.map((r) => `${nameOf(r.by)} ${r.emoji}`).join(", ")})` : "";

/** The newest messages that fit, oldest first; each coordinator message notes its threads' one-line outcomes. */
export function coordinatorHistory(room: ProjectRoom, chars = HISTORY_CHARS, count = HISTORY_COUNT): Turn[] {
  const out: Turn[] = [];
  let room_ = chars;
  for (let i = room.messages.length - 1; i >= 0 && out.length < count; i--) {
    const m = room.messages[i];
    if (m.status === "writing") continue;
    const threads = (m.threads || []).map((id) => room.threads.find((t) => t.id === id)).filter((t): t is ProjectThread => !!t)
      .map((t) => `\n(thread ${t.id.slice(0, 6)} · ${roleName(t.agent)} · "${t.title}" · ${t.status}${t.summary ? ": " + t.summary : ""})`).join("");
    let content = (m.content || (m.reactions?.some((r) => r.by === "coordinator") ? "(you reacted instead of replying)" : "")) + threads + reactionNote(m.reactions);
    if (!content.trim()) continue;
    if (content.length > room_) { if (out.length) break; content = content.slice(-room_); }
    room_ -= content.length;
    out.unshift({ role: m.from === "you" ? "user" : "assistant", content });
  }
  return out;
}

function projectBlock(space: Space) {
  return [`Project: ${space.name}`, space.description && `About it: ${space.description.slice(0, 600)}`, space.memory.trim() && `The person's instructions for this project (follow them):\n${space.memory.trim().slice(0, 2000)}`].filter(Boolean).join("\n");
}

export function coordinatorSystem(space: Space, memory: MemoryEntry[]) {
  return `You are the coordinator of a project in Clem. The person talks to you; you answer them and open threads with subagents for parts of the work. Each thread is a separate subagent with a role you choose; the person can open and read it.

${projectBlock(space)}

How to reply:
- To open a thread, add one line per thread: [[thread: Role | short title | the full brief, with everything the subagent needs, since it cannot see this chat]]. Pick a role that fits the work (Researcher, Writer, Critic, Analyst, Engineer, Designer, Planner, Fact-checker, or your own). Say in one short sentence what you handed off. You will get each thread's report and then write one combined answer.
- When the person asks for a thread, an agent, a subagent or work in the background, always open a thread for it, even for something small, and give the subagent the actual task.
- Otherwise open threads for work that benefits from a specialist or from running in parallel (up to ${MAX_THREADS} at once); answer simple questions yourself.
- Reactions are rare. Most replies carry none; never add one just to acknowledge a request you are answering. When a message asks for nothing (thanks, ok, a sign-off), reply with only [[react: emoji]] (one of ${REACTIONS.join(" ")}) instead of words.
- To keep a durable fact (a decision, deadline, preference, constraint, number), add [[remember: tag, tag | the fact in one sentence]]. Never store what is already in the memory below.
- If the memory below may be missing something you need, reply with only [[recall: search words]] and you will get the matching lines.
- Directive lines are hidden from the person. Keep answers short and concrete.

Project memory that matches this message (not the whole file):
${memory.length ? memoryLines(memory) : "(nothing relevant)"}`;
}

export function agentSystem(space: Space, role: string, memory: MemoryEntry[]) {
  return `You are a subagent on a project in Clem, working as: ${roleName(role)}. The project's coordinator started you for one task in this thread; the person may read along and add messages.

${projectBlock(space)}

How to reply:
- Do the task fully and reply with the result itself, written for the coordinator. No greeting, no restating the brief.
- If a message only needs acknowledging, reply with only [[react: emoji]] (one of ${REACTIONS.join(" ")}). Otherwise do not react.
- Keep a durable fact the project should not lose with [[remember: tag, tag | fact]].
- End with [[summary: one sentence on what you found or made]].

Project memory that matches this task:
${memory.length ? memoryLines(memory) : "(nothing relevant)"}`;
}

export function threadHistory(thread: ProjectThread, chars = 24000): Turn[] {
  const out: Turn[] = [];
  let room = chars;
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.status === "writing" || !m.content.trim()) continue;
    const content = m.from === "you" ? `(The person, not the coordinator:) ${m.content}` : m.content;
    if (content.length > room && out.length) break;
    room -= content.length;
    out.unshift({ role: m.from === thread.agent ? "assistant" : "user", content: content.slice(-chars) });
  }
  return out;
}

// ---------------------------------------------------------------- running a turn

export type Ask = (messages: Turn[], opts: { model?: string; effort?: string; scope: string; chat: string; signal: AbortSignal; onText: (text: string) => void; tools?: boolean }) => Promise<string>;
export type Room = {
  get: () => ProjectRoom;
  set: (fn: (room: ProjectRoom) => ProjectRoom) => void;
  memory: () => MemoryEntry[];
  saveMemory: (entries: MemoryEntry[]) => Promise<unknown> | void;
  /** A signal of its own for a thread a coordinator turn opens, so the thread can be stopped alone; `done` when it ends. */
  thread?: (threadId: string, parent: AbortSignal) => { signal: AbortSignal; done: () => void };
};
/** At most: a reply that hands work out, one that may ask for a little more, and the closing reply. */
const MAX_THREADS = 4, ROUNDS = 3;
const uid = () => crypto.randomUUID();

function patchMessage(room: ProjectRoom, id: string, fn: (m: RoomMessage) => RoomMessage): ProjectRoom {
  return { ...room, messages: room.messages.map((m) => m.id === id ? fn(m) : m) };
}
function patchThread(room: ProjectRoom, id: string, fn: (t: ProjectThread) => ProjectThread): ProjectRoom {
  return { ...room, threads: room.threads.map((t) => t.id === id ? fn({ ...t, updated: Date.now() }) : t) };
}
export function toggleReaction(reactions: Reaction[] | undefined, emoji: string, by: string): Reaction[] {
  const list = reactions || [];
  return list.some((r) => r.by === by && r.emoji === emoji) ? list.filter((r) => !(r.by === by && r.emoji === emoji)) : [...list, { emoji, by }];
}
const addReaction = (reactions: Reaction[] | undefined, emoji: string, by: string) => (reactions || []).some((r) => r.by === by && r.emoji === emoji) ? reactions! : [...(reactions || []), { emoji, by }];

/** Saves the facts a reply asked to keep. A failed write (reported by whoever saves) never loses the reply itself. */
async function keep(io: Room, facts: Directives["remember"]) {
  if (!facts.length) return 0;
  try { await io.saveMemory(remember(io.memory(), facts.map((f) => entry(f.text, f.tags)))); } catch { return 0; }
  return facts.length;
}

/**
 * A room as saved by a run that never finished (the app closed mid-reply): replies still marked writing become stopped
 * (dropped when empty) and working threads stop, so nothing waits forever on a run that is gone.
 */
export function settleRoom(room: ProjectRoom): ProjectRoom {
  const settle = (list: RoomMessage[]) => list.filter((m) => m.status !== "writing" || m.content.trim()).map((m) => m.status === "writing" ? { ...m, status: "stopped" as const } : m);
  const live = (list: RoomMessage[]) => list.some((m) => m.status === "writing");
  if (!live(room.messages) && !room.threads.some((t) => t.status === "working" || live(t.messages))) return room;
  return { ...room, messages: settle(room.messages), threads: room.threads.map((t) => ({ ...t, messages: settle(t.messages), status: t.status === "working" ? "stopped" : t.status })) };
}

/** The query memory is searched with: the message, plus the last thing said before it for short follow-ups. */
function memoryQuery(room: ProjectRoom, text: string) {
  const before = [...room.messages].reverse().find((m) => m.content && m.content !== text);
  return text.length < 80 && before ? `${text} ${before.content.slice(0, 300)}` : text;
}

/**
 * Answers the person's latest message in the coordinator chat: the coordinator replies (or reacts), threads it opens
 * run in parallel, then it writes one reply from their reports. `space` and the settings are read once at the start.
 */
export async function coordinatorTurn(space: Space, runs: { coordinator: Run; agent: Run }, userMessage: RoomMessage, io: Room, ask: Ask, signal: AbortSignal) {
  const chat = `proj-${space.id}`.slice(0, 80);
  let found = recall(io.memory(), memoryQuery(io.get(), userMessage.content));
  let extra: Turn[] = [];
  for (let round = 0, looked = false; round < ROUNDS; round++) {
    const id = uid();
    io.set((r) => ({ ...r, messages: [...r.messages, { id, from: "coordinator", content: "", at: Date.now(), status: "writing", recalled: found.map((e) => e.id) }] }));
    const history = coordinatorHistory({ ...io.get(), messages: io.get().messages.filter((m) => m.id !== id) });
    let raw: string;
    try {
      raw = await ask([{ role: "system", content: coordinatorSystem(space, found) }, ...history, ...extra], {
        ...runs.coordinator, scope: `project:${space.id}`, chat, signal,
        onText: (t) => io.set((r) => patchMessage(r, id, (m) => ({ ...m, content: readReply(t, true).text }))),
      });
    } catch (error) {
      const stopped = signal.aborted;
      io.set((r) => patchMessage(r, id, (m) => ({ ...m, status: stopped ? "stopped" : "error", error: stopped ? undefined : (error as Error).message || "The coordinator could not answer." })));
      throw error;
    }
    const { text, directives } = readReply(raw);
    // A lookup first: search the memory file and ask again, once, with what it found.
    if (directives.recall.length && !looked && !text && !directives.delegate.length) {
      looked = true; round--;
      const more = directives.recall.flatMap((q) => recall(io.memory(), q, { count: 6, chars: 900 })).filter((e, i, all) => !found.some((f) => f.id === e.id) && all.findIndex((x) => x.id === e.id) === i);
      found = [...found, ...more];
      io.set((r) => ({ ...r, messages: r.messages.filter((m) => m.id !== id) }));
      extra = [...extra, { role: "assistant", content: raw.trim() }, { role: "user", content: `(Memory search results)\n${more.length ? memoryLines(more) : "(no matching lines)"}\nNow answer the person's message.` }];
      continue;
    }
    const remembered = await keep(io, directives.remember);
    // The last round writes the reply; a thread asked for then is not opened.
    const jobs = round === ROUNDS - 1 ? [] : directives.delegate.slice(0, MAX_THREADS);
    const threads: ProjectThread[] = jobs.map((j) => ({ id: uid(), agent: roleName(j.agent), title: j.title || j.task.slice(0, 60), status: "working", created: Date.now(), updated: Date.now(), from: id,
      messages: [{ id: uid(), from: "coordinator", content: j.task, at: Date.now() }] }));
    const target = round === 0 ? userMessage.id : undefined;
    io.set((r) => {
      let next = patchMessage(r, id, (m) => ({ ...m, content: text, status: undefined, at: Date.now(), threads: threads.length ? threads.map((t) => t.id) : undefined, remembered: remembered || undefined }));
      // A reply that is only a reaction leaves no message behind, just the reaction on the person's message.
      if (!text && !threads.length) next = { ...next, messages: next.messages.filter((m) => m.id !== id) };
      if (directives.react && target) next = patchMessage(next, target, (m) => ({ ...m, reactions: addReaction(m.reactions, directives.react!, "coordinator") }));
      return { ...next, threads: [...next.threads, ...threads] };
    });
    // Nothing shown: no words, no threads and no reaction that landed (a closing reply has no message to react to).
    if (!text && !threads.length && !(directives.react && target)) io.set((r) => ({ ...r, messages: [...r.messages, { id, from: "coordinator", content: "I couldn’t put an answer together. Try asking again.", at: Date.now(), status: "error" }] }));
    if (!threads.length) return;
    const reports = await Promise.all(threads.map((t) => {
      const own = io.thread?.(t.id, signal);
      return runThread(space, runs.agent, t.id, io, ask, own?.signal || signal).catch(() => null).finally(() => own?.done());
    }));
    signal.throwIfAborted();
    const stoppedAlone = (id: string) => io.get().threads.find((t) => t.id === id)?.status === "stopped";
    const body = threads.map((t, i) => `### ${t.agent} · ${t.title}\n${reports[i] ? reports[i]!.slice(0, REPORT_CHARS) : stoppedAlone(t.id) ? "(the person stopped this thread; work without it)" : "(this thread failed; work around it)"}`).join("\n\n");
    extra = [{ role: "user", content: `(Thread reports, for you only; the person can open the threads)\n\n${body}\n\nNow write the person one reply that uses these reports. Do not repeat them whole. ${round + 1 === ROUNDS - 1 ? "Do not open more threads." : "Open another thread only if something essential is still missing."}` }];
    found = recall(io.memory(), memoryQuery(io.get(), userMessage.content));
  }
}

/** Runs one thread's subagent on everything in the thread so far; returns its reply, or throws. */
export async function runThread(space: Space, run: Run, threadId: string, io: Room, ask: Ask, signal: AbortSignal) {
  const thread = io.get().threads.find((t) => t.id === threadId);
  if (!thread) throw Error("That thread is gone.");
  const role = thread.agent;
  const id = uid();
  const last = [...thread.messages].reverse().find((m) => m.from !== role);
  const found = recall(io.memory(), `${thread.title} ${last?.content.slice(0, 600) || ""}`, { count: 6, chars: 900 });
  io.set((r) => patchThread(r, threadId, (t) => ({ ...t, status: "working", messages: [...t.messages, { id, from: role, content: "", at: Date.now(), status: "writing", recalled: found.map((e) => e.id) }] })));
  let raw: string;
  try {
    raw = await ask([{ role: "system", content: agentSystem(space, role, found) }, ...threadHistory(thread)], {
      ...run, scope: `project:${space.id}`, chat: `thr-${threadId}`.slice(0, 80), signal, tools: true,
      onText: (t) => io.set((r) => patchThread(r, threadId, (th) => ({ ...th, messages: th.messages.map((m) => m.id === id ? { ...m, content: readReply(t, true).text } : m) }))),
    });
  } catch (error) {
    const stopped = signal.aborted;
    io.set((r) => patchThread(r, threadId, (t) => ({ ...t, status: stopped ? "stopped" : "failed", messages: t.messages.map((m) => m.id === id ? { ...m, status: stopped ? "stopped" : "error", error: stopped ? undefined : (error as Error).message || "The subagent could not answer." } : m) })));
    throw error;
  }
  const { text, directives } = readReply(raw);
  const remembered = await keep(io, directives.remember);
  io.set((r) => patchThread(r, threadId, (t) => {
    let messages = t.messages.map((m) => m.id === id ? { ...m, content: text, status: undefined, at: Date.now(), remembered: remembered || undefined } : m);
    if (directives.react && last) messages = messages.map((m) => m.id === last.id ? { ...m, reactions: addReaction(m.reactions, directives.react!, role) } : m);
    if (!text) messages = messages.filter((m) => m.id !== id);
    return { ...t, messages, status: "done", summary: directives.summary || t.summary || (text ? text.split(/(?<=[.!?])\s/)[0].slice(0, 200) : t.summary) };
  }));
  return text;
}
