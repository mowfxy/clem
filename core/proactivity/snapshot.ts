// What the organizer's sweeps know about the workspace: a compact snapshot made from the saved workspace (the window's
// state.json, read by the engine's host), and the diff between two of them. The engine keeps the last snapshot per
// sweep, so a sweep sees what changed, never history. Pure.
import { isDue, isWeak } from "../srs.ts";

export type SnapTask = { id: string; title: string; due?: string; time?: string; milestone?: true; done?: true; group?: string };
export type Snapshot = {
  /** Clem's organizer (Settings → Proactivity), or nothing for the default model. */
  organizer?: { model?: string; reasoning?: string };
  spaces: { id: string; name: string; kind: "subject" | "project"; code?: string; examDate?: string }[];
  plans: { spaceId: string; rev: number; tasks: SnapTask[] }[];
  /** Flashcards due now per subject, and the questions it keeps missing (core/srs.ts isWeak). */
  study: { spaceId: string; due: number; weak: string[] }[];
  /** Uploads that belong to no subject or project yet. */
  loose: { id: string; name: string; created: number }[];
  /** Each project's room: last activity, threads still working or failed. */
  rooms: { spaceId: string; last: number; working: number; failed: number }[];
  /** The person's recent words in the main thread (commitments) and in any chat (repeated requests), newest last. */
  said: { id: string; text: string; at: number; main?: true }[];
  automations: { name: string; prompt: string }[];
  mainId?: string;
};

type Any = Record<string, any>;
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");

/** The snapshot of a saved workspace (src/store.ts State); anything malformed is left out. */
export function snapshotOf(state: unknown, now = Date.now()): Snapshot {
  const s = (state && typeof state === "object" ? state : {}) as Any;
  const spaces = arr(s.spaces).filter((x) => x?.id && (x.kind === "subject" || x.kind === "project"))
    .map((x) => ({ id: str(x.id, 80), name: str(x.name, 120) || "Untitled", kind: x.kind, ...(/^[A-Z]{2,5} ?\d{3}/.test(str(x.description)) ? { code: str(x.description).match(/^[A-Z]{2,5} ?\d{3}/)![0] } : {}), ...(str(x.examDate, 10) ? { examDate: str(x.examDate, 10) } : {}) }));
  const plans = arr(s.plans).map((p) => ({ spaceId: str(p.spaceId, 80), rev: Number(p.rev) || 0, tasks: arr(p.tasks).slice(0, 200).map((t): SnapTask => ({ id: str(t.id, 40), title: str(t.title, 160), ...(t.due ? { due: str(t.due, 10) } : {}), ...(t.time ? { time: str(t.time, 5) } : {}), ...(t.kind === "milestone" ? { milestone: true } : {}), ...(t.done ? { done: true } : {}), ...(t.group ? { group: str(t.group, 60) } : {}) })) }));
  const study = new Map<string, { spaceId: string; due: number; weak: string[] }>();
  for (const set of arr(s.studySets)) {
    if (set.kind !== "flashcards" && set.kind !== "quiz") continue;
    const e = study.get(set.spaceId) || { spaceId: str(set.spaceId, 80), due: 0, weak: [] };
    arr(set.items).forEach((item, i) => {
      const c = arr(set.cards)[i] as any;
      if (set.kind === "flashcards" && c?.reps && isDue(c, now)) e.due++;
      if (c && isWeak(c) && e.weak.length < 6) e.weak.push(str(item.question, 120));
    });
    study.set(set.spaceId, e);
  }
  const loose = arr(s.files).filter((f) => !f.spaceId && !f.chatId && !f.made && !f.remote).slice(-30).map((f) => ({ id: str(f.id, 100), name: str(f.name, 160), created: Number(f.created) || 0 }));
  const rooms = arr(s.rooms).map((r) => {
    const all = [...arr(r.messages), ...arr(r.threads).flatMap((t) => arr(t.messages))];
    return { spaceId: str(r.spaceId, 80), last: all.reduce((m, x) => Math.max(m, Number(x.at) || 0), 0), working: arr(r.threads).filter((t) => t.status === "working").length, failed: arr(r.threads).filter((t) => t.status === "failed").length };
  });
  const said: Snapshot["said"] = [];
  const main = arr(s.chats).find((c) => c.kind === "main");
  for (const c of arr(s.chats)) for (const m of arr(c.messages).slice(-40)) if (m.role === "user" && typeof m.content === "string" && Number(m.at) > now - 14 * 864e5)
    said.push({ id: str(m.id, 80), text: m.content.slice(0, 300), at: Number(m.at), ...(c === main ? { main: true as const } : {}) });
  said.sort((a, b) => a.at - b.at);
  return {
    ...(s.organizer?.model ? { organizer: { model: str(s.organizer.model, 120), ...(s.organizer.reasoning ? { reasoning: str(s.organizer.reasoning, 20) } : {}) } } : {}),
    spaces, plans, study: [...study.values()].filter((x) => x.due || x.weak.length), loose, rooms, said: said.slice(-60),
    automations: arr(s.automations).map((a) => ({ name: str(a.name, 120), prompt: str(a.prompt, 300) })),
    ...(main ? { mainId: str(main.id, 80) } : {}),
  };
}

/** What changed between two snapshots, as short lines (the sweep's diff). Order and wording are stable. */
export function diffSnapshots(prev: Snapshot | undefined, next: Snapshot): string[] {
  if (!prev) return [];
  const out: string[] = [], name = new Map(next.spaces.map((s) => [s.id, s.name]));
  for (const s of next.spaces) {
    const was = prev.spaces.find((x) => x.id === s.id);
    if (!was) out.push(`New ${s.kind}: ${s.name}`);
    else if (s.examDate && s.examDate !== was.examDate) out.push(`Exam date for ${s.name}: ${s.examDate}`);
  }
  for (const p of next.plans) {
    const was = prev.plans.find((x) => x.spaceId === p.spaceId);
    if (was?.rev === p.rev) continue;
    const before = new Map((was?.tasks || []).map((t) => [t.id, t]));
    const added = p.tasks.filter((t) => !before.has(t.id)).length, done = p.tasks.filter((t) => t.done && !before.get(t.id)?.done).length;
    const moved = p.tasks.filter((t) => before.has(t.id) && (before.get(t.id)!.due !== t.due || before.get(t.id)!.time !== t.time)).length;
    const bits = [added && `${added} added`, done && `${done} done`, moved && `${moved} moved`].filter(Boolean);
    if (bits.length) out.push(`Plan for ${name.get(p.spaceId) || "a space"}: ${bits.join(", ")}`);
  }
  for (const st of next.study) {
    const was = prev.study.find((x) => x.spaceId === st.spaceId);
    if (st.due >= 5 && (!was || was.due < 5)) out.push(`${st.due} flashcards due in ${name.get(st.spaceId) || "a subject"}`);
  }
  const seen = new Set(prev.loose.map((f) => f.id));
  for (const f of next.loose) if (!seen.has(f.id)) out.push(`New file not in a subject: ${f.name}`);
  for (const r of next.rooms) {
    const was = prev.rooms.find((x) => x.spaceId === r.spaceId);
    if (r.failed > (was?.failed || 0)) out.push(`A thread failed in ${name.get(r.spaceId) || "a project"}`);
  }
  const heard = new Set(prev.said.map((m) => m.id));
  const fresh = next.said.filter((m) => m.main && !heard.has(m.id)).length;
  if (fresh) out.push(`${fresh} new message${fresh === 1 ? "" : "s"} from you in the main thread`);
  return out;
}
