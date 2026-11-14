// The AI's GUC tools, run for one owner (docs/GUC-VPS-ENGINE.md → AI tools): each kinetra "guc.*" request becomes
// owner-scoped engine reads, and the result is compact text with #/app/guc links to cite. The engine is per owner;
// a request is refused when the engine is not the signed-in owner's.
import { announcementsText, deadlinesText, deadlineWindow, fileTextPage, GUC_GUIDE, gradesText, gucAction, label, link, mailListText, mailText, materialsText, readArgs, resolveSubject, scheduleDays, scheduleText, searchText, since, type Resolved, type ToolSubject } from "../../core/guc/ai-tools.ts";
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
};

/** One guc.* request's result: text for the model, or { error }. */
export async function runGucTool(ctx: GucToolContext, request: Record<string, unknown>): Promise<string | { error: string }> {
  if (ctx.engine.owner !== ctx.owner) throw Error("GUC tools: the engine is not this owner's.");
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
      case "guc.read": return readFile(ctx, a.file, a.from, course || undefined);
      case "guc.mail": {
        if (a.id) return mailText(await e.mailMessage(a.id));
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
