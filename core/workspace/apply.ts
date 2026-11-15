// The workspace changes Clem's AI makes, as pure functions on the saved workspace (src/store.ts State), so the window
// and the VPS worker run the same code (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"). Each returns the next
// workspace and what happened, never touching the one it was given.
import { applyUpdate, newPlan, resolveSpace, type PlanBlock, type SpacePlan } from "../plans.ts";
import type { Chat, Message, Space, StoredFile, StudyItem, StudySet } from "../types.ts";

/** The part of the workspace these functions touch. */
export type Ws = { spaces: Space[]; plans?: SpacePlan[]; studySets: StudySet[]; chats: Chat[]; files: StoredFile[] };
export type PlanCommit = { ok: true; spaceId: string; changeId?: string; note?: string } | { ok: false; error: string };

/** A ```plan block made real: create or replace (a new subject or project when the block asks for one), update, or
 *  delete. The window confirms creates on a card first; the worker, asked in words, commits them straight away. */
export function commitPlanBlock<W extends Ws>(w: W, block: PlanBlock, here: string | null, o: { now?: number; uid?: () => string } = {}): { state: W; result: PlanCommit } {
  const now = o.now ?? Date.now(), uid = o.uid ?? (() => crypto.randomUUID());
  let spaces = w.spaces, plans = w.plans || [];
  let spaceId = resolveSpace(block, spaces, here);
  const missing = () => block.space ? `There’s no subject or project called “${block.space}”.` : "Clem didn’t say which subject or project this plan is for.";
  const done = (result: PlanCommit, next?: { spaces?: Space[]; plans?: SpacePlan[] }) => ({ state: next ? { ...w, ...(next.spaces ? { spaces: next.spaces } : {}), ...(next.plans ? { plans: next.plans } : {}) } : w, result });
  if (block.action === "create" || block.action === "replace") {
    if (!spaceId && block.create && !block.space) {
      const space: Space = { id: uid(), name: block.create.name, description: "", kind: block.create.kind, memory: "", sources: [] };
      spaces = [space, ...spaces];
      spaceId = space.id;
    }
    if (!spaceId) return done({ ok: false, error: missing() });
    const plan = newPlan(spaceId, block, now, uid()), target = spaceId;
    return done({ ok: true, spaceId, changeId: plan.id }, { spaces, plans: [...plans.filter((p) => p.spaceId !== target), plan] });
  }
  if (!spaceId) return done({ ok: false, error: missing() });
  const plan = plans.find((p) => p.spaceId === spaceId), name = spaces.find((x) => x.id === spaceId)?.name || "This space", target = spaceId;
  if (!plan) return done({ ok: false, error: `${name} has no plan to ${block.action === "delete" ? "delete" : "update"}.` });
  if (block.action === "delete") return done({ ok: true, spaceId }, { plans: plans.filter((p) => p.spaceId !== target) });
  const r = applyUpdate(plan, block as Extract<PlanBlock, { action: "update" }>, now, uid());
  if (!r.applied) return done({ ok: false, error: "None of those tasks are in the plan any more." });
  return done({ ok: true, spaceId, changeId: r.snapshot, ...(r.missing.length ? { note: `${r.missing.length} change${r.missing.length === 1 ? "" : "s"} skipped (task not found)` } : {}) }, { plans: plans.map((p) => (p.spaceId === target ? r.plan : p)) });
}

/** A flashcard deck or quiz the AI wrote (core/study.ts parseStudy), kept in its subject. */
export function addStudySet<W extends Ws>(w: W, s: { spaceId: string; kind: "flashcards" | "quiz"; title: string; items: StudyItem[]; chatId?: string }, o: { now?: number; uid?: () => string } = {}): { state: W; set: StudySet } {
  const set: StudySet = { id: (o.uid ?? (() => crypto.randomUUID()))(), spaceId: s.spaceId, ...(s.chatId ? { chatId: s.chatId } : {}), kind: s.kind, title: s.title, items: s.items, created: o.now ?? Date.now(), attempts: [] };
  return { state: { ...w, studySets: [...w.studySets, set] }, set };
}
/** What the window says in the chat once a deck is ready (the same sentence). */
export const studyReadyText = (title: string, n: number, kind: "flashcards" | "quiz", space: string) => `${title} is ready: ${n} ${kind === "quiz" ? "questions" : "flashcards"}. Open ${space} in Subjects to study and track your progress.`;

/** Adds a message to a chat (made if missing), or replaces the one with the same id. */
export function putMessage<W extends Ws>(w: W, chatId: string, message: Message, make?: Omit<Chat, "messages" | "updated">): W {
  const now = message.at ?? Date.now();
  const has = w.chats.some((c) => c.id === chatId);
  if (!has) return make ? { ...w, chats: [{ ...make, id: chatId, messages: [message], updated: now }, ...w.chats] } : w;
  return { ...w, chats: w.chats.map((c) => c.id !== chatId ? c : { ...c, updated: Math.max(c.updated || 0, now), messages: c.messages.some((m) => m.id === message.id) ? c.messages.map((m) => (m.id === message.id ? message : m)) : [...c.messages, message] }) };
}
export const mainThreadOf = (w: { chats: Chat[] }) => w.chats.find((c) => c.kind === "main");

/** A subject or project by id or name (exact, then the only one whose name contains it). */
export function findSpace(spaces: Space[], name: unknown): Space | undefined {
  const want = String(name ?? "").trim().toLowerCase();
  if (!want) return undefined;
  const exact = spaces.find((s) => s.id === name || s.name.trim().toLowerCase() === want || s.description?.trim().toLowerCase() === want);
  if (exact) return exact;
  const near = spaces.filter((s) => s.name.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()));
  return near.length === 1 ? near[0] : undefined;
}
