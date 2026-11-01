/**
 * A project's coordinator: the person talks to it, and it hands parts of the work to the agents picked in the project's
 * settings, each in its own thread. Replies carry a few directives on their own lines, read here and never shown:
 *
 *   [[react: 👍]]                         react to the message being answered (alone: a reaction instead of a reply)
 *   [[delegate: researcher | Title | Brief]]  start a thread with that agent
 *   [[remember: launch, dates | Fact]]    keep a fact in the project's memory file (core/project-memory.ts)
 *   [[recall: words]]                     look something up in that file before answering
 *   [[summary: One sentence]]             (agents) what the thread produced, for the coordinator's later turns
 *
 * Only what each turn needs is sent: the last few messages, one-line outcomes of threads instead of their text, and the
 * memory lines that match. Threads run at the same time; their reports come back for one closing reply.
 */
import type { ProjectAgent, ProjectRoom, ProjectTeam, ProjectThread, Reaction, RoomMessage, Space } from "./types";
import { entry, memoryLines, recall, remember, type MemoryEntry } from "./project-memory.ts";

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🤔", "🙏"];

/** The agent kinds a project can pick from (Settings → Team). */
export const AGENT_KINDS: { kind: string; name: string; line: string; instructions: string }[] = [
  { kind: "researcher", name: "Researcher", line: "Finds facts, sources and options", instructions: "Find what is true and what the options are. Prefer primary sources, say where each fact comes from, and say plainly what you could not confirm." },
  { kind: "writer", name: "Writer", line: "Drafts and edits clear prose", instructions: "Write and rewrite text the person can use as is: clear, specific, in their voice, no filler." },
  { kind: "critic", name: "Critic", line: "Finds flaws, gaps and risks", instructions: "Review the work you are given. List the real problems first, most serious first, each with a concrete fix. Do not praise." },
  { kind: "planner", name: "Planner", line: "Breaks work into dated steps", instructions: "Turn goals into ordered, dated steps with owners and the order they depend on. Flag what blocks what." },
  { kind: "analyst", name: "Analyst", line: "Numbers, data and estimates", instructions: "Work with numbers: show the calculation, state assumptions, give ranges when inputs are uncertain, and check units." },
  { kind: "engineer", name: "Engineer", line: "Writes and reviews code", instructions: "Write working, minimal code and explain how to run it. When reviewing, point to the exact line and the fix." },
  { kind: "designer", name: "Designer", line: "Layout, UX and visual direction", instructions: "Give concrete design direction: structure, hierarchy, wording, states. Describe exactly what to change and why it helps the user." },
  { kind: "factchecker", name: "Fact-checker", line: "Checks claims before they ship", instructions: "Check each claim in what you are given. Mark it supported, unclear or wrong, with the reason and a source where you can." },
];
export const DEFAULT_KINDS = ["researcher", "writer", "critic"];

export function makeAgent(kind: string, taken: string[] = []): ProjectAgent {
  const k = AGENT_KINDS.find((x) => x.kind === kind);
  let id = kind, n = 2;
  while (taken.includes(id)) id = `${kind}-${n++}`;
  return { id, kind, name: k?.name || "Custom agent", instructions: k?.instructions || "" };
}
export const defaultTeam = (): ProjectTeam => ({ agents: DEFAULT_KINDS.map((k) => makeAgent(k)) });
export const teamOf = (space: Space) => space.team || defaultTeam();
export const emptyRoom = (spaceId: string): ProjectRoom => ({ spaceId, messages: [], threads: [] });

// ---------------------------------------------------------------- directives

export type Directives = {
  react?: string;
  delegate: { agent: string; title: string; task: string }[];
  remember: { tags: string[]; text: string }[];
  recall: string[];
  summary?: string;
};
const DIRECTIVE = /\[\[\s*(react|delegate|remember|recall|summary)\s*:\s*([\s\S]*?)\]\]/gi;
const isEmoji = (s: string) => /^\p{Extended_Pictographic}/u.test(s) && s.length <= 8;

/** The text to show and the directives in a reply. While streaming, a directive still being written is hidden too. */
export function readReply(raw: string, streaming = false): { text: string; directives: Directives } {
  const d: Directives = { delegate: [], remember: [], recall: [] };
  let text = raw.replace(DIRECTIVE, (_, kind: string, body: string) => {
    const value = body.trim();
    switch (kind.toLowerCase()) {
      case "react": { const e = value.split(/\s+/)[0]; if (isEmoji(e)) d.react = e; break; }
      case "delegate": {
        const [agent, title, ...rest] = value.split("|").map((s) => s.trim());
        const task = rest.join(" | ").trim() || title || "";
        if (agent && task) d.delegate.push({ agent, title: (rest.length ? title : task).slice(0, 80), task: task.slice(0, 6000) });
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

/** A delegation's agent, by id or name (models sometimes write the name). */
export function findAgent(agents: ProjectAgent[], ref: string) {
  const r = ref.trim().toLowerCase();
  return agents.find((a) => a.id === r) || agents.find((a) => a.name.toLowerCase() === r) || agents.find((a) => a.kind === r);
}

// ---------------------------------------------------------------- what each request carries

type Turn = { role: "system" | "user" | "assistant"; content: string };
const HISTORY_CHARS = 7000, HISTORY_COUNT = 14, REPORT_CHARS = 5000;

const nameOf = (agents: ProjectAgent[], by: string) => by === "you" ? "the person" : by === "coordinator" ? "you" : agents.find((a) => a.id === by)?.name || by;
const reactionNote = (reactions: Reaction[] | undefined, agents: ProjectAgent[]) => reactions?.length ? `\n(reactions: ${reactions.map((r) => `${nameOf(agents, r.by)} ${r.emoji}`).join(", ")})` : "";

/** The newest messages that fit, oldest first; each coordinator message notes its threads' one-line outcomes. */
export function coordinatorHistory(room: ProjectRoom, agents: ProjectAgent[], chars = HISTORY_CHARS, count = HISTORY_COUNT): Turn[] {
  const out: Turn[] = [];
  let room_ = chars;
  for (let i = room.messages.length - 1; i >= 0 && out.length < count; i--) {
    const m = room.messages[i];
    if (m.status === "writing") continue;
    const threads = (m.threads || []).map((id) => room.threads.find((t) => t.id === id)).filter((t): t is ProjectThread => !!t)
      .map((t) => `\n(thread ${t.id.slice(0, 6)} · ${agents.find((a) => a.id === t.agent)?.name || t.agent} · "${t.title}" · ${t.status}${t.summary ? ": " + t.summary : ""})`).join("");
    let content = (m.content || (m.reactions?.some((r) => r.by === "coordinator") ? "(you reacted instead of replying)" : "")) + threads + reactionNote(m.reactions, agents);
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

export function coordinatorSystem(space: Space, agents: ProjectAgent[], memory: MemoryEntry[]) {
  const roster = agents.length ? agents.map((a) => `- ${a.id}: ${a.name}. ${AGENT_KINDS.find((k) => k.kind === a.kind)?.line || a.instructions.slice(0, 120)}`).join("\n") : "(no agents: do the work yourself)";
  return `You are the coordinator of a project in Clem. The person talks to you; you answer them and, when it helps, hand parts of the work to your team. Each handoff opens a thread the person can read.

${projectBlock(space)}

Your team:
${roster}

How to reply:
- Answer directly when you can. Delegate only work that benefits from a specialist or from running in parallel; never delegate a simple question.
- To delegate, add one line per thread: [[delegate: agent-id | short title | the full brief, with everything the agent needs, since it cannot see this chat]]. Say in one short sentence what you handed to whom. You will get their reports and then write one combined answer.
- To react to the person's message, add [[react: emoji]] (one of ${REACTIONS.join(" ")}). When a message needs no words (thanks, ok, a sign-off), reply with only the reaction line.
- To keep a durable fact (a decision, deadline, preference, constraint, number), add [[remember: tag, tag | the fact in one sentence]]. Never store what is already in the memory below.
- If the memory below may be missing something you need, reply with only [[recall: search words]] and you will get the matching lines.
- Directive lines are hidden from the person. Keep answers short and concrete.

Project memory that matches this message (not the whole file):
${memory.length ? memoryLines(memory) : "(nothing relevant)"}`;
}

export function agentSystem(space: Space, agent: ProjectAgent, memory: MemoryEntry[]) {
  const kind = AGENT_KINDS.find((k) => k.kind === agent.kind);
  return `You are ${agent.name}${kind && kind.name !== agent.name ? ` (${kind.name})` : ""}, an agent on a project team in Clem. The project's coordinator hands you a task in this thread; the person may read along and add messages.

${projectBlock(space)}

Your role: ${agent.instructions || kind?.instructions || "Do the task well."}

How to reply:
- Do the task fully and reply with the result itself, written for the coordinator. No greeting, no restating the brief.
- If a message only needs acknowledging, reply with only [[react: emoji]] (one of ${REACTIONS.join(" ")}). You may also react to the brief while answering it.
- Keep a durable fact the team should not lose with [[remember: tag, tag | fact]].
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

export type Ask = (messages: Turn[], opts: { model?: string; scope: string; chat: string; signal: AbortSignal; onText: (text: string) => void; tools?: boolean }) => Promise<string>;
export type Room = {
  get: () => ProjectRoom;
  set: (fn: (room: ProjectRoom) => ProjectRoom) => void;
  memory: () => MemoryEntry[];
  saveMemory: (entries: MemoryEntry[]) => Promise<void> | void;
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

async function keep(io: Room, facts: Directives["remember"]) {
  if (!facts.length) return 0;
  await io.saveMemory(remember(io.memory(), facts.map((f) => entry(f.text, f.tags))));
  return facts.length;
}

/** The query memory is searched with: the message, plus the last thing said before it for short follow-ups. */
function memoryQuery(room: ProjectRoom, text: string) {
  const before = [...room.messages].reverse().find((m) => m.content && m.content !== text);
  return text.length < 80 && before ? `${text} ${before.content.slice(0, 300)}` : text;
}

/**
 * Answers the person's latest message in the coordinator chat: the coordinator replies (or reacts), threads it starts
 * run in parallel, then it writes one reply from their reports. `space` and the team are read once at the start.
 */
export async function coordinatorTurn(space: Space, agents: ProjectAgent[], coordinatorModel: string | undefined, userMessage: RoomMessage, io: Room, ask: Ask, signal: AbortSignal) {
  const chat = `proj-${space.id}`.slice(0, 80);
  let found = recall(io.memory(), memoryQuery(io.get(), userMessage.content));
  let extra: Turn[] = [];
  for (let round = 0, looked = false; round < ROUNDS; round++) {
    const id = uid();
    io.set((r) => ({ ...r, messages: [...r.messages, { id, from: "coordinator", content: "", at: Date.now(), status: "writing", recalled: found.map((e) => e.id) }] }));
    const history = coordinatorHistory({ ...io.get(), messages: io.get().messages.filter((m) => m.id !== id) }, agents);
    let raw: string;
    try {
      raw = await ask([{ role: "system", content: coordinatorSystem(space, agents, found) }, ...history, ...extra], {
        model: coordinatorModel, scope: `project:${space.id}`, chat, signal,
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
    // The last round writes the reply; a handoff asked for then is not started.
    const jobs = (round === ROUNDS - 1 ? [] : directives.delegate.slice(0, MAX_THREADS)).map((d) => ({ ...d, agent: findAgent(agents, d.agent) })).filter((d): d is typeof d & { agent: ProjectAgent } => !!d.agent);
    const threads: ProjectThread[] = jobs.map((j) => ({ id: uid(), agent: j.agent.id, title: j.title || j.task.slice(0, 60), status: "working", created: Date.now(), updated: Date.now(), from: id,
      messages: [{ id: uid(), from: "coordinator", content: j.task, at: Date.now() }] }));
    const target = round === 0 ? userMessage.id : undefined;
    io.set((r) => {
      let next = patchMessage(r, id, (m) => ({ ...m, content: text, status: undefined, at: Date.now(), threads: threads.length ? threads.map((t) => t.id) : undefined, remembered: remembered || undefined }));
      // A reply that is only a reaction leaves no message behind, just the reaction on the person's message.
      if (!text && !threads.length) next = { ...next, messages: next.messages.filter((m) => m.id !== id) };
      if (directives.react && target) next = patchMessage(next, target, (m) => ({ ...m, reactions: addReaction(m.reactions, directives.react!, "coordinator") }));
      return { ...next, threads: [...next.threads, ...threads] };
    });
    if (!text && !threads.length && !directives.react) io.set((r) => ({ ...r, messages: [...r.messages, { id, from: "coordinator", content: "I couldn’t put an answer together. Try asking again.", at: Date.now(), status: "error" }] }));
    if (!threads.length) return;
    const reports = await Promise.all(threads.map((t, i) => runThread(space, jobs[i].agent, t.id, io, ask, signal, coordinatorModel).catch(() => null)));
    signal.throwIfAborted();
    const body = threads.map((t, i) => {
      const agent = agents.find((a) => a.id === t.agent)!;
      return `### ${agent.name} · ${t.title}\n${reports[i] ? reports[i]!.slice(0, REPORT_CHARS) : "(this thread failed; work around it)"}`;
    }).join("\n\n");
    extra = [{ role: "user", content: `(Thread reports, for you only; the person can open the threads)\n\n${body}\n\nNow write the person one reply that uses these reports. Do not repeat them whole. ${round + 1 === ROUNDS - 1 ? "Do not delegate again." : "Delegate again only if something essential is still missing."}` }];
    found = recall(io.memory(), memoryQuery(io.get(), userMessage.content));
  }
}

/** Runs one thread's agent on everything in the thread so far; returns its reply, or throws. */
export async function runThread(space: Space, agent: ProjectAgent, threadId: string, io: Room, ask: Ask, signal: AbortSignal, fallbackModel?: string) {
  const thread = io.get().threads.find((t) => t.id === threadId);
  if (!thread) throw Error("That thread is gone.");
  const id = uid();
  const last = [...thread.messages].reverse().find((m) => m.from !== agent.id);
  const found = recall(io.memory(), `${thread.title} ${last?.content.slice(0, 600) || ""}`, { count: 6, chars: 900 });
  io.set((r) => patchThread(r, threadId, (t) => ({ ...t, status: "working", messages: [...t.messages, { id, from: agent.id, content: "", at: Date.now(), status: "writing", recalled: found.map((e) => e.id) }] })));
  let raw: string;
  try {
    raw = await ask([{ role: "system", content: agentSystem(space, agent, found) }, ...threadHistory(thread)], {
      model: agent.model || fallbackModel, scope: `project:${space.id}`, chat: `thr-${threadId}`.slice(0, 80), signal, tools: true,
      onText: (t) => io.set((r) => patchThread(r, threadId, (th) => ({ ...th, messages: th.messages.map((m) => m.id === id ? { ...m, content: readReply(t, true).text } : m) }))),
    });
  } catch (error) {
    const stopped = signal.aborted;
    io.set((r) => patchThread(r, threadId, (t) => ({ ...t, status: stopped ? "stopped" : "failed", messages: t.messages.map((m) => m.id === id ? { ...m, status: stopped ? "stopped" : "error", error: stopped ? undefined : (error as Error).message || "The agent could not answer." } : m) })));
    throw error;
  }
  const { text, directives } = readReply(raw);
  const remembered = await keep(io, directives.remember);
  io.set((r) => patchThread(r, threadId, (t) => {
    let messages = t.messages.map((m) => m.id === id ? { ...m, content: text, status: undefined, at: Date.now(), remembered: remembered || undefined } : m);
    if (directives.react && last) messages = messages.map((m) => m.id === last.id ? { ...m, reactions: addReaction(m.reactions, directives.react!, agent.id) } : m);
    if (!text) messages = messages.filter((m) => m.id !== id);
    return { ...t, messages, status: "done", summary: directives.summary || t.summary || (text ? text.split(/(?<=[.!?])\s/)[0].slice(0, 200) : t.summary) };
  }));
  return text;
}
