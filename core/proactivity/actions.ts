// The organizer's actions: what a sweep may do on its own (reversible, shown with Undo) or offer with one tap
// (an automation). Each has a stable key, so the same action is never taken or offered twice. The appliers change the
// window's workspace (src/store.ts State) and return what Undo needs; they are pure and run in the window, which owns
// the workspace (docs/MAIN-THREAD.md "Where it lives").
import { z } from "zod";
import { applyUpdate, newPlan, type PlanTask, type SpacePlan } from "../plans.ts";
import type { Automation, Space, StoredFile } from "../types.ts";

const id = z.string().trim().min(1).max(100);
const title = z.string().trim().min(1).max(160);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const proAction = z.discriminatedUnion("type", [
  /** A task (or a milestone: an exam, a quiz) in the space's plan; the plan is made when it has none. */
  z.object({ type: z.literal("plan_task"), spaceId: id, title, due: ymd.optional(), time: hm.optional(), notes: z.string().max(400).optional(), milestone: z.boolean().optional() }),
  /** Today's time blocks (the morning brief): timed tasks in the plan, grouped "Today". */
  z.object({ type: z.literal("time_block"), spaceId: id, title, day: ymd, time: hm }),
  /** An overdue or clashing task moved to another day. */
  z.object({ type: z.literal("plan_move"), spaceId: id, taskId: z.string().min(1).max(40), title, due: ymd, time: hm.optional() }),
  /** Revision sessions counted back from an exam date. */
  z.object({ type: z.literal("revision_plan"), spaceId: id, examDate: ymd, sessions: z.array(z.object({ day: ymd, title })).min(1).max(30) }),
  /** A loose upload filed into its subject or project. */
  z.object({ type: z.literal("file_move"), fileId: id, name: title, spaceId: id }),
  /** A durable fact saved to memory. */
  z.object({ type: z.literal("memory"), text: z.string().trim().min(3).max(300) }),
  /** A routine for a request the person keeps repeating: offered, made only after one tap. */
  z.object({ type: z.literal("automation"), name: title, prompt: z.string().trim().min(3).max(600), schedule: z.enum(["daily", "weekly"]), time: hm, day: z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]).optional(), spaceId: id.optional() }),
  /** Something said, changing nothing: a clash, a follow-up, a grade, a project's next step, a new lecture. */
  z.object({ type: z.literal("note"), kind: z.enum(["clash", "followup", "grade", "project", "lecture", "info"]), text: z.string().trim().min(1).max(300), spaceId: id.optional(), key: z.string().max(200).optional() }),
]);
export type ProAction = z.infer<typeof proAction>;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80);
/** The stable key an action is deduplicated by: the same task, file, fact or offer is never acted on twice. */
export function actionKey(a: ProAction): string {
  switch (a.type) {
    case "plan_task": return `task:${a.spaceId}:${norm(a.title)}:${a.due || ""}`;
    case "time_block": return `block:${a.spaceId}:${norm(a.title)}:${a.day}`;
    case "plan_move": return `move:${a.spaceId}:${a.taskId}:${a.due}`;
    case "revision_plan": return `revision:${a.spaceId}:${a.examDate}`;
    case "file_move": return `file:${a.fileId}`;
    case "memory": return `memory:${norm(a.text)}`;
    case "automation": return `auto:${norm(a.name)}`;
    case "note": return a.key || `note:${a.kind}:${norm(a.text)}`;
  }
}
/** Destructive, outward or costly actions wait for one tap; the rest happen and show Undo. */
export const needsConfirm = (a: ProAction) => a.type === "automation";
export const changesWorkspace = (a: ProAction) => a.type !== "note";

/** One line for the card and the log. */
export function describe(a: ProAction, spaceName: (id: string) => string | undefined = () => undefined): string {
  const sp = (x?: string) => (x && spaceName(x) ? ` · ${spaceName(x)}` : "");
  switch (a.type) {
    case "plan_task": return `${a.milestone ? "Added to the timeline" : "Added task"}: ${a.title}${a.due ? ` (${a.due}${a.time ? " " + a.time : ""})` : ""}${sp(a.spaceId)}`;
    case "time_block": return `${a.time} ${a.title}${sp(a.spaceId)}`;
    case "plan_move": return `Moved “${a.title}” to ${a.due}${a.time ? " " + a.time : ""}${sp(a.spaceId)}`;
    case "revision_plan": return `Revision plan: ${a.sessions.length} session${a.sessions.length === 1 ? "" : "s"} before the exam on ${a.examDate}${sp(a.spaceId)}`;
    case "file_move": return `Filed ${a.name}${sp(a.spaceId) || " in its subject"}`;
    case "memory": return `Remembered: ${a.text}`;
    case "automation": return `Make a ${a.schedule} routine “${a.name}” at ${a.time}?`;
    case "note": return a.text;
  }
}

/** What an applied action changed, so Undo can put it back. */
export type Undo =
  | { kind: "plan"; spaceId: string; added: string[]; moved: { id: string; due?: string; time?: string }[]; created?: string }
  | { kind: "file"; fileId: string; spaceId: string | null; folderId?: string | null }
  | { kind: "memory"; line: string }
  | { kind: "automation"; id: string };
export type Workspace = { plans?: SpacePlan[]; files: StoredFile[]; spaces: Space[]; memory: string; automations: Automation[] };
export type Applied<W> = { state: W; undo: Undo | null } | { error: string };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The first run of a routine: the next matching time (and weekday) after `now`, local time. */
export function firstRun(schedule: { time: string; day?: string }, now: number) {
  const [h, m] = schedule.time.split(":").map(Number), d = new Date(now);
  d.setHours(h, m, 0, 0);
  const day = schedule.day ? DAYS.indexOf(schedule.day) : -1;
  if (day >= 0) d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7));
  if (d.getTime() <= now) d.setDate(d.getDate() + (day >= 0 ? 7 : 1));
  return d.getTime();
}

/** Applies one action to the workspace. A space or file that is gone is an error, nothing changes. */
export function applyAction<W extends Workspace>(w: W, a: ProAction, o: { now?: number; uid?: () => string } = {}): Applied<W> {
  const now = o.now ?? Date.now(), uid = o.uid || (() => crypto.randomUUID());
  if (a.type === "note") return { state: w, undo: null };
  if (a.type === "memory") {
    if (w.memory.split("\n").some((l) => norm(l) === norm(a.text))) return { state: w, undo: null };
    return { state: { ...w, memory: (w.memory.trim() ? w.memory.trimEnd() + "\n" : "") + a.text }, undo: { kind: "memory", line: a.text } };
  }
  if (a.type === "file_move") {
    const f = w.files.find((x) => x.id === a.fileId);
    if (!f || !w.spaces.some((s) => s.id === a.spaceId)) return { error: "That file or subject is gone." };
    return { state: { ...w, files: w.files.map((x) => (x.id === f.id ? { ...x, spaceId: a.spaceId, folderId: null } : x)) }, undo: { kind: "file", fileId: f.id, spaceId: f.spaceId, folderId: f.folderId ?? null } };
  }
  if (a.type === "automation") {
    const auto: Automation = { id: uid(), name: a.name, prompt: a.prompt, schedule: a.schedule, enabled: true, spaceId: a.spaceId ?? null, nextRun: firstRun(a, now) };
    return { state: { ...w, automations: [...w.automations, auto] }, undo: { kind: "automation", id: auto.id } };
  }
  const space = w.spaces.find((s) => s.id === a.spaceId);
  if (!space) return { error: "That subject or project is gone." };
  const plans = w.plans || [];
  let plan = plans.find((p) => p.spaceId === space.id), created: string | undefined;
  if (!plan) { plan = newPlan(space.id, { title: `${space.name} plan`, tasks: [] }, now, uid()); created = plan.id; }
  const tasks: PlanTask[] = a.type === "plan_task" ? [{ id: "", title: a.title, ...(a.due ? { due: a.due } : {}), ...(a.due && a.time ? { time: a.time } : {}), ...(a.notes ? { notes: a.notes } : {}), ...(a.milestone ? { kind: "milestone" as const } : {}) }]
    : a.type === "time_block" ? [{ id: "", title: a.title, due: a.day, time: a.time, group: "Today" }]
    : a.type === "revision_plan" ? a.sessions.map((s) => ({ id: "", title: s.title, due: s.day, group: "Before the exam" }))
    : [];
  if (a.type === "plan_move") {
    const t = plan.tasks.find((x) => x.id === a.taskId);
    if (!t) return { error: "That task is gone." };
    const r = applyUpdate(plan, { action: "update", summary: "Clem moved a task", changes: [{ op: "edit", id: t.id, fields: { due: a.due, time: a.time ?? "" } }] }, now, uid());
    return { state: { ...w, plans: plans.map((p) => (p.id === plan!.id ? r.plan : p)) }, undo: { kind: "plan", spaceId: space.id, added: [], moved: [{ id: t.id, ...(t.due ? { due: t.due } : {}), ...(t.time ? { time: t.time } : {}) }] } };
  }
  const before = new Set(plan.tasks.map((t) => t.id));
  const r = applyUpdate(plan, { action: "update", summary: "Clem added to your plan", changes: tasks.map((task) => ({ op: "add" as const, task })) }, now, uid());
  const added = r.plan.tasks.filter((t) => !before.has(t.id)).map((t) => t.id);
  return { state: { ...w, plans: created ? [...plans, r.plan] : plans.map((p) => (p.id === plan!.id ? r.plan : p)) }, undo: { kind: "plan", spaceId: space.id, added, moved: [], ...(created ? { created } : {}) } };
}

/** Puts back what an action changed. Later edits by hand are kept: only the action's own tasks, file, fact or routine go. */
export function undoAction<W extends Workspace>(w: W, u: Undo, now = Date.now()): W {
  if (u.kind === "memory") return { ...w, memory: w.memory.split("\n").filter((l) => l !== u.line).join("\n") };
  if (u.kind === "file") return { ...w, files: w.files.map((f) => (f.id === u.fileId ? { ...f, spaceId: u.spaceId, folderId: u.folderId ?? null } : f)) };
  if (u.kind === "automation") return { ...w, automations: w.automations.filter((x) => x.id !== u.id) };
  const plans = w.plans || [], plan = plans.find((p) => p.spaceId === u.spaceId);
  if (!plan) return w;
  const changes = [...u.added.filter((id) => plan.tasks.some((t) => t.id === id)).map((id) => ({ op: "remove" as const, id })),
    ...u.moved.filter((m) => plan.tasks.some((t) => t.id === m.id)).map((m) => ({ op: "edit" as const, id: m.id, fields: { due: m.due ?? "", time: m.time ?? "" } }))];
  if (!changes.length) return w;
  const next = applyUpdate(plan, { action: "update", summary: "Undid Clem's change", changes }, now).plan;
  // A plan Clem made that is now empty goes with it.
  if (u.created === plan.id && !next.tasks.length) return { ...w, plans: plans.filter((p) => p.id !== plan.id) };
  return { ...w, plans: plans.map((p) => (p.id === plan.id ? next : p)) };
}
