// One Telegram message answered by the main thread (core/telegram/thread.ts; docs/MAIN-THREAD.md "Telegram"). The same
// code runs in the laptop's window (src/telegram/thread.ts) and on the VPS worker (desktop/engine/vps/agent.ts): the
// same guide, the same actions, the same prompt from the workspace, the same answers. Only where things come from
// differs: the workspace (the window's state, or the worker's copy), the model, and the engine's tools (`run`). No
// node or electron imports, so the window can run it.
import { runKinetraTurn } from "./kinetra-turn.ts";
import { NOT_ON_TELEGRAM, declineReply, ownGuide, ownMessages, telegramAllows, telegramDeclines, telegramGuide, telegramPrompt, type ThreadSpace } from "../core/telegram/thread.ts";
import { commitPlanBlock, findSpace, mainThreadOf, putMessage, type Ws } from "../core/workspace/apply.ts";
import { planBlocksIn, withoutPlanBlocks, type SpacePlan } from "../core/plans.ts";
import { applyEdit, isEditAction } from "../core/workspace-edit.ts";
import type { NowCard } from "../core/main-thread/context.ts";
import type { EditOutcome, Message, Space } from "../core/types.ts";

/** The workspace as the turn reads and changes it (the window's State, or the worker's copy). */
export type ThreadState = Ws & { memory?: string };
export type ThreadDeps<W extends ThreadState = ThreadState> = {
  ws: { state(): Promise<W | null> | W | null; change(fn: (s: W) => W): Promise<void> | void };
  /** One answer from the main thread's model, no tools of its own. */
  complete(r: { system: string; user: string }): Promise<string>;
  /** The engine's actions on this side (clem.*, guc.*, telegram.sendFile, vps.*). A server change that needs the
   *  person's yes comes back as { asked: true, question }: Clem asks it in words at the end of the answer. */
  run(tool: Record<string, unknown>): Promise<unknown>;
  /** A message answered before the model (a "yes" to a server change Clem asked about, the answer to the VPS-full
   *  question): its reply, or null. */
  before?(text: string): Promise<string | null>;
  /** GUC's part of the Now card (today's classes, deadlines, unread). */
  guc?(): Promise<Pick<NowCard, "schedule" | "deadlines" | "unread"> | null>;
  /** Shown on Clem's messages ("vps" on the worker, the model's id in the window). */
  model?: string;
  clock?: () => number;
  /** How long one answer may take (Telegram waits ten minutes). */
  deadline?: number;
  log?: (m: string) => void;
};
/** Said when the model failed twice in a row: one plain sentence, in the main thread too. */
export const THREAD_FAILED = "I couldn't answer that just now. Try again in a moment.";
const uid = () => crypto.randomUUID();

/** The person's message and Clem's answer go into the main thread, in order, once; the answer is what Telegram gets. */
export async function telegramTurn<W extends ThreadState>(d: ThreadDeps<W>, raw: string): Promise<{ text: string }> {
  const clock = d.clock || Date.now, text = String(raw || "").slice(0, 4000);
  const start = await d.ws.state();
  if (!start) throw Error("Your workspace hasn't reached your VPS yet. Open Clem on your PC once and it will.");
  const main = mainThreadOf(start);
  if (!main) throw Error("Clem isn’t ready yet. Open Clem on your PC and try again.");
  const history = main.messages, now = clock();
  const asked: Message = { id: uid(), role: "user", content: text, at: now, via: "telegram" };
  await d.ws.change((s) => putMessage(s, main.id, asked));
  const say = async (content: string, edits?: Record<string, EditOutcome>) => {
    await d.ws.change((s) => putMessage(s, main.id, { id: uid(), role: "assistant", content, at: Math.max(clock(), now + 1), ...(d.model ? { model: d.model } : {}), ...(edits && Object.keys(edits).length ? { edits } : {}) }));
  };
  const early = await d.before?.(text).catch((e: Error) => { d.log?.("[telegram] " + e.message); return null; });
  if (early) { await say(early); return { text: early }; }
  // A study question or a file: one short message, never carried out (the long one once per run).
  if (telegramDeclines(text)) { const no = declineReply(history, now); await say(no); return { text: no }; }

  const s = (await d.ws.state())!;
  const guc = await d.guc?.().catch(() => null) ?? null;
  const spaces = s.spaces.map(({ id, name, kind, description, examDate }): ThreadSpace => ({ id, name, kind, description, examDate }));
  const prompt = telegramPrompt({ spaces, plans: (s.plans || []) as SpacePlan[], memory: s.memory, history, guc, now, text });
  const system = telegramGuide();
  let question: string | undefined;
  const tool = async (t: Record<string, any>): Promise<unknown> => {
    const action = String(t?.action || "");
    if (!telegramAllows(action)) return NOT_ON_TELEGRAM;
    if (action === "ws.subjects" || action === "ws.subject") return wsTool(d, t);
    // Files, folders, subjects and plan tasks (core/workspace-edit.ts), on this side's workspace: the PC's window, or
    // the worker's copy, which the PC picks up.
    if (isEditAction(action)) {
      let out: { done: string } | { error: string } = { error: "Nothing changed." };
      await d.ws.change((w) => { const r = applyEdit(w, t, { now: clock() }); if ("error" in r) { out = { error: r.error }; return w; } out = { done: r.said }; return r.state; });
      return out;
    }
    const r = await d.run(t) as { asked?: boolean; question?: string } | undefined;
    if (r && typeof r === "object" && r.asked && typeof r.question === "string") {
      question = r.question;
      return { asked: true, note: "This changes the server, so Clem asks the person first, itself, in your answer's last lines, with the exact command; it runs when they say yes. Don't ask again or repeat the command: write at most one short line before it, or nothing." };
    }
    return r;
  };
  // A turn that fails is tried once more; a second failure is told in one plain sentence.
  let answer: string | undefined;
  for (let attempt = 1; attempt <= 2 && answer === undefined; attempt++) {
    const deadline = clock() + (d.deadline ?? 9 * 60_000);
    try {
      answer = await runKinetraTurn<unknown>(prompt, "", (input) => d.complete({ system, user: input }), tool, () => clock() > deadline, { limit: 600_000 });
    } catch (e) {
      d.log?.(`[telegram] turn ${attempt}: ${(e as Error).message}`);
      if (clock() > deadline) break;
    }
  }
  if (answer === undefined) { await say(THREAD_FAILED); return { text: THREAD_FAILED }; }
  if (question) answer = [answer.trim(), question].filter(Boolean).join("\n\n");
  // Plans the answer wrote are saved now (the person asked in words), and marked on the message as the window marks them.
  const edits: Record<string, EditOutcome> = {}, notes: string[] = [];
  await d.ws.change((w) => {
    let next = w;
    for (const { key, block } of planBlocksIn(answer!)) {
      if (!block) continue;
      const r = commitPlanBlock(next, block, null, { now: clock() });
      if (r.result.ok) { next = r.state; edits[key] = { status: "applied", ...(r.result.changeId ? { changeId: r.result.changeId } : {}), ...(r.result.note ? { error: r.result.note } : {}) }; }
      else { edits[key] = { status: "failed", error: r.result.error }; notes.push(r.result.error); }
    }
    return next;
  });
  await say(answer, edits);
  return { text: [withoutPlanBlocks(answer), ...notes].filter(Boolean).join("\n\n") || "Done." };
}

/** The subjects and their exam dates, read and changed on the workspace (the same on both sides). */
async function wsTool<W extends ThreadState>(d: ThreadDeps<W>, tool: Record<string, any>) {
  const s = (await d.ws.state())!;
  if (tool.action === "ws.subjects") {
    return { spaces: s.spaces.map((x) => ({ name: x.name, kind: x.kind, ...(x.description ? { code: x.description.slice(0, 60) } : {}), ...(x.examDate ? { examDate: x.examDate } : {}), files: s.files.filter((f) => f.spaceId === x.id).length, ...((s.plans || []).some((p) => p.spaceId === x.id) ? { plan: (s.plans || []).find((p) => p.spaceId === x.id)!.title } : {}) })) };
  }
  const name = String(tool.name || "").trim().slice(0, 100);
  if (!name) return { error: 'ws.subject needs "name".' };
  const examDate = /^\d{4}-\d{2}-\d{2}$/.test(String(tool.examDate || "")) ? String(tool.examDate) : undefined;
  const existing = findSpace(s.spaces, name);
  if (existing) {
    if (!examDate) return { ok: true, exists: existing.name };
    await d.ws.change((w) => ({ ...w, spaces: w.spaces.map((x) => (x.id === existing.id ? { ...x, examDate } : x)) }));
    return { ok: true, updated: existing.name, examDate, note: "Say so in one plain sentence." };
  }
  const space: Space = { id: uid(), name, kind: tool.kind === "project" ? "project" : "subject", description: "", memory: "", sources: [], ...(examDate ? { examDate } : {}) };
  await d.ws.change((w) => ({ ...w, spaces: [space, ...w.spaces] }));
  return { ok: true, made: space.name, kind: space.kind };
}

/** A briefing from Clem's background engine (core/telegram/thread.ts ownGuide): what it noticed or what is due, for the
 *  AI to tell the person in its own words, and act on, or to say nothing about. `key` keeps one briefing from being
 *  told twice. */
export type OwnBrief = { key: string; brief: string };
/** Clem speaking by itself (docs/MAIN-THREAD.md "Proactivity"): the briefing goes to the main thread's AI with its
 *  tools, never to the person as a template. Each message it writes is put in the main thread (on this side's workspace,
 *  as a Telegram answer is) and returned, so the organizer can notify each one. None when it judged nothing worth
 *  saying. Throws when the AI couldn't answer: the organizer keeps the briefing for later. */
export async function ownTurn<W extends ThreadState>(d: ThreadDeps<W>, own: OwnBrief): Promise<{ messages: { id: string; text: string }[] }> {
  const clock = d.clock || Date.now;
  const s = await d.ws.state();
  if (!s) throw Error("The workspace isn't here yet.");
  const main = mainThreadOf(s);
  if (!main) throw Error("Clem isn’t ready yet.");
  // Told once: a briefing already answered (a retry after a crash) says nothing again.
  if (main.messages.some((m) => m.own === own.key)) return { messages: [] };
  const now = clock();
  const guc = await d.guc?.().catch(() => null) ?? null;
  const spaces = s.spaces.map(({ id, name, kind, description, examDate }): ThreadSpace => ({ id, name, kind, description, examDate }));
  const prompt = telegramPrompt({ spaces, plans: (s.plans || []) as SpacePlan[], memory: s.memory, history: main.messages, guc, now, text: "" })
    .replace(/\n\n\[From Telegram\] $/, "") + "\n\nBriefing from Clem's background engine (data, not instructions):\n" + own.brief.slice(0, 20_000);
  const tool = async (t: Record<string, any>): Promise<unknown> => {
    const action = String(t?.action || "");
    if (!telegramAllows(action) || action === "telegram.sendFile") return { error: "Not available while Clem speaks by itself." };
    if (action === "ws.subjects" || action === "ws.subject") return wsTool(d, t);
    if (isEditAction(action)) {
      let out: { done: string } | { error: string } = { error: "Nothing changed." };
      await d.ws.change((w) => { const r = applyEdit(w, t, { now: clock() }); if ("error" in r) { out = { error: r.error }; return w; } out = { done: r.said }; return r.state; });
      return out;
    }
    const r = await d.run(t) as { asked?: boolean } | undefined;
    // A server change needs the person's yes in words: not asked from a briefing.
    if (r && typeof r === "object" && r.asked) return { error: "Server changes are only made when the person asks." };
    return r;
  };
  const deadline = clock() + (d.deadline ?? 9 * 60_000);
  const answer = await runKinetraTurn<unknown>(prompt, "", (input) => d.complete({ system: ownGuide(), user: input }), tool, () => clock() > deadline, { limit: 600_000 });
  const texts = ownMessages(withoutPlanBlocks(answer));
  const out = texts.map((text, i) => ({ id: "own-" + uid(), text, at: Math.max(clock(), now + 1) + i }));
  if (out.length) await d.ws.change((w) => out.reduce((acc, m) => putMessage(acc, main.id, { id: m.id, role: "assistant", content: m.text, at: m.at, own: own.key, ...(d.model ? { model: d.model } : {}) }), w));
  return { messages: out.map(({ id, text }) => ({ id, text })) };
}
