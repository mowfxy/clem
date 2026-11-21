// The AI's GUC tools, run for one owner (docs/GUC-VPS-ENGINE.md → AI tools): each kinetra "guc.*" request becomes
// owner-scoped engine reads, and the result is compact text with #/app/guc links to cite. The engine is per owner;
// a request is refused when the engine is not the signed-in owner's.
import { announcementsText, correctionsText, deadlinesText, deadlineWindow, fileTextPage, findItem, GUC_GUIDE, gradesText, attendanceText, gucAction, label, link, mailListText, mailText, materialsText, readArgs, resolveSubject, scheduleDays, scheduleText, searchText, since, type Resolved, type ToolSubject } from "../../core/guc/ai-tools.ts";
import { applyCorrections, fingerprint, matches, ruleSentence, staleRule, type Correction, type RecordTarget, type Rule } from "../../core/guc/corrections.ts";
import { mailTextId } from "../../core/guc/deadline-ai.ts";
import { cairoInstant, whenText } from "../../core/guc/deadlines.ts";
import { cairo, type HubDeadline } from "../../core/guc/hub.ts";
import type { GucDeadline } from "../../core/guc/types.ts";
import { settingsUpdateCard } from "../../core/guc/cards.ts";
import { AI_RULES_FORMAT, describeSaveRules } from "../../core/guc/rules.ts";
import { describeChecks } from "../../core/guc/schedule-rules.ts";
import { ALL_SUBJECTS, settingsPatch, type SubjectView } from "../../core/guc/settings.ts";
import { updatePatch } from "../../core/guc/setup-flow.ts";
import { asGucError, GucError } from "./errors.ts";
import type { Engine } from "./index.ts";

export type GucToolContext = {
  engine: Engine;
  /** The signed-in owner the request is for: must be the engine's. */
  owner: string;
  /** The person's subjects (names, exam dates) from the window's state: the engine knows only their ids. */
  subjects: ToolSubject[];
  /** The chat's own subject, the default when a request names none. */
  scope?: string;
  now?: number;
  /** A setting changed: the window refreshes its cards. */
  changed?: () => void;
  /** The VPS worker, while it runs Clem's jobs: its database is the one the hub shows, so every guc.* request (reads,
   *  corrections, re-reads) runs there. A worker too old for it says "Not allowed" and the request runs here. */
  remote?: (request: Record<string, unknown>, ctx: { subjects: ToolSubject[]; scope?: string; now?: number }) => Promise<string | { error: string }>;
};

/** One guc.* request's result: text for the model, or { error }. */
export async function runGucTool(ctx: GucToolContext, request: Record<string, unknown>): Promise<string | { error: string }> {
  if (ctx.engine.owner !== ctx.owner) throw Error("GUC tools: the engine is not this owner's.");
  if (ctx.remote && gucAction(request.action)) {
    try {
      const out = await ctx.remote(request, { subjects: ctx.subjects, scope: ctx.scope, now: ctx.now });
      ctx.changed?.();
      return out;
    } catch (e) {
      if (!/Not allowed|No such method/.test(String((e as Error)?.message))) return { error: "Your VPS couldn't do that just now: " + String((e as Error)?.message || "no answer").slice(0, 200) };
    }
  }
  const action = gucAction(request.action);
  if (!action) return { error: `Unknown GUC action "${String(request.action)}". ${GUC_GUIDE}` };
  if (action === "guc.help") return GUC_GUIDE;
  const parsed = readArgs(action, request);
  if (!parsed.ok) return { error: parsed.error };
  const a = parsed.args as Record<string, any>, e = ctx.engine, now = ctx.now ?? Date.now();
  try {
    if (!(await e.status()).connected) return { error: "GUC isn't connected. The person can connect it in Settings → Connectors → GUC." };
    const [links, courses] = await Promise.all([e.links(), e.courses()]);
    const course = resolveSubject(a.subject, { links, courses, subjects: ctx.subjects, scope: ctx.scope });
    if (course && "error" in course) return course;
    const need = (): Resolved | { error: string } => course || { error: `${action} needs "subject" (a subject's name, @mention or course code).${links.length ? " Linked: " + links.map((l) => `${ctx.subjects.find((s) => s.id === l.subjectId)?.name || l.name} (${l.code})`).join(", ") + "." : ""}` };
    switch (action) {
      case "guc.schedule": {
        const days = scheduleDays(a.range, now);
        if ("error" in days) return days;
        return scheduleText((await e.schedule(days.days[0])).slots, days.days, course || undefined);
      }
      case "guc.deadlines": {
        const w = deadlineWindow(a.range, now);
        if ("error" in w) return w;
        return deadlinesText(await e.deadlines(), w, now, course || undefined);
      }
      case "guc.announcements": {
        const from = since(a.since, now);
        if (Number.isNaN(from)) return { error: `"since" is a date (YYYY-MM-DD) or a number of days ("7d").` };
        const limit = a.limit ?? 15, items = [];
        let cursor: string | undefined, more = false;
        // Newest first, a page at a time, until the window or the limit ends it.
        for (let page = 0; page < 4; page++) {
          const p = await e.announcements({ courseKey: course?.courseKey, cursor });
          for (const x of p.items) if ((from === undefined || x.firstSeen >= from) && (!a.unread || !x.read)) items.push(x);
          cursor = p.next;
          if (!cursor || items.length >= limit || (from !== undefined && (p.items.at(-1)?.firstSeen ?? 0) < from)) { more = !!cursor && from === undefined; break; }
        }
        return announcementsText(items.slice(0, limit), { more: more || items.length > limit }, course || undefined);
      }
      case "guc.materials": {
        const c = need();
        if ("error" in c) return c;
        return materialsText(await e.materials(c.courseKey), c);
      }
      case "guc.search": {
        const hits = await e.search(a.query);
        return searchText(hits, a.query, course || undefined);
      }
      case "guc.grades": return gradesText(await e.grades(), course || undefined);
      case "guc.attendance": return attendanceText((await e.term()).attendance, course || undefined);
      case "guc.read": return readFile(ctx, a.file, a.from, course || undefined);
      case "guc.mail": {
        // The AI reading a message for the person never marks it read; only their own open in the hub does.
        if (a.id) return mailText(await e.mailMessage(a.id, { markRead: false }));
        const m = await e.mail();
        return mailListText(m.items, { limit: a.limit ?? 20, query: a.query, missed: m.missed });
      }
      case "guc.save": {
        const id = await findMaterial(e, a.file, course || undefined);
        if (!id) return { error: `No CMS file "${a.file}". List a subject's files with {"action":"guc.materials","subject":…}.` };
        if (typeof id === "object") return id;
        const r = await e.saveFile(id, a.drive !== undefined ? { drive: a.drive } : {});
        ctx.changed?.();
        return `${r.already ? "Already saved" : "Saved"} ${r.name} to their files${r.subjectId ? " (under its subject)" : ""}${r.drive ? `, and uploaded it to Google Drive → ${r.drive.folder}` : ""}. Say so in one short sentence.`;
      }
      case "guc.settings": return settings(ctx, a, a.everywhere ? "all" : need());
      case "guc.correct": return correctItem(ctx, a, course || undefined, now);
      case "guc.learn": {
        const rule = toRule(a.rule);
        const c = await e.correct({ kind: "rule", ...(course && rule.type !== "max_age" ? { courseKey: course.courseKey } : {}), patch: { rule, text: a.text }, label: a.text });
        return `Learned${course ? ` for ${label(course)}` : ""}: ${c.label} Clem's deadline reader follows it from the next sync on${rule.type === "note" ? "" : ", and the code enforces it"}. Say so in one plain sentence.`;
      }
      case "guc.corrections": return correctionsText(await e.corrections(), course || undefined);
      case "guc.uncorrect": {
        const c = await e.uncorrect(a.id);
        return c ? `Lifted: ${c.label}. ${c.kind === "rule" ? "Clem no longer follows that rule." : "It is back as Clem read it."} Say so in one plain sentence.` : { error: "No correction in force has that id. guc.corrections lists them." };
      }
      case "guc.resync": {
        const r = await e.resync(course?.courseKey);
        return `Read GUC again${course ? ` for ${label(course)}` : ""}: ${r.events ? `${r.events} new thing${r.events === 1 ? "" : "s"} found` : "nothing new"}${r.missed.length ? `; couldn't read ${r.missed.join(", ")} this time` : ""}. Corrections still hold. Say so plainly.`;
      }
      case "guc.reread": return reread(ctx, a.message, course || undefined, need);
      case "guc.rebuild": {
        const c = need();
        if ("error" in c) return c;
        const count = async () => (await e.deadlines()).filter((d) => d.courseKey === c.courseKey && !d.done && d.source !== "portal").length;
        const was = await count();
        await e.rebuild(c.courseKey);
        const is = await count();
        return `Cleared what Clem had worked out for ${label(c)} and read it again from GUC: ${is} upcoming item${is === 1 ? "" : "s"} now (was ${was}). Their corrections still hold. Say so plainly.`;
      }
      case "guc.link": return relink(ctx, a.subject, a.course);
    }
  } catch (error) {
    const g = asGucError(error);
    return { error: g.message || "GUC couldn't be read right now." };
  }
  return { error: "Unknown GUC action." };
}

/** The material a "file" names: its id (or guc_<id>), else a file name or title, in the course first. */
async function findMaterial(e: Engine, file: string, course?: Resolved) {
  const id = file.replace(/^(guc[_:])/, "");
  const [byId] = await e.db.query<{ material_id: string }>("select material_id from guc_materials where owner_id = $1 and material_id = $2", [e.owner, id]);
  if (byId) return byId.material_id;
  const name = file.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, "");
  const rows = await e.db.query<{ material_id: string; title: string; course_key: string }>("select material_id, title, course_key from guc_materials where owner_id = $1 and lower(title) like $2 order by (course_key = $3) desc, first_seen desc limit 5",
    [e.owner, "%" + name.replace(/[\\%_]/g, (c) => "\\" + c) + "%", course?.courseKey || ""]);
  const exact = rows.filter((r) => r.title.toLowerCase() === name), here = rows.filter((r) => r.course_key === course?.courseKey);
  const one = [exact.find((r) => r.course_key === course?.courseKey), exact.length === 1 ? exact[0] : undefined, here.length === 1 ? here[0] : undefined, rows.length === 1 ? rows[0] : undefined].find(Boolean);
  if (one) return one.material_id;
  return rows.length ? { error: `"${file}" could be ${rows.map((r) => `${r.title} (${r.material_id})`).join(", ")}: give the id.` } : undefined;
}

async function readFile(ctx: GucToolContext, file: string, from: number | undefined, course?: Resolved) {
  const id = await findMaterial(ctx.engine, file, course);
  if (!id) return { error: `No CMS file "${file}". List a subject's files with {"action":"guc.materials","subject":…} or search with guc.search.` };
  if (typeof id === "object") return id;
  const [m] = await ctx.engine.db.query<{ course_key: string; week: string }>("select course_key, week from guc_materials where owner_id = $1 and material_id = $2", [ctx.engine.owner, id]);
  const t = await ctx.engine.fileText(id);
  const page = fileTextPage(t, from);
  const head = `${t.name} · ${m.week} · ${t.stored ? "saved" : "read from CMS (not saved)"} · ${page.total} ${t.unit}${page.total === 1 ? "" : "s"} ${link("cms", m.course_key, id)}`;
  const tail = page.next ? `\n\n[Continues at ${t.unit} ${page.next} of ${page.total}: {"action":"guc.read","file":"${id}","from":${page.next}}]` : "";
  return `${head}\n${page.text}${tail}`;
}

/** guc.settings: the same converters and checks as a settings_update block (core/guc/setup-flow.ts updatePatch) and the
 *  same engine call a card makes. */
async function settings(ctx: GucToolContext, a: Record<string, any>, c: Resolved | { error: string } | "all") {
  if (c === "all") return settingsEverywhere(ctx, a);
  if ("error" in c) return c;
  if (!c.subjectId) return { error: `${label(c)} isn't linked to a subject; link it from the subject's CMS tab first.` };
  const { subject: _s, ...fields } = a;
  const card = settingsUpdateCard.safeParse({ type: "settings_update", ...fields });
  if (!card.success) return { error: `guc.settings: ${card.error.issues[0].path.join(".")} ${card.error.issues[0].message.toLowerCase()}.` };
  const v: SubjectView = await ctx.engine.subject(c.subjectId);
  const exam = ctx.subjects.find((s) => s.id === c.subjectId)?.examDate?.slice(0, 10);
  const patch = updatePatch(card.data, { save: v.settings.save, suggested: v.suggested.mode === "after_lectures" ? v.suggested.times : [], slots: v.slots, code: v.course?.code, exam: exam || undefined });
  const unread = [card.data.saveText && !patch.save ? `what to save ("${card.data.saveText}"): send "rules" as ${AI_RULES_FORMAT}` : "", card.data.checkText && !patch.check ? `when to check ("${card.data.checkText}"): send "check" as {"mode":"custom","times":[{"day":0-6 (0 is Sunday),"time":"HH:MM"}]}, or ask the person (an exam date, for example)` : ""].filter(Boolean);
  if (!Object.keys(patch).length) return { error: unread.length ? `Clem couldn't read ${unread.join("; and ")}.` : "Nothing to change: give saveText, checkText, rules, save, check or drive." };
  const checked = settingsPatch.safeParse(patch);
  if (!checked.success) return { error: `That setting isn't valid: ${checked.error.issues[0].path.join(".")} ${checked.error.issues[0].message.toLowerCase()}.` };
  const after = await ctx.engine.setSettings(c.subjectId, checked.data);
  ctx.changed?.();
  const s = after.settings;
  return `Updated ${label(c)}: saves ${describeSaveRules(s.save)}; checks ${describeChecks(s.check)} (Cairo); Drive copy ${s.drive.enabled ? "on" : "off"}.${unread.length ? ` Not changed (couldn't read): ${unread.join("; ")}.` : ""} Tell the person in one sentence.`;
}

/** guc.settings with "everywhere": what to keep and the Drive copy, for every linked subject and those linked later. */
async function settingsEverywhere(ctx: GucToolContext, a: Record<string, any>) {
  const { subject: _s, everywhere: _e, ...fields } = a;
  const card = settingsUpdateCard.safeParse({ type: "settings_update", ...fields });
  if (!card.success) return { error: `guc.settings: ${card.error.issues[0].path.join(".")} ${card.error.issues[0].message.toLowerCase()}.` };
  const was: SubjectView = await ctx.engine.subject(ALL_SUBJECTS);
  const { save, drive } = updatePatch(card.data, { save: was.settings.save });
  if (card.data.saveText && !save) return { error: `Clem couldn't read what to save ("${card.data.saveText}"): send "rules" as ${AI_RULES_FORMAT}.` };
  const checked = settingsPatch.safeParse({ ...(save ? { save } : {}), ...(drive ? { drive } : {}) });
  if (!checked.success || !Object.keys(checked.data).length) return { error: "For every course, Clem can change what it saves (saveText, rules or save) and the Drive copy (drive). When to check is per subject." };
  const after: SubjectView = await ctx.engine.setSettings(ALL_SUBJECTS, checked.data);
  ctx.changed?.();
  const n = (await ctx.engine.links()).length;
  return `Updated all ${n} linked course${n === 1 ? "" : "s"}, and every course linked later: saves ${describeSaveRules(after.settings.save)}; Drive copy ${after.settings.drive.enabled ? "on" : "off"}. Tell the person in one sentence.`;
}

const PAIR_CARD = '```clem-card\n{"type":"telegram_pair"}\n```';
/** telegram.pair (the pair card for the reply) and telegram.sendFile (a CMS file to the paired chat, through the same
 *  file fetch as guc.read). */
export async function runTelegramTool(ctx: GucToolContext, request: Record<string, unknown>): Promise<string | { error: string }> {
  if (ctx.engine.owner !== ctx.owner) throw Error("Telegram tools: the engine is not this owner's.");
  const t = ctx.engine.telegram;
  if (!t.available) return { error: "Telegram isn't available in this Clem." };
  try {
    if (request.action === "telegram.pair") {
      const paired = (await t.status(true)).paired;
      return paired ? `Telegram is already paired as ${paired.name}. Say so; the card lets them unpair:\n${PAIR_CARD}` : `Put this card in your reply: it shows the link and the code, and says Connected once they send it.\n${PAIR_CARD}`;
    }
    if (request.action !== "telegram.sendFile") return { error: "Unknown Telegram action." };
    const file = typeof request.file === "string" ? request.file.trim().slice(0, 300) : "";
    if (!file) return { error: 'telegram.sendFile needs "file" (a CMS file id or name).' };
    if (!(await t.paired())) return { error: 'Telegram isn\'t paired. Offer {"action":"telegram.pair"} so they can pair it.' };
    const [links, courses] = await Promise.all([ctx.engine.links(), ctx.engine.courses()]);
    const course = resolveSubject(typeof request.subject === "string" ? request.subject : undefined, { links, courses, subjects: ctx.subjects, scope: ctx.scope });
    if (course && "error" in course) return course;
    const id = await findMaterial(ctx.engine, file, course || undefined);
    if (!id) return { error: `No CMS file "${file}". List a subject's files with {"action":"guc.materials","subject":…}.` };
    if (typeof id === "object") return id;
    const r = await t.sendFile(id);
    return r.sent ? `Sent ${r.name} to their Telegram. Say so in one short sentence.` : `${r.name} is ${Math.round(r.size / 1048576)} MB, over Telegram's 50 MB: they were told in Telegram and offered Open in Clem. Say so briefly.`;
  } catch (error) {
    return { error: (error instanceof GucError ? error.message : (error as Error)?.message) || "Telegram couldn't be reached right now." };
  }
}

// ---------- Corrections (docs/GUC-VPS-ENGINE.md → Corrections) ----------
const said = (d: Pick<HubDeadline, "code" | "title">) => `${d.code ? d.code + " " : ""}${d.title}`;
/** A rule as stored, from the model's: `message` keys an "ignore" to the message the item was read from. */
function toRule(r: { type: string; days?: number; from?: string; words?: string[]; message?: boolean } | undefined, item?: Pick<GucDeadline, "ref">): Rule {
  if (r?.type === "max_age") return { type: "max_age", days: r.days || 14 };
  if (r?.type === "ignore") return { type: "ignore", ...(r.from ? { from: r.from } : {}), ...(r.words?.length ? { words: r.words } : {}), ...(r.message && item?.ref ? { ref: item.ref } : {}) };
  return { type: "note" };
}
/** guc.correct "add": an item the person told Clem about that no post gave it (a quiz posted as a picture, one told in
 *  class). It is theirs: kept through every sync (core/guc/corrections.ts "add") until they remove it or a post brings
 *  the same item. */
async function addItem(ctx: GucToolContext, a: Record<string, any>, course: Resolved | undefined, list: HubDeadline[]): Promise<string | { error: string }> {
  if (!course) return { error: 'guc.correct add: say which course: "subject".' };
  if (!a.date) return { error: 'guc.correct add: give "date" (YYYY-MM-DD), and "time" (HH:MM) when known.' };
  const title = String(a.title || a.item).trim().slice(0, 80);
  const at = a.time ? /^(\d{1,2}):(\d{2})$/.exec(a.time) : null;
  const due = new Date(cairoInstant(+a.date.slice(0, 4), +a.date.slice(5, 7), +a.date.slice(8, 10), at ? +at[1] : 23, at ? +at[2] : 59)).toISOString();
  const kind = a.kind || (/quiz/i.test(title) ? "quiz" : /exam|midterm|final/i.test(title) ? "exam" : /assignment|sheet|homework/i.test(title) ? "assignment" : "other");
  const item: GucDeadline = { id: "you-" + fingerprintId(course.courseKey + "|" + title.toLowerCase()), courseKey: course.courseKey, title, due, source: "you", kind, timeKnown: !!at, ...(a.place ? { place: a.place } : {}), ...(a.note ? { note: a.note } : {}) };
  // Already there under the same quiz/assignment: that one is corrected instead, so Coming up never holds it twice.
  const same = list.find((d) => d.courseKey === course.courseKey && fingerprint(d) === fingerprint(item));
  if (same) return correctItem(ctx, { ...a, do: "edit", item: same.id, title: undefined }, course, Date.now());
  const done = await ctx.engine.correct({ kind: "add", itemId: item.id, fingerprint: fingerprint(item), courseKey: course.courseKey, patch: { item }, label: `Added ${course.code ? course.code + " " : ""}${title} (${whenText(due, !!at)}${a.place ? ", " + a.place : ""}) to Coming up` }, { put: item });
  return `${done.label}. It holds through every sync. Tell them in one plain sentence ("undo that" takes it out).`;
}
const fingerprintId = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };
/** guc.correct: one item removed, edited, marked done, annotated or brought back, and what it taught kept as a rule. */
async function correctItem(ctx: GucToolContext, a: Record<string, any>, course: Resolved | undefined, now: number): Promise<string | { error: string }> {
  if (a.what === "grade" || a.what === "class" || a.what === "announcement" || a.what === "midterm") return correctRecord(ctx, a, a.what, course);
  const e = ctx.engine, list = await e.deadlines();
  if (a.do === "restore") return restore(ctx, a.item, list, course);
  if (a.do === "add") return addItem(ctx, a, course, list);
  const found = findItem(list, a.item, course);
  if ("error" in found) return a.do === "edit" && a.date ? { error: found.error + ` If it isn't in Coming up at all, add it: the same request with "do":"add".` } : found;
  // An exam seat is the portal's own record: an edit changes Clem's copy (what it shows and reminds from), not the portal.
  const portal = found.source === "portal" || found.id.startsWith("exam-");
  const stored = portal ? undefined : (await e.trackedItems()).find((d) => d.id === found.id);
  const base: GucDeadline = stored || { id: found.id, courseKey: found.courseKey, title: found.title, due: found.due, source: found.source, ...(found.kind ? { kind: found.kind } : {}) };
  const common = { itemId: found.id, ...(stored?.ref ? { sourceRef: stored.ref } : {}), ...(portal ? {} : { fingerprint: fingerprint(base) }), ...(found.courseKey ? { courseKey: found.courseKey } : {}), ...(stored ? { before: stored } : {}) };
  const when = whenText(found.due, found.timeKnown !== false);
  let done: Correction;
  if (a.do === "remove") done = await e.correct({ ...common, kind: "hide", patch: a.why ? { why: a.why } : {}, label: `Removed ${said(found)} (${when}) from Coming up` }, portal ? {} : { drop: found.id });
  else if (a.do === "done") done = await e.correct({ ...common, kind: "done", patch: {}, label: `Marked ${said(found)} (${when}) done` });
  else if (a.do === "note") {
    if (!a.note) return { error: 'guc.correct note: give "note" (their words).' };
    done = await e.correct({ ...common, kind: "note", patch: { note: a.note }, label: `Added a note to ${said(found)}: "${a.note}"` });
  } else {
    if (!a.title && !a.date && a.time === undefined && a.place === undefined) return { error: "guc.correct edit: give title, date, time or place." };
    const c = cairo(Date.parse(base.due)), timed = base.timeKnown !== false && c.time !== "23:59";
    const day = a.date || c.ymd, time = a.time === "" ? undefined : a.time || (timed ? c.time : undefined);
    const dueMoved = !!a.date || a.time !== undefined;
    const at = time ? /^(\d{1,2}):(\d{2})$/.exec(time)! : null;
    const due = new Date(cairoInstant(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), at ? +at[1] : 23, at ? +at[2] : 59)).toISOString();
    const patch = { ...(a.title ? { title: a.title } : {}), ...(dueMoved ? { due, timeKnown: !!at } : {}), ...(a.place !== undefined ? { place: a.place } : {}) };
    const changes = [a.title ? `now "${a.title}"` : "", dueMoved ? `now ${whenText(due, !!at)}` : "", a.place !== undefined ? (a.place ? `in ${a.place}` : "no place") : ""].filter(Boolean).join(", ");
    const draft: Correction = { id: "draft", kind: "edit", at: now, label: "", ...common, patch };
    const after = stored ? applyCorrections([stored], [draft], { now })[0] : undefined;
    done = await e.correct({ ...common, kind: "edit", patch, label: `Changed ${said(found)} (was ${when}): ${changes}` }, after ? { put: after } : {});
  }
  // What it taught: the rule the model named, else the stale-mail rule when that was the mistake, else its sentence.
  const rule = a.rule ? toRule(a.rule, stored) : a.do === "remove" && stored ? staleRule(stored, now) : undefined;
  let learned = "";
  if (rule || a.learn) {
    const r = rule || { type: "note" as const }, text = a.learn || ruleSentence(r), scope = r.type !== "max_age" ? found.courseKey || undefined : undefined;
    // The same rule twice is kept once.
    const known = (await e.corrections()).some((c) => c.kind === "rule" && c.courseKey === scope && JSON.stringify(c.patch.rule) === JSON.stringify(r) && (r.type !== "note" || c.label === text));
    if (!known) await e.correct({ kind: "rule", ...(r.type !== "max_age" && found.courseKey ? { courseKey: found.courseKey } : {}), patch: { rule: r, text }, label: text });
    learned = ` Clem learned: ${text}`;
  }
  return `${done.label}${portal && a.do === "edit" ? " in Clem's copy (the portal's own record is unchanged; Clem shows and reminds from this)" : ""}. It holds through every sync.${learned} Tell them what you changed in one plain sentence ("undo that" brings it back).`;
}

/** guc.correct on the portal's own records (owner, 2026-11-15): a grade, a class, an announcement or a midterm hidden,
 *  edited or annotated in Clem's copy (core/guc/corrections.ts applyRecordCorrections). The portal keeps its record. */
async function correctRecord(ctx: GucToolContext, a: Record<string, any>, target: RecordTarget, course: Resolved | undefined) {
  const e = ctx.engine, raw = await recordsOf(e, target, course);
  const words = String(a.item).toLowerCase().replace(/[^a-z0-9: ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const text = (r: Rec) => r.label.toLowerCase();
  const fixes = (await e.corrections()).filter((c) => c.patch?.target === target);
  if (a.do === "restore") {
    const mine = fixes.filter((c) => c.itemId === a.item || (words.length > 0 && words.every((w) => c.label.toLowerCase().includes(w))));
    if (!mine.length) return { error: `No change to a ${target} matching "${a.item}" is in force. guc.corrections lists them.` };
    for (const c of [...mine].reverse()) await e.uncorrect(c.id);
    return `Brought back: ${mine.map((c) => c.label).join("; ")} is undone; Clem shows the portal's record again. Say so in one plain sentence.`;
  }
  let hits = raw.filter((r) => r.id === a.item);
  if (!hits.length) hits = raw.filter((r) => words.every((w) => text(r).includes(w)));
  if (target === "class" && a.day) hits = hits.filter((r) => r.label.toLowerCase().includes(String(a.day).toLowerCase().slice(0, 3)));
  if (!hits.length) return { error: `No ${target} matches "${a.item}"${a.day ? ` on ${a.day}` : ""}. ${raw.slice(0, 12).map((r) => `${r.id}: ${r.label}`).join("; ") || "There are none."}` };
  if (hits.length > 1 && !(target === "grade" && a.do !== "edit")) {
    if (hits.length > 6 || a.do === "edit") return { error: `"${a.item}" matches ${hits.length}: ${hits.slice(0, 8).map((r) => `${r.id}: ${r.label}`).join("; ")}. Send the one meant ("item": its id).` };
  }
  const changed: string[] = [];
  for (const r of target === "grade" && a.do !== "edit" ? hits : hits.slice(0, 1)) {
    const common = { itemId: r.id, ...(r.courseKey ? { courseKey: r.courseKey } : {}) };
    if (a.do === "remove") changed.push((await e.correct({ ...common, kind: "hide", patch: { target, ...(a.why ? { why: a.why } : {}) }, label: `Hid ${r.label} in Clem's copy` })).label);
    else if (a.do === "note") {
      if (!a.note) return { error: 'guc.correct note: give "note" (their words).' };
      changed.push((await e.correct({ ...common, kind: "note", patch: { target, note: a.note }, label: `Added a note to ${r.label}: "${a.note}"` })).label);
    } else if (a.do === "done") {
      if (target !== "announcement") return { error: '"done" is for an announcement (read); remove, edit or note the others.' };
      changed.push((await e.correct({ ...common, kind: "done", patch: { target }, label: `Marked ${r.label} read` })).label);
    } else {
      const set = target === "grade" ? (a.grade ? (/^\d+(\.\d+)?$/.test(a.grade) ? { numeric: Number(a.grade) } : { letter: a.grade }) : {})
        : target === "midterm" ? (a.grade ? { grade: a.grade } : {})
        : target === "class" ? { ...(a.day ? { day: a.day } : {}), ...(a.start ? { start: a.start } : {}), ...(a.end ? { end: a.end } : {}), ...(a.place !== undefined ? { location: a.place } : {}), ...(a.title ? { name: a.title } : {}) }
        : a.note ? { text: a.note } : {};
      if (!Object.keys(set).length) return { error: `guc.correct edit of a ${target}: give ${target === "grade" || target === "midterm" ? '"grade"' : target === "class" ? '"day", "start", "end" or "place"' : '"note" (the new text)'}.` };
      const was = Object.keys(set).map((k) => `${k} ${String(r.values[k] ?? "none")}`).join(", ");
      changed.push((await e.correct({ ...common, kind: "edit", patch: { target, set }, label: `Changed ${r.label} in Clem's copy to ${Object.values(set).join(", ")} (the portal says ${was})` })).label);
    }
  }
  return `${changed.join("; ")}. The portal's own record is unchanged; Clem shows, plans around and reminds from its copy, and this holds through every sync. Tell them what you changed in one plain sentence ("undo that" brings it back).`;
}
type Rec = { id: string; label: string; courseKey?: string; values: Record<string, unknown> };
/** The records as the portal has them (before the person's changes: those are matched by id). */
async function recordsOf(e: Engine, target: RecordTarget, course?: Resolved): Promise<Rec[]> {
  const code = course ? (await e.db.query<{ code: string }>("select code from guc_courses where owner_id = $1 and course_key = $2", [e.owner, course.courseKey]))[0]?.code?.replace(/\s+/g, "").toLowerCase() : undefined;
  const mine = (c: string) => !code || c.replace(/\s+/g, "").toLowerCase() === code;
  if (target === "grade") {
    const rows = await e.db.query<{ grade_id: string; semester: string; code: string; name: string; numeric_grade: number | null; letter: string }>("select grade_id, semester, code, name, numeric_grade, letter from guc_grades where owner_id = $1", [e.owner]);
    return rows.filter((r) => mine(r.code)).map((r) => ({ id: r.grade_id, label: `your ${r.code} ${r.name} grade (${r.semester})`, values: { letter: r.letter, numeric: r.numeric_grade } }));
  }
  if (target === "class") {
    const rows = await e.db.query<{ slot_id: string; day: string; starts: string; ends: string; code: string; name: string; kind: string; location: string }>("select slot_id, day, starts, ends, code, name, kind, location from guc_schedule_slots where owner_id = $1", [e.owner]);
    return rows.filter((r) => mine(r.code)).map((r) => ({ id: r.slot_id, label: `${r.code} ${r.kind} on ${r.day} ${r.starts}–${r.ends}${r.location ? " in " + r.location : ""}`, values: { day: r.day, start: r.starts, end: r.ends, location: r.location, name: r.name } }));
  }
  if (target === "announcement") {
    const rows = await e.db.query<{ announcement_id: string; course_key: string; body: string }>(`select announcement_id, course_key, body from guc_announcements where owner_id = $1${course ? " and course_key = $2" : ""} order by first_seen desc limit 200`, course ? [e.owner, course.courseKey] : [e.owner]);
    return rows.map((r) => ({ id: r.announcement_id, courseKey: r.course_key, label: `the announcement "${r.body.replace(/\s+/g, " ").slice(0, 60)}"`, values: { text: r.body } }));
  }
  const [row] = await e.db.query<{ data: { midterms?: { id: string; code: string; course: string; grade: string }[] } }>("select data from guc_snapshots where owner_id = $1 order by id desc limit 1", [e.owner]);
  return (row?.data.midterms || []).filter((m) => mine(m.code)).map((m) => ({ id: m.id, label: `your ${m.code} midterm grade`, values: { grade: m.grade } }));
}
/** "Bring it back": the corrections in force on an item (listed or removed) are lifted, newest first. */
async function restore(ctx: GucToolContext, item: string, list: HubDeadline[], course?: Resolved) {
  const e = ctx.engine, fixes = (await e.corrections()).filter((c) => c.kind !== "rule" && c.kind !== "link" && (!course || c.courseKey === course.courseKey));
  const found = findItem(list, item, course);
  let mine = "error" in found ? [] : fixes.filter((c) => matches(c, found));
  if (!mine.length) {
    // A removed item isn't in Coming up: find it by its correction (its id, or the words of what it was).
    const words = item.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1);
    const hit = [...fixes].reverse().find((c) => c.itemId === item || (words.length > 0 && words.every((w) => c.label.toLowerCase().includes(w))));
    mine = hit ? fixes.filter((c) => c.itemId === hit.itemId) : [];
  }
  if (!mine.length) return { error: `No correction of "${item}" is in force. guc.corrections lists them.` };
  for (const c of [...mine].reverse()) await e.uncorrect(c.id);
  return `Brought back: ${mine.map((c) => c.label).join("; ")} is undone, and it shows as Clem read it. Say so in one plain sentence.`;
}
/** guc.reread: a course's texts (or one message) read again for dates, quietly. */
async function reread(ctx: GucToolContext, message: string | undefined, course: Resolved | undefined, need: () => Resolved | { error: string }) {
  const e = ctx.engine;
  let courseKey = course?.courseKey, ids: string[] | undefined, note = "";
  if (message) {
    const [post] = await e.db.query<{ course_key: string }>("select course_key from guc_announcements where owner_id = $1 and announcement_id = $2", [e.owner, message]);
    const mail = post ? undefined : (await e.mail()).items.find((m) => m.id === message);
    if (!post && !mail) return { error: `No mail or announcement has the id "${message}". guc.mail and guc.announcements list them.` };
    if (post) { courseKey ||= post.course_key; ids = [message]; }
    else {
      ids = [mailTextId(mail!.id)];
      if (Date.parse(mail!.received) < (ctx.now ?? Date.now()) - 21 * 864e5) note = ` That mail is from ${mail!.received.slice(0, 10)}, over three weeks old, so Clem takes no dates from it.`;
    }
  }
  if (!courseKey) { const c = need(); if ("error" in c) return c; courseKey = c.courseKey; }
  const name = course ? label(course) : (await e.courses()).find((c) => c.key === courseKey)?.code || "that course";
  const count = async () => (await e.deadlines()).filter((d) => d.courseKey === courseKey && !d.done && d.source !== "portal").length;
  const was = await count();
  await e.reread(courseKey, ids);
  const is = await count();
  return `Read ${message ? "that message" : `${name}'s posts and mail`} again for dates: ${name} has ${is} upcoming item${is === 1 ? "" : "s"} (was ${was}).${note} Corrections still hold. Say so plainly.`;
}
/** guc.link: which GUC course a subject is linked to, fixed (or unlinked); "undo that" links it back. */
async function relink(ctx: GucToolContext, subjectArg: string, courseArg: string) {
  const e = ctx.engine, [links, courses] = await Promise.all([e.links(), e.courses()]);
  const s = subjectArg.trim().replace(/^@/, "").toLowerCase();
  const subject = ctx.subjects.find((x) => x.id === subjectArg) || ctx.subjects.find((x) => x.name.toLowerCase() === s) || ctx.subjects.find((x) => x.name.toLowerCase().includes(s));
  if (!subject) return { error: `No subject matches "${subjectArg}".` };
  const was = links.find((l) => l.subjectId === subject.id);
  if (/^(none|no course|unlink)$/i.test(courseArg.trim())) {
    if (!was) return `${subject.name} isn't linked to a GUC course. Say so.`;
    await e.unlink(subject.id);
    await e.correct({ kind: "link", courseKey: was.courseKey, patch: { subjectId: subject.id, from: was.courseKey }, label: `Unlinked ${subject.name} from ${was.code}` });
    return `Unlinked ${subject.name} from ${was.code}. Say so in one plain sentence.`;
  }
  const c = resolveSubject(courseArg, { links: [], courses, subjects: [] });
  if (!c || "error" in c) return c || { error: `No GUC course matches "${courseArg}".` };
  if (was?.courseKey === c.courseKey) return `${subject.name} is already linked to ${c.code}. Say so.`;
  await e.link(subject.id, c.courseKey);
  await e.correct({ kind: "link", courseKey: c.courseKey, patch: { subjectId: subject.id, ...(was ? { from: was.courseKey } : {}), to: c.courseKey }, label: `Linked ${subject.name} to ${c.code}${was ? ` (was ${was.code})` : ""}` });
  return `Linked ${subject.name} to ${c.code} ${c.name}${was ? ` instead of ${was.code}` : ""}; Clem reads it now. Say so in one plain sentence.`;
}
