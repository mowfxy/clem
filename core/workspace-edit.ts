// What the AI can change in the person's workspace when they ask (kinetra actions "edit.*"): their files (rename, move,
// delete), folders, subjects and projects, and plan tasks. One pure applier for every place a turn runs: the window
// applies it to its own state (desktop/main.ts asks it through the chat's "edit" task, src/App.tsx), the VPS worker to
// its mirror and queues it as a workspace op (core/workspace-ops.ts "edit") that the window applies when it opens.
// Coming up is GUC's (guc.fix, guc.add, guc.remove); the schedule's reminders are clem.*.
import { z } from "zod";
import { applyUpdate, newPlan, type PlanChange, type PlanTask } from "./plans.ts";
import type { Space, SpaceFolder, StoredFile } from "./types.ts";
import type { SpacePlan } from "./plans.ts";

export const EDIT_ACTIONS = ["edit.file", "edit.folder", "edit.space", "edit.plan"] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];
const ALIASES: Record<string, EditAction> = { "edit.files": "edit.file", "file.rename": "edit.file", "file.move": "edit.file", "file.delete": "edit.file", "edit.folders": "edit.folder",
  "edit.subject": "edit.space", "edit.project": "edit.space", "edit.task": "edit.plan", "edit.tasks": "edit.plan" };
export function editAction(action: unknown): EditAction | null {
  const a = String(action || "");
  return (EDIT_ACTIONS as readonly string[]).includes(a) ? (a as EditAction) : ALIASES[a] || null;
}
export const isEditAction = (action: unknown) => editAction(action) !== null;

export const EDIT_GUIDE = `Changing the person's workspace (only when they ask; send ONE request, then answer from its result):
- {"kinetra":{"action":"edit.file","file":"<file name or id>","rename":"New name.pdf","move":"<subject or project name, or \\"none\\" for loose files>","folder":"Folder/Sub folder","delete":true}}: renames a file, moves it into a subject, project or folder (a missing folder is made), or deletes it with its versions (only when they plainly ask to delete that file). Send only what changes.
- {"kinetra":{"action":"edit.folder","space":"<subject or project>","path":"Week 1/Notes","rename":"New name","delete":true}}: makes a folder (with neither rename nor delete), renames one, or removes one (its files move up a level, nothing is deleted).
- {"kinetra":{"action":"edit.space","space":"<subject or project>","rename":"…","description":"…","examDate":"YYYY-MM-DD"|""}} changes a subject or project; {"kinetra":{"action":"edit.space","create":"subject"|"project","rename":"Its name"}} makes a new one.
- {"kinetra":{"action":"edit.plan","space":"<subject or project>","changes":[{"op":"add","title":"…","due":"YYYY-MM-DD","time":"HH:MM","kind":"task"|"milestone"},{"op":"done","task":"<task id or title>"},{"op":"undo","task":"…"},{"op":"edit","task":"…","due":"YYYY-MM-DD","time":"HH:MM","title":"…"},{"op":"remove","task":"…"}]}}: changes plan tasks at once (a plan is made when the space has none).
Something changed only when the result says so: never say a file, folder, subject, plan or Coming up item was changed unless that request's result says it was. When the result is an error, say plainly what couldn't be done.`;

const name = z.string().trim().min(1).max(200);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "is YYYY-MM-DD");
const hm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "is HH:MM");
const planChange = z.object({ op: z.enum(["add", "done", "undo", "edit", "remove"]), task: z.string().trim().max(200).optional(), id: z.string().trim().max(200).optional(), title: z.string().trim().max(200).optional(),
  due: z.union([ymd, z.literal("")]).optional(), time: z.union([hm, z.literal("")]).optional(), kind: z.enum(["task", "milestone"]).optional(), group: z.string().trim().max(80).optional(), notes: z.string().max(400).optional() });
export const editArgs = {
  "edit.file": z.object({ file: name, rename: name.optional(), move: name.optional(), folder: z.string().trim().max(300).optional(), delete: z.boolean().optional() }),
  "edit.folder": z.object({ space: name.optional(), path: z.string().trim().min(1).max(300), rename: name.optional(), delete: z.boolean().optional() }),
  "edit.space": z.object({ space: name.optional(), create: z.enum(["subject", "project"]).optional(), rename: z.string().trim().min(1).max(100).optional(), description: z.string().max(400).optional(), examDate: z.union([ymd, z.literal("")]).optional() }),
  "edit.plan": z.object({ space: name.optional(), title: z.string().trim().max(120).optional(), changes: z.array(planChange).min(1).max(60) }),
} satisfies Record<EditAction, z.ZodType>;

export type EditWorkspace = { spaces: Space[]; files: StoredFile[]; plans?: SpacePlan[] };
/** What an edit did: the new state, a line for the model, and the files it deleted (their bytes go too, by the caller). */
export type EditResult<W> = { state: W; said: string; gone?: StoredFile[] } | { error: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const stem = (s: string) => norm(s).replace(/\.[a-z0-9]{1,5}$/, "");
/** A subject or project by id, @mention, exact name, then a name that contains it (or it the name). */
export function findSpaceIn(spaces: Space[], arg: string | undefined, here?: string | null): Space | { error: string } | undefined {
  const s = (arg || "").trim().replace(/^@/, "");
  if (!s) return here ? spaces.find((x) => x.id === here) : undefined;
  const n = norm(s);
  const hit = spaces.find((x) => x.id === s) || spaces.find((x) => norm(x.name) === n);
  if (hit) return hit;
  const near = spaces.filter((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
  if (near.length === 1) return near[0];
  return { error: near.length ? `"${s}" could be ${near.slice(0, 4).map((x) => x.name).join(" or ")}: say which.` : `No subject or project is called "${s}". There are: ${spaces.slice(0, 20).map((x) => x.name).join(", ") || "none yet"}.` };
}
/** A file by id, exact name, name without its extension, then one name that contains it. */
export function findFileIn(files: StoredFile[], arg: string, spaceId?: string | null): StoredFile | { error: string } {
  const s = arg.trim().replace(/^guc[_:]/, "guc_"), n = norm(s), st = stem(s);
  const pool = spaceId ? [...files.filter((f) => f.spaceId === spaceId), ...files.filter((f) => f.spaceId !== spaceId)] : files;
  const one = (list: StoredFile[]) => (list.length === 1 ? list[0] : list.length > 1 && spaceId && list.filter((f) => f.spaceId === spaceId).length === 1 ? list.find((f) => f.spaceId === spaceId) : undefined);
  const hit = files.find((f) => f.id === s) || one(pool.filter((f) => norm(f.name) === n)) || one(pool.filter((f) => stem(f.name) === st)) || one(pool.filter((f) => norm(f.name).includes(st)));
  if (hit) return hit;
  const near = pool.filter((f) => norm(f.name).includes(st) || stem(f.name) === st).slice(0, 5);
  return { error: near.length ? `"${arg}" could be ${near.map((f) => `${f.name} (${f.id})`).join(", ")}: give the id.` : `No file called "${arg}" in Clem.` };
}

/** A folder path ("Week 1/Notes") in a space: the folder at its end, made (with its parents) when `make`. */
function folderAt(space: Space, path: string, make: boolean, uid: () => string, now: number): { space: Space; folder?: SpaceFolder } | { error: string } {
  const parts = path.split(/[\\/]+/).map((p) => p.trim()).filter(Boolean);
  let folders = [...(space.folders || [])], parent: string | null = null, folder: SpaceFolder | undefined;
  for (const p of parts) {
    folder = folders.find((f) => f.parentId === parent && norm(f.name) === norm(p));
    if (!folder) {
      if (!make) return { error: `${space.name} has no folder "${parts.join("/")}".` };
      folder = { id: uid(), name: p.slice(0, 100), parentId: parent, created: now };
      folders = [...folders, folder];
    }
    parent = folder.id;
  }
  return { space: folders === space.folders ? space : { ...space, folders }, folder };
}
const pathOf = (space: Space, id: string | null | undefined) => {
  const out: string[] = [];
  for (let f = space.folders?.find((x) => x.id === id); f; f = space.folders?.find((x) => x.id === f!.parentId)) out.unshift(f.name);
  return out.join("/");
};
const place = (w: EditWorkspace, f: StoredFile) => { const s = w.spaces.find((x) => x.id === f.spaceId); return s ? `${s.name}${f.folderId ? " → " + pathOf(s, f.folderId) : ""}` : "your loose files"; };
const withSpace = <W extends EditWorkspace>(w: W, s: Space): W => ({ ...w, spaces: w.spaces.map((x) => (x.id === s.id ? s : x)) });

/** Applies one edit.* request. Never throws; `here` is the chat's own subject or project. */
export function applyEdit<W extends EditWorkspace>(w: W, request: Record<string, unknown>, o: { here?: string | null; now?: number; uid?: () => string } = {}): EditResult<W> {
  const action = editAction(request.action);
  if (!action) return { error: `Unknown edit action "${String(request.action)}".` };
  const { action: _a, ...rest } = request;
  const parsed = (editArgs[action] as z.ZodType).safeParse(rest);
  if (!parsed.success) { const i = parsed.error.issues[0]; return { error: `${action}: ${i.path.join(".") || "request"} ${i.message.toLowerCase()}.` }; }
  const a = parsed.data as Record<string, any>, now = o.now ?? Date.now(), uid = o.uid || (() => crypto.randomUUID());
  switch (action) {
    case "edit.file": return editFile(w, a, o.here ?? null, now, uid);
    case "edit.folder": return editFolder(w, a, o.here ?? null, now, uid);
    case "edit.space": return editSpace(w, a, o.here ?? null, uid);
    case "edit.plan": return editPlan(w, a, o.here ?? null, now, uid);
  }
}

function editFile<W extends EditWorkspace>(w: W, a: Record<string, any>, here: string | null, now: number, uid: () => string): EditResult<W> {
  const f = findFileIn(w.files, a.file, here);
  if ("error" in f) return f;
  if (a.delete) {
    if (a.rename || a.move || a.folder) return { error: "edit.file: delete can't be sent with rename, move or folder." };
    return { state: { ...w, files: w.files.filter((x) => x.id !== f.id), spaces: w.spaces.map((s) => (s.sources.includes(f.id) ? { ...s, sources: s.sources.filter((id) => id !== f.id) } : s)) }, said: `Deleted ${f.name} (from ${place(w, f)}).`, gone: [f] };
  }
  if (!a.rename && a.move === undefined && a.folder === undefined) return { error: "edit.file: send rename, move, folder or delete." };
  let state = w, next: StoredFile = { ...f };
  if (a.rename) {
    // The extension stays unless a new one is given.
    const ext = /\.[a-z0-9]{1,5}$/i.exec(f.name)?.[0] || "", clean = a.rename.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
    next.name = /\.[a-z0-9]{1,5}$/i.test(clean) ? clean : clean + ext;
  }
  if (a.move !== undefined) {
    if (/^(none|no subject|loose|files|nowhere)$/i.test(a.move)) { next.spaceId = null; next.folderId = null; }
    else {
      const s = findSpaceIn(w.spaces, a.move);
      if (!s || "error" in s) return s || { error: `No subject or project is called "${a.move}".` };
      if (s.id !== f.spaceId) next.folderId = null;
      next.spaceId = s.id;
    }
  }
  if (a.folder !== undefined) {
    const space = state.spaces.find((s) => s.id === next.spaceId);
    if (!a.folder.trim()) next.folderId = null;
    else {
      if (!space) return { error: "Loose files have no folders: move the file into a subject or project first (\"move\")." };
      const r = folderAt(space, a.folder, true, uid, now);
      if ("error" in r) return r;
      state = withSpace(state, r.space);
      next.folderId = r.folder?.id ?? null;
    }
  }
  next = { ...next, updated: now };
  state = { ...state, files: state.files.map((x) => (x.id === f.id ? next : x)) };
  const did = [a.rename && next.name !== f.name ? `renamed ${f.name} to ${next.name}` : "", next.spaceId !== f.spaceId || next.folderId !== f.folderId ? `moved ${a.rename ? "it" : f.name} to ${place(state, next)}` : ""].filter(Boolean);
  if (!did.length) return { error: `${f.name} is already like that; nothing changed.` };
  return { state, said: did.join(" and ").replace(/^./, (c) => c.toUpperCase()) + "." };
}

function editFolder<W extends EditWorkspace>(w: W, a: Record<string, any>, here: string | null, now: number, uid: () => string): EditResult<W> {
  const s = findSpaceIn(w.spaces, a.space, here);
  if (!s) return { error: 'edit.folder: say which subject or project ("space").' };
  if ("error" in s) return s;
  if (a.rename && a.delete) return { error: "edit.folder: send rename or delete, not both." };
  if (!a.rename && !a.delete) {
    const had = folderAt(s, a.path, false, uid, now);
    if (!("error" in had)) return { error: `${s.name} already has the folder ${a.path}.` };
    const r = folderAt(s, a.path, true, uid, now);
    if ("error" in r) return r;
    return { state: withSpace(w, r.space), said: `Made the folder ${s.name} → ${a.path}.` };
  }
  const r = folderAt(s, a.path, false, uid, now);
  if ("error" in r) return r;
  const folder = r.folder!;
  if (a.rename) {
    const clean = a.rename.replace(/[\\/]+/g, "-").trim().slice(0, 100);
    if (s.folders!.some((f) => f.id !== folder.id && f.parentId === folder.parentId && norm(f.name) === norm(clean))) return { error: `There is already a folder called ${clean} there.` };
    return { state: withSpace(w, { ...s, folders: s.folders!.map((f) => (f.id === folder.id ? { ...f, name: clean } : f)) }), said: `Renamed the folder ${a.path} in ${s.name} to ${clean}.` };
  }
  // Removing a folder never deletes files: its files and folders move up one level.
  const n = w.files.filter((f) => f.spaceId === s.id && f.folderId === folder.id).length;
  const space = { ...s, folders: s.folders!.filter((f) => f.id !== folder.id).map((f) => (f.parentId === folder.id ? { ...f, parentId: folder.parentId } : f)) };
  return { state: { ...withSpace(w, space), files: w.files.map((f) => (f.spaceId === s.id && f.folderId === folder.id ? { ...f, folderId: folder.parentId } : f)) }, said: `Removed the folder ${a.path} from ${s.name}${n ? `; its ${n} file${n === 1 ? "" : "s"} moved up a level` : ""}.` };
}

function editSpace<W extends EditWorkspace>(w: W, a: Record<string, any>, here: string | null, uid: () => string): EditResult<W> {
  if (a.create) {
    if (!a.rename) return { error: 'edit.space: a new subject or project needs its name in "rename".' };
    const same = w.spaces.find((s) => s.kind === a.create && norm(s.name) === norm(a.rename));
    if (same) return { error: `There is already a ${a.create} called ${same.name}.` };
    const space: Space = { id: uid(), name: a.rename, kind: a.create, description: a.description || "", memory: "", sources: [], ...(a.examDate ? { examDate: a.examDate } : {}) };
    return { state: { ...w, spaces: [space, ...w.spaces] }, said: `Made the ${a.create} ${space.name}.` };
  }
  const s = findSpaceIn(w.spaces, a.space, here);
  if (!s) return { error: 'edit.space: say which subject or project ("space").' };
  if ("error" in s) return s;
  if (a.rename === undefined && a.description === undefined && a.examDate === undefined) return { error: "edit.space: send rename, description or examDate." };
  const next: Space = { ...s, ...(a.rename ? { name: a.rename } : {}), ...(a.description !== undefined ? { description: a.description } : {}) };
  if (a.examDate !== undefined) { if (a.examDate) next.examDate = a.examDate; else delete next.examDate; }
  const did = [a.rename && a.rename !== s.name ? `renamed ${s.name} to ${a.rename}` : "", a.description !== undefined ? "changed its description" : "", a.examDate !== undefined ? (a.examDate ? `set its exam date to ${a.examDate}` : "cleared its exam date") : ""].filter(Boolean);
  return { state: withSpace(w, next), said: (a.rename ? "" : `${s.name}: `) + did.join(", ").replace(/^./, (c) => c.toUpperCase()) + "." };
}

function editPlan<W extends EditWorkspace>(w: W, a: Record<string, any>, here: string | null, now: number, uid: () => string): EditResult<W> {
  const s = findSpaceIn(w.spaces, a.space, here);
  if (!s) return { error: 'edit.plan: say which subject or project ("space").' };
  if ("error" in s) return s;
  const plans = w.plans || [];
  let plan = plans.find((p) => p.spaceId === s.id), made = false;
  if (!plan) {
    if (a.changes.some((c: any) => c.op !== "add")) return { error: `${s.name} has no plan yet, so there is no task to change. Only "add" works.` };
    plan = newPlan(s.id, { title: a.title || `${s.name} plan`, tasks: [] }, now, uid());
    made = true;
  }
  const task = (ref?: string): PlanTask | undefined => {
    if (!ref) return undefined;
    const n = norm(ref);
    return plan!.tasks.find((t) => t.id === ref) || plan!.tasks.find((t) => norm(t.title) === n) || (() => { const hits = plan!.tasks.filter((t) => norm(t.title).includes(n)); return hits.length === 1 ? hits[0] : undefined; })();
  };
  const changes: PlanChange[] = [], missing: string[] = [];
  for (const c of a.changes) {
    if (c.op === "add") {
      if (!c.title) { missing.push("an added task with no title"); continue; }
      changes.push({ op: "add", task: { id: "", title: c.title, ...(c.due ? { due: c.due } : {}), ...(c.due && c.time ? { time: c.time } : {}), ...(c.kind ? { kind: c.kind } : {}), ...(c.group ? { group: c.group } : {}), ...(c.notes ? { notes: c.notes } : {}) } });
      continue;
    }
    const t = task(c.task || c.id || (c.op !== "edit" ? c.title : undefined));
    if (!t) { missing.push(`"${c.task || c.id || c.title || "?"}"`); continue; }
    if (c.op === "edit") {
      const fields: Record<string, string> = {};
      for (const k of ["title", "due", "time", "kind", "group", "notes"] as const) if (c[k] !== undefined && !(k === "title" && (c[k] === t.title || !c[k]))) fields[k] = c[k];
      if (!Object.keys(fields).length) { missing.push(`nothing to change on "${t.title}"`); continue; }
      changes.push({ op: "edit", id: t.id, fields });
    } else changes.push({ op: c.op, id: t.id });
  }
  if (!changes.length) return { error: `Nothing in ${s.name}'s plan changed: no task matches ${missing.join(", ")}.${plan.tasks.length ? " Its tasks: " + plan.tasks.slice(0, 30).map((t) => `${t.id} ${t.title}`).join("; ") + "." : ""}` };
  const r = applyUpdate(plan, { action: "update", summary: "Changed in chat", ...(a.title ? { title: a.title } : {}), changes }, now, uid());
  const nextPlans = made ? [...plans, r.plan] : plans.map((p) => (p.id === plan!.id ? r.plan : p));
  const done = changes.map((c) => c.op === "add" ? `added "${c.task.title}"${c.task.due ? ` (${c.task.due}${c.task.time ? " " + c.task.time : ""})` : ""}` : `${c.op === "done" ? "marked done" : c.op === "undo" ? "marked not done" : c.op === "remove" ? "removed" : "changed"} "${plan!.tasks.find((t) => t.id === c.id)?.title}"`);
  return { state: { ...w, plans: nextPlans }, said: `${s.name}'s plan: ${done.join("; ")}.${missing.length ? ` Not found: ${missing.join(", ")}.` : ""}` };
}
