// Clem's organizer in the engine (docs/MAIN-THREAD.md "Proactivity"): pg-boss sweeps (timed and after changes),
// deadline reminders, the attention filter, watches, the notifier and the log behind "What Clem did today".
// It never touches the workspace: what it decides is stored in organizer_actions and the window applies it
// (src/proactivity/pro.ts) from the inbox, as it does GUC's. The workspace it reads is a compact snapshot of the saved
// state.json (EngineHost.workspace); a VPS host is handed the same snapshot by the desktop. No electron here.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cardBlock } from "../../core/guc/cards.ts";
import { addDays, cairo, type HubDeadline } from "../../core/guc/hub.ts";
import { scheduleDays } from "../../core/guc/ai-tools.ts";
import { PASSWORD_NOTICE, PASSWORD_REMINDER, PASSWORD_ROUTE, passwordChannels, passwordDue } from "../../core/guc/password.ts";
import type { GucNow } from "../../core/guc/ai-tools.ts";
import type { SubjectLink } from "../../core/guc/settings.ts";
import type { GucSlot } from "../../core/guc/types.ts";
import { localNowCard, withGuc } from "../../core/main-thread/context.ts";
import { actionKey, describe, needsConfirm, type ProAction, type Undo } from "../../core/proactivity/actions.ts";
import { muteFor, muteKey, muteText, slotChanges, type Change, type ChangeKind, type Mute } from "../../core/proactivity/attention.ts";
import { datedSlots, deadlineReminders, dueAt, timedItems, type Deadline } from "../../core/proactivity/rules.ts";
import { busyList, dayLabel, studySlots, whenOf } from "../../core/proactivity/calendar.ts";
import { agendaText, clemAction, findSpace, muteKinds, prefsText, readClemArgs, remindersText, settingsText, type ReminderRow } from "../../core/proactivity/tools.ts";
import { deadlineText, plainText, reminderText, type SayContext } from "../../core/proactivity/say.ts";
import { cairoAt, delivery, inQuiet, jobCron, JOB_KINDS, mergePro, proPatch, OUTWARD, quietEnd, readPro, type Channel, type JobKind, type ProPatch, type ProSettings } from "../../core/proactivity/settings.ts";
import { snapshotOf, type Snapshot } from "../../core/proactivity/snapshot.ts";
import { planSweep, readReply, sweepMessages, type RatedChange, type SweepKind } from "../../core/proactivity/sweep.ts";
import { live, parseWatch, type Watch } from "../../core/proactivity/watches.ts";
import { cronTooOften, describeTrigger, matchChange, pageText, readRoutineReply, ROUTINE_SYSTEM, routineInput, routineLive, type Routine, type RoutineChange, type RoutineInput, type Trigger } from "../../core/proactivity/routines.ts";
import type { Db } from "./db.ts";
import type { EngineHost } from "./host.ts";
import type { Jobs } from "./jobs.ts";

/** What the organizer reads from GUC (empty while it isn't connected). */
export type GucFacts = { slots: GucSlot[]; deadlines: HubDeadline[]; links: SubjectLink[]; now: GucNow | null };
export type Open = { route?: string; chat?: string; message?: string };
export type LogRow = { key: string; sweep: string; text: string; status: string; at: number; undo: boolean; type: string };
/** `revert`: Clem's own changes the person asked to undo in words (clem.undo), for the window to put back. */
export type ProInbox = { posts: { id: string; content: string; at: number }[]; apply: { key: string; action: ProAction }[]; revert: { key: string; undo: Undo }[] };

/** Event sweeps wait a minute for more changes, and run at most every 10 minutes. */
export const EVENT_DEBOUNCE_S = 60, EVENT_GAP_S = 600;
const ms = (t: Date | string | null | undefined) => (t ? new Date(t).getTime() : 0);
/** Channels that reach the person away from the window. */
export type Outward = Exclude<Channel, "app">;
/** What is worth telling away from the window goes wherever the person can be reached (Telegram once paired). */
const ASKED: Outward[] = [...OUTWARD];
/** The Telegram relay as the organizer sees it (desktop/engine/telegram.ts). */
export type TelegramChannel = { available: boolean; paired(): Promise<boolean>; status(): Promise<{ configured: boolean }>; deliver(n: { title: string; body: string; cards?: string; open?: Open }): Promise<void> };
const RECENT_UNDO_MS = 7 * 864e5;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export class Organizer {
  private db: Db; private owner: string; private host: EngineHost; private guc: () => Promise<GucFacts>; private clock: () => number;
  private jobs?: Jobs;
  /** Telegram, when the host can reach the account service (set by the engine). */
  telegram?: TelegramChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<unknown>;
  constructor(o: { db: Db; owner: string; host: EngineHost; guc: () => Promise<GucFacts>; clock?: () => number }) {
    this.db = o.db; this.owner = o.owner; this.host = o.host; this.guc = o.guc; this.clock = o.clock || Date.now;
  }

  // ---------- Settings and jobs ----------
  async settings(): Promise<ProSettings> {
    const [row] = await this.db.query<{ settings: unknown }>("select settings from organizer_settings where owner_id = $1", [this.owner]);
    return readPro(row?.settings);
  }
  async setSettings(patch: ProPatch) {
    const next = mergePro(await this.settings(), proPatch.parse(patch));
    await this.db.query("insert into organizer_settings (owner_id, settings) values ($1, $2) on conflict (owner_id) do update set settings = excluded.settings, updated_at = now()", [this.owner, next]);
    if (patch.jobs) await this.reschedule(next);
    return next;
  }
  async start(jobs: Jobs) {
    this.jobs = jobs;
    await jobs.queue("organizer.sweep", async ({ kind }: { kind: SweepKind }) => { await this.sweep(kind); }, { retries: 1, delay: 120 });
    await jobs.queue("organizer.tick", async () => { await this.tick(); }, { retries: 0 });
    // A reminder rings on its minute (each sends one of these when it is set); the tick catches any that slipped.
    await jobs.queue("organizer.remind", async () => { await this.ring(); }, { retries: 1, delay: 30 });
    await jobs.queue("organizer.routine", async ({ id }: { id: string }) => { await this.runRoutine(id, { kind: "schedule" }); }, { retries: 1, delay: 60 });
    await jobs.schedule("organizer.tick", "*/10 * * * *");
    await this.reschedule(await this.settings());
    await this.armRoutines().catch((e) => this.host.log("warn", "[organizer] routines: " + (e as Error).message));
    // Opened after the morning brief's time without one today (Clem was closed): it runs now, once.
    const t = setTimeout(() => void this.catchUp().catch((e) => this.host.log("warn", "[organizer] catch-up: " + (e as Error).message)), 20_000);
    t.unref?.();
  }
  /** Clem was closed when a routine was due: the latest one missed today runs now, once. Opened at night, that is the
   *  evening prep, not a morning plan for a day that is over; the weekly review too, on its day. */
  async catchUp() {
    const s = await this.settings(), c = cairo(this.clock());
    const ran = async (kind: JobKind) => (await this.db.query<{ last_day: string }>("select last_day from organizer_sweeps where owner_id = $1 and kind = $2", [this.owner, kind]))[0]?.last_day === c.ymd;
    const due = (kind: JobKind) => s.jobs[kind].on && c.time >= s.jobs[kind].time && (s.jobs[kind].day === undefined || s.jobs[kind].day === c.weekday);
    const out: JobKind[] = [];
    const daily = (["evening", "morning"] as const).find(due);
    if (daily && !(await ran(daily)) && !(daily === "morning" && await ran("evening"))) { await this.sweep(daily); out.push(daily); }
    if (due("weekly") && !(await ran("weekly"))) { await this.sweep("weekly"); out.push("weekly"); }
    return out;
  }
  /** The timed jobs' pg-boss schedules (Cairo time), one key per job. */
  private async reschedule(s: ProSettings) {
    if (!this.jobs) return;
    const have = await this.jobs.schedules("organizer.sweep");
    for (const kind of JOB_KINDS) {
      const want = s.jobs[kind].on ? jobCron(s.jobs[kind]) : undefined, was = have.find((x: { key?: string }) => x.key === kind);
      if (was && was.cron !== want) await this.jobs.unschedule("organizer.sweep", kind);
      if (want && was?.cron !== want) await this.jobs.schedule("organizer.sweep", want, { kind }, kind);
    }
  }
  /** Something changed (a sync, a check, the plans, new files): one event sweep soon, never more than every 10 minutes. */
  async poke(reason: string) {
    const [row] = await this.db.query<{ last_at: Date | null }>("select last_at from organizer_sweeps where owner_id = $1 and kind = 'event'", [this.owner]);
    const wait = Math.max(EVENT_DEBOUNCE_S, Math.ceil((ms(row?.last_at) + EVENT_GAP_S * 1000 - this.clock()) / 1000));
    this.host.log("info", `[organizer] ${reason}: event sweep in ${wait}s`);
    if (this.jobs) { await this.jobs.send("organizer.sweep", { kind: "event" }, { singletonKey: "organizer-event", startAfter: wait }); return wait; }
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.sweep("event").catch(() => {}); }, wait * 1000); this.timer.unref?.(); }
    return wait;
  }
  close() { if (this.timer) clearTimeout(this.timer); return this.running; }
  /** Another engine runs the jobs now (core/vps/lease.ts): no queue, no pending event sweep here. */
  detach() { this.jobs = undefined; if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } }

  /** One side request on the main thread's model (the organizer's model and reasoning), or null without a model. */
  async complete(system: string, user: string): Promise<string | null> {
    if (!this.host.complete) return null;
    const snap = await this.workspace();
    return this.host.complete({ system, user, model: snap.organizer?.model, reasoning: snap.organizer?.reasoning });
  }

  // ---------- A sweep ----------
  private async workspace(): Promise<Snapshot> { return snapshotOf(await this.host.workspace?.().catch(() => null), this.clock()); }
  private async done() { return new Set((await this.db.query<{ key: string }>("select key from organizer_actions where owner_id = $1", [this.owner])).map((r) => r.key)); }
  private async mutes(): Promise<Mute[]> { return (await this.db.query<{ mute: Mute }>("select mute from organizer_mutes where owner_id = $1", [this.owner])).map((r) => r.mute); }
  /** GUC events since the last sweep, as changes with their subject. Only what is still true and not yet said gets
   *  through: a deadline is one change however often it moved between sweeps, and only at the date it has now; a mail
   *  that repeats a CMS announcement (GUC mails those out too) is dropped for the announcement, whichever came first;
   *  a mail for every student is marked so (it is never told). New-term courses are not news for the thread. */
  private async events(after: Date | null, links: SubjectLink[], deadlines: HubDeadline[] = []) {
    const rows = await this.db.query<{ event_key: string; kind: ChangeKind; course_key: string | null; title: string; detail: string; created_at: Date }>(
      "select event_key, kind, course_key, title, detail, created_at from guc_events where owner_id = $1 and created_at > $2 order by created_at limit 300", [this.owner, after || new Date(0)]);
    const subject = new Map(links.map((l) => [l.courseKey, l.subjectId])), code = new Map(links.map((l) => [l.courseKey, l.code]));
    const due = new Map(deadlines.map((d) => [d.id, dueAt(d.due)])), now = this.clock();
    const dlId = (key: string) => key.split(":")[1] || "";
    // How close it is comes from the deadline as it stands now (older events carried the date at the end of their detail).
    const soon = (key: string, detail: string) => { const m = /(\d{4}-\d{2}-\d{2}[T\d:.Z+-]*)\s*$/.exec(detail), t = due.get(dlId(key)) ?? (m ? dueAt(m[1]) : 0); return !!t && t > now && t - now < 48 * 3600e3; };
    const lastOf = new Map(rows.filter((r) => r.kind.startsWith("deadline")).map((r) => [dlId(r.event_key), r.event_key]));
    const stale = (r: (typeof rows)[number]) => {
      if (!r.kind.startsWith("deadline")) return false;
      const id = dlId(r.event_key), t = due.get(id);
      if (lastOf.get(id) !== r.event_key) return true;
      // Gone from GUC since, or already past: not news any more. (Without GUC's list there is nothing to check against.)
      if (!t) return due.size > 0;
      if (t <= now) return true;
      const moved = r.kind === "deadline_changed" ? Date.parse(r.event_key.slice(("dl:" + id + ":").length)) : NaN;
      return Number.isFinite(moved) && Math.abs(moved - t) >= 60_000;
    };
    // The same words as an announcement: the letters and digits of its first lines.
    const gist = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "").slice(0, 60);
    const courseMail = rows.filter((r) => r.kind === "new_mail" && r.course_key);
    const posted = courseMail.length ? (await this.db.query<{ course_key: string; body: string }>("select course_key, body from guc_announcements where owner_id = $1 and course_key = any($2::text[])", [this.owner, [...new Set(courseMail.map((r) => r.course_key))]])).map((a) => ({ course: a.course_key, gist: gist(a.body) })) : [];
    const anns = rows.some((r) => r.kind === "new_announcement");
    const mailed = anns ? (await this.db.query<{ action: { change?: Change } }>("select action from organizer_actions where owner_id = $1 and key like 'change:mail:%' and created_at > $2", [this.owner, new Date(now - 3 * 864e5)])).flatMap((a) => (a.action?.change ? [gist(a.action.change.detail)] : [])).filter((g) => g.length >= 24) : [];
    const alike = (a: string, b: string) => a.length >= 24 && b.length >= 24 && (a.includes(b.slice(0, 40)) || b.includes(a.slice(0, 40)));
    const repeat = (r: (typeof rows)[number]) => {
      if (r.kind === "new_mail" && r.course_key) return posted.some((p) => p.course === r.course_key && alike(p.gist, gist(r.detail)));
      if (r.kind === "new_announcement") return mailed.some((m) => alike(m, gist(r.detail)));
      return false;
    };
    const changes: Change[] = rows.filter((r) => r.kind !== "schedule_changed" && (r.kind as string) !== "new_course" && !stale(r) && !repeat(r)).map((r) => {
      let materialId: string | undefined, detail = r.detail;
      if (r.kind === "new_material") materialId = r.event_key.replace(/^mat:/, "");
      if (r.kind === "file_saved") { try { const d = JSON.parse(r.detail); materialId = String(d.id); detail = d.week || ""; } catch { /* old row */ } }
      return { key: r.event_key, kind: r.kind, title: r.title, detail, ...(r.course_key && subject.get(r.course_key) ? { subjectId: subject.get(r.course_key) } : {}), ...(r.course_key && code.get(r.course_key) ? { code: code.get(r.course_key) } : {}), ...(materialId ? { materialId } : {}), ...(r.kind.startsWith("deadline") && soon(r.event_key, r.detail) ? { soon: true } : {}), ...(r.kind === "new_mail" && r.event_key.startsWith("mail:all:") ? { everyone: true as const } : r.kind === "new_mail" && !r.course_key ? { mine: true as const } : {}) };
    });
    return { changes, last: rows.at(-1)?.created_at };
  }
  private deadlines(g: GucFacts, snap: Snapshot): Deadline[] {
    const subject = new Map(g.links.map((l) => [l.courseKey, l.subjectId]));
    // A sitting whose time GUC didn't give is a day, not 23:59; what is already done is never reminded.
    return [...g.deadlines.filter((d) => !d.done).map((d) => ({ id: d.id, title: d.title, due: d.timeKnown === false ? cairo(Date.parse(d.due)).ymd : d.due, code: d.code, ...(d.kind ? { kind: d.kind } : {}), ...(d.place ? { place: d.place } : {}), ...(d.either ? { either: d.either } : {}), ...(subject.get(d.courseKey) ? { spaceId: subject.get(d.courseKey) } : {}) })),
      ...snap.plans.flatMap((p) => p.tasks.filter((t) => t.milestone && !t.done && t.due).map((t) => ({ id: `plan-${p.spaceId}-${t.id}`, title: t.title, due: t.time ? new Date(cairoAt(t.due!, t.time)).toISOString() : t.due!, spaceId: p.spaceId })))];
  }

  /** One sweep: the snapshot and GUC's changes since the last one → the rules (and, only when they need it, one short
   *  organizer call) → actions recorded → one card, pushes by importance. Nothing changed: nothing at all. */
  sweep(kind: SweepKind) {
    const job = (this.running || Promise.resolve()).catch(() => {}).then(() => this.runSweep(kind));
    this.running = job;
    return job;
  }
  private async runSweep(kind: SweepKind) {
    const started = this.clock(), s = await this.settings();
    if (kind !== "event" && !s.jobs[kind].on) return { changed: false, called: false, actions: 0, posted: false };
    const [snap, g, done, mutes] = await Promise.all([this.workspace(), this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null })), this.done(), this.mutes()]);
    const [state] = await this.db.query<{ snapshot: Snapshot | null; slots: GucSlot[] | null; events_after: Date | null }>("select snapshot, slots, events_after from organizer_sweeps where owner_id = $1 and kind = '_state'", [this.owner]);
    const [last] = await this.db.query<{ last_day: string | null }>("select last_day from organizer_sweeps where owner_id = $1 and kind = $2", [this.owner, kind]);
    // The very first sweep only sets the baseline: what GUC already held is not news.
    const ev = state ? await this.events(state.events_after || null, g.links, g.deadlines)
      : { changes: [] as Change[], last: (await this.db.query<{ t: Date | null }>("select max(created_at) as t from guc_events where owner_id = $1", [this.owner]))[0]?.t || undefined };
    // A slot names its course by code once sync resolves it ("MATH 301"), by name before ("Mathematics III").
    const flatCode = (x?: string) => (x || "").toUpperCase().replace(/\s+/g, "");
    const subjectOfCode = (code: string, name?: string) => g.links.find((l) => (!!l.code && flatCode(l.code) === flatCode(code)) || (!!l.name && [code, name].some((x) => x && x.toLowerCase().trim() === l.name.toLowerCase().trim())))?.subjectId;
    const slotCh = state?.slots && g.slots.length ? slotChanges(state.slots, g.slots, started, subjectOfCode) : [];
    const today = cairo(started).ymd;
    const facts = { now: started, snap, prev: state?.snapshot || undefined, slots: datedSlots(g.slots, today, 8), deadlines: this.deadlines(g, snap), events: [...ev.changes, ...slotCh],
      // A class by its course code when the slot only names the course: read through the subject links.
      classes: g.slots.map((x) => ({ code: /^[A-Z]{2,5} ?\d{3}/.test(x.code) ? x.code : g.links.find((l) => l.name && [x.code, x.name].some((n) => n?.toLowerCase().trim() === l.name.toLowerCase().trim()))?.code || x.code, type: x.type, group: x.group, day: x.day, start: x.start, end: x.end, location: x.location })) };
    const watches = await this.watchRows();
    const nowCard = withGuc({ ...localNowCard({ spaces: snap.spaces, plans: snap.plans.map((p) => ({ spaceId: p.spaceId, tasks: p.tasks.map((t) => ({ title: t.title, due: t.due, done: t.done ? 1 : undefined, kind: t.milestone ? "milestone" as const : "task" as const })) })), today }) }, g.now);
    let plan = planSweep(kind, facts, { done, lastDay: last?.last_day || undefined, now: nowCard, mutes, watches, model: !!this.host.complete, voice: s.level !== "quiet" });
    let called = false;
    if (plan.ask && this.host.complete) {
      try {
        const reply = await this.host.complete({ ...plan.ask, model: snap.organizer?.model, reasoning: snap.organizer?.reasoning }); called = true; plan = readReply(reply, plan, snap, done);
      }
      catch (e) { this.host.log("warn", "[organizer] model: " + (e as Error).message); }
    }
    // What this sweep saw, so the next one sees only what changes after it. A first sweep only sets the baseline.
    await this.db.query(`insert into organizer_sweeps (owner_id, kind, snapshot, slots, events_after, last_at) values ($1, '_state', $2, $3, $4, now())
      on conflict (owner_id, kind) do update set snapshot = excluded.snapshot, slots = case when jsonb_array_length(excluded.slots) > 0 then excluded.slots else organizer_sweeps.slots end, events_after = coalesce(excluded.events_after, organizer_sweeps.events_after), last_at = now()`,
      [this.owner, snap, JSON.stringify(g.slots), ev.last || state?.events_after || null]);
    await this.db.query("insert into organizer_sweeps (owner_id, kind, last_day, last_at) values ($1, $2, $3, now()) on conflict (owner_id, kind) do update set last_day = excluded.last_day, last_at = now()", [this.owner, kind, today]);
    let posted = false;
    if (plan.changed) posted = await this.deliverSweep(kind, plan, s, snap, facts.deadlines);
    await this.db.query("insert into organizer_runs (owner_id, kind, changed, model, actions, ms) values ($1, $2, $3, $4, $5, $6)", [this.owner, kind, plan.changed, called, plan.actions.length, this.clock() - started]);
    await this.db.query("delete from organizer_runs where owner_id = $1 and id not in (select id from organizer_runs where owner_id = $1 order by id desc limit 300)", [this.owner]);
    return { changed: plan.changed, called, actions: plan.actions.length, posted };
  }

  /** A sweep said as plain messages, one per thing (core/proactivity/sweep.ts sweepMessages): each its own post, its own
   *  notification and Telegram message. Nothing waits on a tap: what Clem did is applied by the window (undone in
   *  words, clem.undo), and what it asks is a question the person answers in the thread. */
  private async deliverSweep(kind: SweepKind, plan: ReturnType<typeof planSweep>, s: ProSettings, snap: Snapshot, deadlines: Deadline[]) {
    const name = (id?: string) => snap.spaces.find((x) => x.id === id)?.name, now = this.clock();
    // Actions: notes are said; the rest wait for the window to apply them.
    const taken: ProAction[] = [];
    for (const a of plan.actions) {
      const status = a.type === "note" ? "said" : needsConfirm(a) ? "confirm" : "apply";
      if (await this.record(actionKey(a), kind, a, describe(a, name), status)) taken.push(a);
    }
    for (const h of plan.hits) await this.db.query("update organizer_watches set fired = fired + 1, last_fired = now() where owner_id = $1 and id = $2", [this.owner, h.watch.id]);
    // Attention: urgent and notify are said (urgent pushed now), digest is named in passing, silent nothing.
    const fresh = async (key: string) => !(await this.db.query("select 1 from organizer_actions where owner_id = $1 and key = $2", [this.owner, key])).length;
    const said: RatedChange[] = [];
    for (const r of plan.rated.filter((r) => r.level === "urgent" || r.level === "notify")) if (await fresh("change:" + r.change.key)) said.push(r);
    // What the person asked to hear is told (once) whatever its level, in Clem's words when it has them.
    const hitKeys = new Set(plan.hits.map((h) => h.change.key)), asked: RatedChange[] = [];
    for (const h of plan.hits) if (!said.some((r) => r.change.key === h.change.key) && await fresh("change:" + h.change.key)) { const r = plan.rated.find((x) => x.change.key === h.change.key); asked.push({ change: h.change, level: "urgent", why: "You asked.", ...(r?.say ? { say: r.say } : {}) }); }
    const urgent = said.some((r) => r.level === "urgent") || plan.hits.length > 0 || taken.some((a) => needsConfirm(a) || (a.type === "note" && a.kind === "clash"));
    // News is news whichever sweep found it: a timed sweep that carries some speaks as an event sweep would.
    const news = said.length + asked.length > 0;
    const say = delivery(s, kind === "event" ? { news, urgent } : { job: kind as JobKind, news, urgent });
    // News a quieter level kept back (worth knowing, not worth a message then) is told with the next thing Clem says,
    // for a week; then it is only in the log.
    const heldRows = say.post ? await this.db.query<{ key: string; action: { change?: Change; level?: RatedChange["level"]; say?: string } }>(
      "select key, action from organizer_actions where owner_id = $1 and status = 'held' and created_at > $2 order by created_at desc limit 6", [this.owner, new Date(now - 7 * 864e5)]) : [];
    const told = [...asked, ...said];
    const held = heldRows.flatMap((r): RatedChange[] => (r.action?.change && !told.some((t) => t.change.key === r.action.change!.key) ? [{ change: r.action.change, level: r.action.level || "notify", why: "Kept for later.", held: true, ...(r.action.say ? { say: r.action.say } : {}) }] : [])).reverse();
    const x: SayContext = { now, name, deadlines };
    const also = plan.rated.filter((r) => r.level === "digest" && !hitKeys.has(r.change.key)).map((r) => r.change);
    const msgs = sweepMessages(kind, { told: [...told, ...held], asked: hitKeys, also, message: plan.message, brief: plan.brief, actions: taken }, x);
    const posting = msgs.length > 0 && say.post;
    const textOf = new Map(msgs.flatMap((m) => m.tells.map((k) => [k, m.text] as const)));
    for (const r of told) { const text = textOf.get(r.change.key) || r.say || plainText(r.change, x); await this.record("change:" + r.change.key, kind, { type: "note", kind: "info", text: text.slice(0, 300) }, text, posting ? "said" : "held", { change: r.change, level: r.level, ...(r.say ? { say: r.say } : {}) }); }
    // Quiet speaks only for what is urgent; organizing above still happened and is in the log.
    if (!posting) return false;
    // Whatever Clem writes in the main thread is worth a notification (user, 2026-11-14): one per message, on the desktop
    // and Telegram, with no daily limit. What isn't worth interrupting them for is not written at all (the levels above).
    let posted = false;
    for (const [i, m] of msgs.entries()) {
      const postId = await this.post(m.text, `sweep:${kind}:${now}:${i}`);
      if (!postId) continue;
      posted = true;
      const open: Open = { chat: snap.mainId || "main", message: postId };
      await this.push(m.tells.length ? m.key : `sweep:${kind}:${now}:${i}`, "Clem", m.text, open, s, { channels: ASKED });
    }
    if (posted && heldRows.length) await this.db.query("update organizer_actions set status = 'said', updated_at = now() where owner_id = $1 and key = any($2::text[]) and status = 'held'", [this.owner, heldRows.map((r) => r.key)]);
    return posted;
  }
  /** Records an action once (by key); false when it was already there. */
  private async record(key: string, sweep: string, action: ProAction, text: string, status: string, extra?: object) {
    const rows = await this.db.query("insert into organizer_actions (owner_id, key, sweep, action, text, status, created_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning 1",
      [this.owner, key.slice(0, 300), sweep, { ...action, ...(extra || {}) }, text.slice(0, 300), status, new Date(this.clock())]);
    return rows.length > 0;
  }
  /** A card from elsewhere in the engine (the VPS mover's "done"): posted once per key in the main thread. */
  announce(content: string, key: string) { return this.post(content, key); }
  /** A main-thread message for the window to pick up (once per key, channel 'app'). */
  private async post(content: string, key: string) {
    const fresh = await this.db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, 'app') on conflict do nothing returning 1", [this.owner, key]);
    if (!fresh.length) return undefined;
    const id = "pro-" + randomUUID();
    await this.db.query("insert into organizer_posts (owner_id, id, content) values ($1, $2, $3)", [this.owner, id, content]);
    this.host.changed?.();
    return id;
  }

  // ---------- Notifications ----------
  /** A notification on each of `channels` (default: the desktop), once per key and channel ever
   *  (notifications_sent). In quiet hours it waits (notify_queue) and goes when they end. Telegram goes only while it is
   *  paired, with the cards when there are any; one that fails waits ten minutes and is tried again. */
  async push(key: string, title: string, body: string, open: Open, s?: ProSettings, o: { channels?: Outward[]; cards?: string; loud?: boolean } = {}) {
    s ||= await this.settings();
    const got: string[] = [];
    for (const ch of o.channels || ["push"]) got.push(await this.pushOn(ch, key, title, body, open, s, o.cards, o.loud));
    return got.includes("sent") ? "sent" : got.includes("deferred") ? "deferred" : got.includes("sent-before") ? "sent-before" : "off";
  }
  /** `loud`: a reminder the person set for that time rings through quiet hours. */
  private async pushOn(ch: Outward, key: string, title: string, body: string, open: Open, s: ProSettings, cards?: string, loud?: boolean) {
    const now = this.clock();
    if (ch === "telegram" && !(await this.telegram?.paired().catch(() => false))) return "off";
    if ((await this.db.query("select 1 from notifications_sent where owner_id = $1 and event_key = $2 and channel = $3", [this.owner, key, ch])).length) return "sent-before";
    const later = (at: number) => this.db.query("insert into notify_queue (owner_id, event_key, channel, payload, due_at) values ($1, $2, $3, $4, $5) on conflict do nothing", [this.owner, key, ch, { title, body, open, ...(cards ? { cards } : {}) }, new Date(at)]);
    if (inQuiet(s, now) && !loud) { await later(quietEnd(s, now)); return "deferred"; }
    const fresh = await this.db.query("insert into notifications_sent (owner_id, event_key, channel) values ($1, $2, $3) on conflict do nothing returning 1", [this.owner, key, ch]);
    if (!fresh.length) return "sent-before";
    if (ch === "push") { this.host.notify({ key, title: title.slice(0, 120), body: body.slice(0, 240), open }); return "sent"; }
    try { await this.telegram!.deliver({ title, body, cards, open }); return "sent"; }
    catch (e) {
      this.host.log("warn", "[organizer] telegram: " + (e as Error).message);
      await this.db.query("delete from notifications_sent where owner_id = $1 and event_key = $2 and channel = 'telegram'", [this.owner, key]);
      await later(now + 600_000);
      return "deferred";
    }
  }

  // ---------- Telegram ----------
  /** The first time: nothing is assumed and nothing is asked. A new person starts with no timed routines (no morning
   *  plan they never asked for), only news about their own courses and deadline reminders. Clem posts no hello and no
   *  questions: routines (clem.routine) and preferences (clem.prefs) come from what the person says in chat, when they
   *  say it, or from Settings. True when the quiet defaults were saved now. */
  async quietStart() {
    const [saved] = await this.db.query("select 1 from organizer_settings where owner_id = $1", [this.owner]);
    if (saved) return false;
    // Balanced: news that matters and deadline reminders are said; routine uploads wait as one line under the next card.
    await this.setSettings({ level: "balanced", jobs: { morning: { on: false }, midday: { on: false }, evening: { on: false }, weekly: { on: false } } });
    return true;
  }
  /** The Telegram pair card in the main thread. The engine posts it only when the person asks (Settings → Pair in
   *  chat); it never appears by itself. Never twice for the same reason. */
  async offerTelegram(why: "first" | "channel" | "asked") {
    const t = this.telegram;
    if (!t?.available || (why !== "asked" && await t.paired())) return null;
    if (why === "first" && !(await t.status().catch(() => null))?.configured) return null;
    return this.post(cardBlock({ type: "telegram_pair" }), why === "asked" ? `telegram-pair:asked:${this.clock()}` : `telegram-pair:${why}`);
  }
  /** Every 10 minutes: deadline reminders (48h and 3h before, by default), then what quiet hours held back. */
  async tick() {
    const s = await this.settings(), now = this.clock();
    await this.ring().catch((e) => this.host.log("warn", "[organizer] reminders: " + (e as Error).message));
    {
      const [snap, g] = await Promise.all([this.workspace(), this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null }))]);
      const name = (id?: string) => snap.spaces.find((x) => x.id === id)?.name;
      const due = deadlineReminders(this.deadlines(g, snap), now, s.deadlineHours);
      const said: (typeof due[number] & { text: string })[] = [];
      for (const r of due) {
        // Just told as news (a deadline that appeared already inside the window): the 48-hour reminder would only repeat it.
        if (r.hours > 3 && (await this.db.query("select 1 from organizer_actions where owner_id = $1 and (key = $2 or key like $3) and created_at > $4 limit 1", [this.owner, "change:dl:" + r.deadline.id, "change:dl:" + r.deadline.id.replace(/[\\%_]/g, "\\$&") + ":%", new Date(now - 12 * 3600e3)])).length) {
          await this.record(r.key, "reminder", { type: "note", kind: "info", text: `${r.deadline.title}: told as news, not reminded again` }, `Skipped a repeat reminder for ${r.deadline.title}`.slice(0, 300), "skipped");
          continue;
        }
        // One message each: "MATH 301 Quiz 2 is tomorrow at 3:45 pm in D1.003.", "Assignment 2 is due in 3 hours, at 11:59 pm."
        const text = deadlineText(r.deadline, now, name, { left: r.left });
        if (!(await this.record(r.key, "reminder", { type: "note", kind: "info", text: text.slice(0, 300) }, text, "said"))) continue;
        said.push({ ...r, text });
      }
      const tight = said.some((r) => r.hours <= 3);
      // A click opens the message itself.
      if (said.length && delivery(s, { news: true, urgent: tight }).post) for (const r of said) {
        const postId = await this.post(r.text, "reminders:" + r.key);
        if (postId) await this.push(r.key, "Clem", r.text, { chat: snap.mainId || "main", message: postId }, s, { channels: ASKED });
      }
    }
    await this.gucPassword().catch((e) => this.host.log("warn", "[organizer] guc password: " + (e as Error).message));
    await this.routinePages().catch((e) => this.host.log("warn", "[organizer] page routines: " + (e as Error).message));
    // A one-time routine whose moment passed while Clem was closed runs now.
    for (const r of (await this.routines()).filter((x) => x.live && x.trigger.type === "at" && Date.parse((x.trigger as { at: string }).at) <= now)) await this.runRoutine(r.id, { kind: "schedule" }).catch(() => {});
    return this.flush();
  }
  /** GUC stopped accepting the password (docs/GUC-VPS-ENGINE.md "Password expiry"): on the day it failed, the card in
   *  the main thread and an urgent notice on every channel the person turned on, once (guc-auth:<that day>); after that
   *  at most one gentle reminder a day, never in quiet hours. Called when it fails and on every tick. */
  async gucPassword() {
    const [row] = await this.db.query<{ since: Date | null }>("select password_needed as since from guc_account where owner_id = $1", [this.owner]);
    const s = await this.settings(), due = passwordDue(ms(row?.since) || null, this.clock(), s);
    if (!due) return null;
    const card = cardBlock({ type: "guc_password" }), said = due.kind === "notice" ? PASSWORD_NOTICE : PASSWORD_REMINDER;
    if (due.kind === "notice") await this.post(card, due.key);
    await this.push(due.key, said.title, said.body, { route: "#" + PASSWORD_ROUTE }, s, { channels: passwordChannels(s), cards: card });
    return due.kind;
  }
  /** Sends what quiet hours held back, once each. */
  async flush() {
    const s = await this.settings();
    if (inQuiet(s, this.clock())) return 0;
    const rows = await this.db.query<{ event_key: string; channel: Outward; payload: { title: string; body: string; open: Open; cards?: string } }>("delete from notify_queue where owner_id = $1 and due_at <= $2 returning event_key, channel, payload", [this.owner, new Date(this.clock())]);
    let sent = 0;
    for (const r of rows) if ((await this.push(r.event_key, r.payload.title, r.payload.body, r.payload.open, s, { channels: [r.channel], cards: r.payload.cards })) === "sent") sent++;
    return sent;
  }

  // ---------- The window ----------
  /** Posts for the main thread, actions to apply and changes to put back, until acknowledged. */
  async inbox(): Promise<ProInbox> {
    const posts = await this.db.query<{ id: string; content: string; created_at: Date }>("select id, content, created_at from organizer_posts where owner_id = $1 and delivered_at is null order by created_at limit 50", [this.owner]);
    const apply = await this.db.query<{ key: string; action: ProAction }>("select key, action from organizer_actions where owner_id = $1 and status = 'apply' order by created_at limit 100", [this.owner]);
    const revert = await this.db.query<{ key: string; undo: Undo }>("select key, undo from organizer_actions where owner_id = $1 and status = 'revert' order by updated_at limit 50", [this.owner]);
    return { posts: posts.map((p) => ({ id: p.id, content: p.content, at: ms(p.created_at) })), apply: apply.map((a) => ({ key: a.key, action: a.action })), revert: revert.map((r) => ({ key: r.key, undo: r.undo })) };
  }
  async ack(o: { posts?: string[]; results?: { key: string; ok: boolean; undo?: Undo | null; error?: string }[]; reverted?: string[] }) {
    for (const id of o.posts || []) await this.db.query("update organizer_posts set delivered_at = now() where owner_id = $1 and id = $2", [this.owner, id]);
    for (const r of o.results || []) await this.db.query("update organizer_actions set status = $3, undo = $4, error = $5, updated_at = now() where owner_id = $1 and key = $2 and status = 'apply'", [this.owner, r.key, r.ok ? "applied" : "failed", r.undo ?? null, r.error?.slice(0, 200) ?? null]);
    for (const key of o.reverted || []) await this.db.query("update organizer_actions set status = 'undone', updated_at = now() where owner_id = $1 and key = $2 and status = 'revert'", [this.owner, key]);
    await this.db.query("delete from organizer_posts where owner_id = $1 and delivered_at < now() - interval '7 days'", [this.owner]);
  }
  /** "What Clem did today": everything since Cairo midnight (or `since`), newest first. */
  async log(since?: number): Promise<LogRow[]> {
    const from = since ?? cairoAt(cairo(this.clock()).ymd);
    const rows = await this.db.query<{ key: string; sweep: string; text: string; status: string; created_at: Date; undo: unknown; action: ProAction }>("select key, sweep, text, status, created_at, undo, action from organizer_actions where owner_id = $1 and created_at >= $2 and status <> 'skipped' order by created_at desc limit 200", [this.owner, new Date(from)]);
    return rows.map((r) => ({ key: r.key, sweep: r.sweep, text: r.text, status: r.status, at: ms(r.created_at), undo: r.status === "applied" && !!r.undo, type: r.action?.type || "note" }));
  }
  async statuses(keys: string[]) {
    const rows = await this.db.query<{ key: string; status: string; undo: unknown }>("select key, status, undo from organizer_actions where owner_id = $1 and key = any($2::text[])", [this.owner, keys]);
    return Object.fromEntries(rows.map((r) => [r.key, r.status === "applied" && !r.undo ? "done" : r.status]));
  }
  /** Undo: the window puts back what the returned record says. Only an applied action can be undone, once. */
  async undo(key: string) {
    const [row] = await this.db.query<{ undo: Undo }>("update organizer_actions set status = 'undone', updated_at = now() where owner_id = $1 and key = $2 and status = 'applied' and undo is not null returning undo", [this.owner, key]);
    return row?.undo || null;
  }
  /** One tap on an offer: the window applies it now and acknowledges like any other. */
  async confirm(key: string) {
    const [row] = await this.db.query<{ action: ProAction }>("update organizer_actions set status = 'apply', updated_at = now() where owner_id = $1 and key = $2 and status = 'confirm' returning action", [this.owner, key]);
    return row ? { key, action: row.action } : null;
  }
  async dismiss(key: string) { await this.db.query("update organizer_actions set status = 'dismissed', updated_at = now() where owner_id = $1 and key = $2 and status = 'confirm'", [this.owner, key]); }
  /** "Undo that", said in words (clem.undo): Clem's own latest change of the last week (or the one `what` names best)
   *  is put back through the same path as applying it: marked `revert` here, undone by the window when it next pulls
   *  (src/proactivity/pro.ts), then `undone`. One not applied yet is simply dropped. */
  async undoByText(what?: string) {
    const rows = await this.db.query<{ key: string; text: string; status: string }>(
      "select key, text, status from organizer_actions where owner_id = $1 and created_at > $2 and ((status = 'applied' and undo is not null) or status = 'apply') order by updated_at desc, created_at desc limit 40", [this.owner, new Date(this.clock() - RECENT_UNDO_MS)]);
    if (!rows.length) return { error: "Clem hasn't changed anything in the last week that can be undone." };
    const words = norm(what || "").split(" ").filter((w) => w.length > 2), score = (t: string) => words.filter((w) => norm(t).includes(w)).length;
    const pick = words.length ? rows.map((r) => ({ r, n: score(r.text) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.r : rows[0];
    if (!pick) return { error: `Nothing Clem did lately matches "${what}". Recent changes:\n` + rows.slice(0, 6).map((r) => "- " + r.text).join("\n") };
    const [row] = await this.db.query<{ status: string }>("update organizer_actions set status = case when status = 'apply' then 'dismissed' else 'revert' end, updated_at = now() where owner_id = $1 and key = $2 and status in ('apply', 'applied') returning status", [this.owner, pick.key]);
    if (!row) return { error: "That was already undone." };
    this.host.changed?.();
    return { ok: true, undone: pick.text, ...(row.status === "dismissed" ? { note: "It hadn't been applied yet, so it simply won't be." } : {}) };
  }
  /** A mute from the person's words (clem.mute): kinds of news, optionally in one subject and with some words. */
  async muteBy(o: { kinds: ChangeKind[]; subjectId?: string; words?: string[] }) {
    const made: Mute[] = [];
    for (const kind of o.kinds) {
      const m: Mute = { kind, ...(o.subjectId ? { subjectId: o.subjectId } : {}), ...(o.words?.length ? { words: o.words } : {}) };
      await this.db.query("insert into organizer_mutes (owner_id, mute_key, mute) values ($1, $2, $3) on conflict do nothing", [this.owner, muteKey(m), m]);
      made.push(m);
    }
    return made;
  }
  /** What an old message's Mute button did: the change behind it becomes a mute (its kind, in its subject). */
  async mute(key: string) {
    const [row] = await this.db.query<{ action: { change?: Change } }>("select action from organizer_actions where owner_id = $1 and key = $2", [this.owner, key]);
    if (!row?.action?.change) return null;
    const m = muteFor(row.action.change);
    await this.db.query("insert into organizer_mutes (owner_id, mute_key, mute) values ($1, $2, $3) on conflict do nothing", [this.owner, muteKey(m), m]);
    return m;
  }
  async unmute(key: string) { await this.db.query("delete from organizer_mutes where owner_id = $1 and mute_key = $2", [this.owner, key]); }
  async mutesList() { return (await this.db.query<{ mute_key: string; mute: Mute }>("select mute_key, mute from organizer_mutes where owner_id = $1 order by created_at", [this.owner])).map((r) => ({ key: r.mute_key, ...r.mute })); }

  // ---------- Reminders and study time (docs/MAIN-THREAD.md) ----------
  /** A reminder at `at`. It rings in the main thread and, for the person's own, on the desktop and Telegram. */
  async remind(o: { text: string; at: number; spaceId?: string; repeat?: "daily" | "weekly"; source?: "person" | "study" }) {
    const id = "r" + randomUUID().replace(/-/g, "").slice(0, 16);
    await this.db.query("insert into organizer_reminders (owner_id, id, text, at, space_id, repeat, source) values ($1, $2, $3, $4, $5, $6, $7)",
      [this.owner, id, o.text.slice(0, 300), new Date(o.at), o.spaceId ?? null, o.repeat ?? null, o.source || "person"]);
    await this.jobs?.send("organizer.remind", {}, { startAfter: Math.max(1, Math.ceil((o.at - this.clock()) / 1000)) }).catch(() => null);
    return { id, text: o.text.slice(0, 300), at: o.at, ...(o.repeat ? { repeat: o.repeat } : {}), ...(o.spaceId ? { spaceId: o.spaceId } : {}) };
  }
  /** Upcoming reminders, soonest first. */
  async reminders(): Promise<(ReminderRow & { spaceId?: string })[]> {
    const rows = await this.db.query<{ id: string; text: string; at: Date; space_id: string | null; repeat: "daily" | "weekly" | null; source: string }>(
      "select id, text, at, space_id, repeat, source from organizer_reminders where owner_id = $1 and not cancelled and fired_at is null order by at limit 100", [this.owner]);
    return rows.map((r) => ({ id: r.id, text: r.text, at: ms(r.at), source: r.source, ...(r.repeat ? { repeat: r.repeat } : {}), ...(r.space_id ? { spaceId: r.space_id } : {}) }));
  }
  async cancelReminder(id: string) {
    const rows = await this.db.query("update organizer_reminders set cancelled = true where owner_id = $1 and id = $2 and not cancelled and fired_at is null returning 1", [this.owner, id]);
    return { ok: rows.length > 0 };
  }
  /** Rings every reminder whose time has come: "Reminder: …" in the main thread and, once per time, a notification. A
   *  repeating one moves on to its next time; the rest are done. One rung hours late (Clem was off) is posted, not pushed. */
  async ring() {
    const now = this.clock();
    const due = await this.db.query<{ id: string; text: string; at: Date; space_id: string | null; repeat: "daily" | "weekly" | null; source: string }>(
      "select id, text, at, space_id, repeat, source from organizer_reminders where owner_id = $1 and not cancelled and fired_at is null and at <= $2 order by at limit 20", [this.owner, new Date(now)]);
    if (!due.length) return 0;
    const s = await this.settings(), snap = await this.workspace();
    for (const r of due) {
      const at = ms(r.at), key = `reminder:${r.id}:${new Date(at).toISOString()}`;
      {
        const text = reminderText(r.text);
        const postId = await this.post(text, key);
        if (postId) await this.push(key, "Clem", text, { chat: snap.mainId || "main", message: postId }, s, { channels: ASKED, loud: r.source === "person" });
        await this.record(key, "reminder", { type: "note", kind: "info", text: ("Reminded you: " + r.text).slice(0, 300) }, "Reminded you: " + r.text, "said");
      }
      if (r.repeat) {
        const step = (r.repeat === "daily" ? 1 : 7) * 864e5;
        let next = at + step;
        while (next <= now) next += step;
        await this.db.query("update organizer_reminders set at = $3 where owner_id = $1 and id = $2", [this.owner, r.id, new Date(next)]);
        await this.jobs?.send("organizer.remind", {}, { startAfter: Math.max(1, Math.ceil((next - now) / 1000)) }).catch(() => null);
      } else await this.db.query("update organizer_reminders set fired_at = now() where owner_id = $1 and id = $2", [this.owner, r.id]);
    }
    return due.length;
  }
  /** Study sessions for a subject or project before `until`: only where the person's preferences allow and nothing else
   *  is (classes, timed plan items), added to its plan (with Undo). `minutes`: the length the person asked for (50 when
   *  they didn't). No reminders: the person asks for those (clem.remind). */
  async planStudy(o: { spaceId: string; sessions: number; minutes?: number; until: string; title?: string }) {
    const s = await this.settings(), now = this.clock(), today = cairo(now).ymd, last = addDays(o.until, -1);
    const [snap, g] = await Promise.all([this.workspace(), this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null }))]);
    const space = snap.spaces.find((x) => x.id === o.spaceId);
    if (!space) return { error: "That subject or project isn't in Clem." };
    if (last < today) return { error: `${o.until} is today or already past: there's no day left before it.` };
    const n = Math.min(90, Math.round((Date.parse(last + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5) + 1);
    const timed = timedItems(snap), busy = busyList({ slots: datedSlots(g.slots, today, n), timed });
    const picks = studySlots(s.study, busy, { now, until: last, count: o.sessions, minutes: o.minutes });
    const title = `Study: ${o.title || space.name}`.slice(0, 160), lines: { text: string; time: string; key: string; space: string }[] = [];
    for (const p of picks) {
      const a: ProAction = { type: "plan_task", spaceId: space.id, title, due: p.day, time: p.time, notes: `${p.minutes}-minute study session` };
      const key = `study:${space.id}:${p.day}:${p.time}`;
      if (!(await this.record(key, "study", a, describe(a, () => space.name), "apply"))) continue;
      lines.push({ text: `${dayLabel(p.day)} · ${title} (${p.minutes} min)`.slice(0, 300), time: p.time, key, space: space.name.slice(0, 120) });
    }
    if (lines.length) this.host.changed?.();
    return { picks, lines, space: space.name, short: picks.length < o.sessions };
  }

  /** The AI's clem.* tools (core/proactivity/tools.ts). `scope`: the chat's own subject or project. Answers are facts in
   *  short text; the AI says them back in a sentence (nothing Clem says has a card or a button any more). */
  async tool(request: Record<string, unknown>, o: { scope?: string } = {}) {
    const action = clemAction(request?.action);
    if (!action) return { error: "Unknown clem action." };
    const read = readClemArgs(action, request);
    if (!read.ok) return { error: read.error };
    const args = read.args as Record<string, any>, now = this.clock(), today = cairo(now).ymd;
    const snap = await this.workspace(), spaces = snap.spaces;
    const nameOf = (id?: string) => spaces.find((x) => x.id === id)?.name;
    const spaceArg = (arg?: string) => (arg ? findSpace(arg, spaces) : spaces.find((x) => x.id === o.scope));
    const at = (t: number) => `${dayLabel(cairo(t).ymd)} ${cairo(t).time} Cairo time`;
    if (action === "clem.calendar") {
      const r = scheduleDays(args.range, now);
      if ("error" in r) return { error: r.error };
      const [g, s] = await Promise.all([this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null })), this.settings()]);
      return { text: agendaText({ days: r.days, slots: datedSlots(g.slots, r.days[0], r.days.length), timed: timedItems(snap), prefs: s.study, now }) };
    }
    if (action === "clem.remind") {
      const t = whenOf(args.at, now);
      if (t === null) return { error: `"${args.at}" isn't a time Clem can read, or it has passed. Give an ISO time (2026-11-14T09:00) or words like "tomorrow 9am".` };
      const when = t - (args.before || 0) * 60_000;
      if (when <= now) return { error: "That reminder would ring in the past. Pick a later time or a shorter \"before\"." };
      const space = spaceArg(args.subject);
      const r = await this.remind({ text: args.text, at: when, spaceId: space?.id, repeat: args.repeat });
      return { ok: true, id: r.id, text: r.text, rings: at(when), ...(args.repeat ? { repeats: args.repeat === "daily" ? "every day" : "every week" } : {}), ...(space ? { subject: space.name } : {}) };
    }
    if (action === "clem.reminders") return { text: remindersText((await this.reminders()).map((r) => ({ ...r, ...(nameOf(r.spaceId) ? { space: nameOf(r.spaceId) } : {}) }))) };
    if (action === "clem.unremind") return (await this.cancelReminder(args.id)).ok ? { ok: true } : { error: "No upcoming reminder has that id." };
    if (action === "clem.prefs") return { ok: true, text: settingsText(await this.setSettings(args as ProPatch)) };
    if (action === "clem.routine") {
      const made = await this.addRoutine(args as RoutineInput);
      if ("error" in made) return { error: made.error };
      const r = made.routine;
      return { ok: true, id: r.id, title: r.title, runs: describeTrigger(r.trigger), does: [r.tell ? (r.think ? "Clem decides what to tell them" : "tells them") : "", r.post ? "posts to their webhook" : ""].filter(Boolean).join(" and "), ...(made.hook ? { webhook: made.hook, note: "Give them this URL: other apps POST JSON or text to it to run the routine. Keep the key private." } : {}) };
    }
    if (action === "clem.routines") {
      const list = (await this.routines()).filter((r) => !r.stopped);
      return { text: list.length ? list.map((r) => `- ${r.id}: ${r.title} · ${describeTrigger(r.trigger)}${r.post ? " · posts to " + new URL(r.post).host : ""} · ran ${r.runs}×${r.lastResult ? " (last: " + r.lastResult + ")" : ""}${r.live ? "" : " · finished"}`).join("\n") : "No routines yet." };
    }
    if (action === "clem.unroutine") { await this.stopRoutine(args.id); return { ok: true }; }
    if (action === "clem.run_routine") return this.runRoutine(args.id, { kind: "manual" });
    if (action === "clem.watch") {
      const w = await this.watch(args.text, spaces, { repeat: args.repeat === true, channel: args.push === false ? "app" : "push" });
      return { ok: true, id: w.id, watching: w.text, ...(w.subjectId ? { subject: nameOf(w.subjectId) } : {}), ...(w.until ? { until: w.until } : {}), tells: w.repeat ? "every time" : "once" };
    }
    if (action === "clem.unwatch") {
      const was = (await this.watches()).find((w) => w.id === args.id);
      if (!was) return { error: "No watch has that id. clem.watches lists them." };
      await this.stopWatch(args.id);
      return { ok: true, stopped: was.text };
    }
    if (action === "clem.watches") {
      const list = (await this.watches()).filter((w) => w.live);
      return { text: list.length ? list.map((w) => `- ${w.id}: ${w.text}${w.until ? ` (until ${w.until})` : ""}${w.repeat ? " · every time" : ""}`).join("\n") : "Not watching for anything." };
    }
    if (action === "clem.mute") {
      const kinds = muteKinds(args.kind);
      if (!kinds) return { error: `"${args.kind}" isn't a kind of news. Use files, announcements, mail, grades, deadlines, timetable or exams.` };
      const space = args.subject ? findSpace(args.subject, spaces) : undefined;
      if (args.subject && !space) return { error: `No subject or project matches "${args.subject}".` };
      const words = (Array.isArray(args.words) ? args.words : args.words ? [args.words] : []).map((w: string) => w.toLowerCase());
      const made = await this.muteBy({ kinds, subjectId: space?.id, words });
      return { ok: true, muted: muteText(made[0], nameOf), ids: made.map(muteKey) };
    }
    if (action === "clem.mutes") { const list = await this.mutesList(); return { text: list.length ? list.map((m) => `- ${m.key}: ${muteText(m, nameOf)}`).join("\n") : "Nothing is muted." }; }
    if (action === "clem.unmute") {
      const m = (await this.mutesList()).find((x) => x.key === args.id);
      if (!m) return { error: "No mute has that id. clem.mutes lists them." };
      await this.unmute(m.key);
      return { ok: true, unmuted: muteText(m, nameOf) };
    }
    if (action === "clem.undo") return this.undoByText(args.what);
    // clem.study
    const space = spaceArg(args.subject);
    if (!space) return { error: args.subject ? `No subject or project matches "${args.subject}".` : "Say which subject or project to study (\"subject\")." };
    if (args.until <= today) return { error: `${args.until} is today or already past.` };
    const r = await this.planStudy({ spaceId: space.id, sessions: args.sessions, minutes: args.minutes, until: args.until, title: args.title });
    if ("error" in r) return { error: r.error };
    if (!r.lines.length) return { error: "No free time fits before then within their study preferences (or those sessions are already planned). Suggest fewer or shorter sessions, a later date, or changing the days and hours they study.", prefs: prefsText((await this.settings()).study) };
    return { ok: true, planned: r.lines.map((l) => `${l.text} at ${l.time}`), ...(r.short ? { note: `Only ${r.lines.length} of ${args.sessions} fit within their preferences.` } : {}), undo: "If they want one back out, clem.undo with its day." };
  }

  // ---------- Routines (core/proactivity/routines.ts) ----------
  /** Routines the person asked for, with how often they ran. */
  async routines() {
    const rows = await this.db.query<{ routine: Routine; runs: number; last_run: Date | null; last_result: string | null; stopped: boolean; secret: string | null }>(
      "select routine, runs, last_run, last_result, stopped, secret from organizer_routines where owner_id = $1 order by created_at desc limit 200", [this.owner]);
    return rows.map((r) => ({ ...r.routine, runs: r.runs, lastRun: ms(r.last_run) || undefined, lastResult: r.last_result || undefined, stopped: r.stopped, live: routineLive(r.routine, r, this.clock()), ...(r.secret ? { hook: this.hookUrl(r.routine.id, r.secret) } : {}) }));
  }
  private hookUrl(id: string, secret: string) { return `${(this.host.hookBase?.() || "http://127.0.0.1:7718").replace(/\/+$/, "")}/hook/${id}?key=${secret}`; }
  /** A routine from the AI's clem.routine: checked, saved, and its schedule set. */
  async addRoutine(input: RoutineInput) {
    const parsed = routineInput.safeParse(input);
    if (!parsed.success) { const i = parsed.error.issues[0]; return { error: `clem.routine: ${i.path.join(".") || "routine"} ${i.message.toLowerCase()}.` }; }
    const r: Routine = { id: "rt" + randomUUID().replace(/-/g, "").slice(0, 14), ...parsed.data };
    if (r.trigger.type === "schedule" && cronTooOften(r.trigger.cron)) return { error: "That schedule runs more often than every 15 minutes. Use a \"change\" trigger to hear about GUC news the moment it lands, or a slower schedule." };
    if (r.trigger.type === "at") { const at = whenOf(r.trigger.at, this.clock()); if (at === null) return { error: `"${r.trigger.at}" isn't a future time Clem can read.` }; r.trigger = { type: "at", at: new Date(at).toISOString() }; }
    if (!r.tell && !r.post) return { error: "A routine must tell the person (\"tell\": true) or post somewhere (\"post\")." };
    const [{ n }] = await this.db.query<{ n: number }>("select count(*)::int as n from organizer_routines where owner_id = $1 and not stopped", [this.owner]);
    if (n >= 50) return { error: "There are already 50 routines running. Stop some first (clem.routines lists them)." };
    const secret = r.trigger.type === "webhook" ? randomBytes(24).toString("base64url") : null;
    await this.db.query("insert into organizer_routines (owner_id, id, routine, secret) values ($1, $2, $3, $4)", [this.owner, r.id, r, secret]);
    await this.armRoutine(r);
    return { routine: r, ...(secret ? { hook: this.hookUrl(r.id, secret) } : {}) };
  }
  async stopRoutine(id: string) {
    await this.db.query("update organizer_routines set stopped = true where owner_id = $1 and id = $2", [this.owner, id]);
    await this.jobs?.unschedule("organizer.routine", id).catch(() => {});
    return this.routines();
  }
  /** Its schedule in the job runner (Cairo time), or its one time. Change, webhook and page routines need none. */
  private async armRoutine(r: Routine) {
    if (!this.jobs) return;
    if (r.trigger.type === "schedule") await this.jobs.schedule("organizer.routine", r.trigger.cron, { id: r.id }, r.id);
    if (r.trigger.type === "at") await this.jobs.send("organizer.routine", { id: r.id }, { startAfter: Math.max(1, Math.ceil((Date.parse(r.trigger.at) - this.clock()) / 1000)) });
  }
  private async armRoutines() {
    const live = (await this.routines()).filter((r) => r.live);
    const have = new Set(((await this.jobs?.schedules("organizer.routine").catch(() => [])) || []).map((x: { key?: string }) => x.key));
    for (const r of live) if (r.trigger.type === "schedule" && !have.has(r.id)) await this.armRoutine(r);
    for (const key of have) if (key && !live.some((r) => r.id === key && r.trigger.type === "schedule")) await this.jobs?.unschedule("organizer.routine", key).catch(() => {});
  }
  private async routineRow(id: string) {
    const [row] = await this.db.query<{ routine: Routine; secret: string | null; state: { hash?: string } | null; runs: number; last_run: Date | null; stopped: boolean }>(
      "select routine, secret, state, runs, last_run, stopped from organizer_routines where owner_id = $1 and id = $2", [this.owner, id]);
    return row;
  }
  /** GUC changes a sync just found: every `change` routine they match fires now, once per batch. */
  async routineChanges(changes: RoutineChange[]) {
    if (!changes.length) return 0;
    const spaces = (await this.workspace().catch(() => null))?.spaces || [];
    changes = changes.map((c) => ({ ...c, ...(c.subjectId && spaces.find((x) => x.id === c.subjectId) ? { subject: spaces.find((x) => x.id === c.subjectId)!.name } : {}) }));
    const rows = await this.db.query<{ routine: Routine; runs: number; stopped: boolean }>("select routine, runs, stopped from organizer_routines where owner_id = $1 and not stopped and routine->'trigger'->>'type' = 'change'", [this.owner]);
    let fired = 0;
    for (const r of rows) {
      if (!routineLive(r.routine, r, this.clock())) continue;
      const hit = changes.filter((c) => matchChange(r.routine.trigger as Extract<Trigger, { type: "change" }>, c));
      if (!hit.length) continue;
      await this.runRoutine(r.routine.id, { kind: "change", changes: hit.slice(0, 20) }).catch((e) => this.host.log("warn", "[routine] " + (e as Error).message));
      fired++;
    }
    return fired;
  }
  /** A call to a routine's webhook. The key must match; at most one run every 10 seconds. */
  async hook(id: string, key: string, payload: unknown) {
    const row = await this.routineRow(id);
    if (!row?.secret || row.stopped || !safeEqual(row.secret, key || "")) return { status: 404 as const };
    if (row.last_run && this.clock() - ms(row.last_run) < 10_000) return { status: 429 as const };
    void this.runRoutine(id, { kind: "webhook", payload }).catch((e) => this.host.log("warn", "[routine] hook: " + (e as Error).message));
    return { status: 202 as const };
  }
  /** Page routines whose time has come (the tick): read the page, and run when its words changed. The first read is a
   *  baseline. */
  async routinePages() {
    const rows = await this.db.query<{ routine: Routine; state: { hash?: string } | null; last_run: Date | null; runs: number; stopped: boolean }>(
      "select routine, state, last_run, runs, stopped from organizer_routines where owner_id = $1 and not stopped and routine->'trigger'->>'type' = 'page'", [this.owner]);
    for (const r of rows) {
      const t = r.routine.trigger as Extract<Trigger, { type: "page" }>;
      if (!routineLive(r.routine, r, this.clock())) continue;
      const checked = (r.state as { at?: number } | null)?.at || 0;
      if (this.clock() - checked < t.every * 60_000 - 30_000) continue;
      try {
        const res = await fetch(t.url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Clem-Routine/1.0" } });
        const text = pageText((await res.text()).slice(0, 2_000_000)), hash = createHash("sha256").update(text).digest("hex");
        const was = r.state?.hash;
        await this.db.query("update organizer_routines set state = $3 where owner_id = $1 and id = $2", [this.owner, r.routine.id, { hash, at: this.clock() }]);
        if (was && was !== hash) await this.runRoutine(r.routine.id, { kind: "page", url: t.url, text: text.slice(0, 6000) });
      } catch (e) { this.host.log("warn", `[routine] page ${r.routine.id}: ${(e as Error).message}`); await this.db.query("update organizer_routines set state = coalesce(state, '{}'::jsonb) || $3 where owner_id = $1 and id = $2", [this.owner, r.routine.id, { at: this.clock() }]); }
    }
  }
  /** Runs a routine: the model decides what to say (when `think`), it is said in the main thread and pushed when it
   *  matters, and posted to the person's own URL when it has one. */
  async runRoutine(id: string, event: { kind: string; [k: string]: unknown } = { kind: "manual" }) {
    const row = await this.routineRow(id);
    if (!row || row.stopped) return { error: "No running routine has that id." };
    const r = row.routine, now = this.clock(), s = await this.settings();
    await this.db.query("update organizer_routines set runs = runs + 1, last_run = $3 where owner_id = $1 and id = $2", [this.owner, id, new Date(now)]);
    let say: string | null = null, important = false;
    if (r.tell) {
      if (r.think && this.host.complete) {
        const context = await this.routineContext().catch(() => "");
        const user = `Routine: ${r.title}\nIts instructions: ${r.instructions || "Tell the person what happened, briefly."}\nTriggered: ${describeTrigger(r.trigger)}\nNow: ${cairo(now).ymd} ${cairo(now).time} (Cairo)\n\nEvent:\n${JSON.stringify(event).slice(0, 8000)}\n\nContext:\n${context}`;
        try { ({ say, important } = readRoutineReply(await this.host.complete({ system: ROUTINE_SYSTEM, user }))); }
        catch (e) { this.host.log("warn", "[routine] model: " + (e as Error).message); say = plainRoutine(r, event); }
      } else say = plainRoutine(r, event);
    }
    let posted = "";
    if (r.post) {
      try {
        const res = await fetch(r.post, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Clem-Routine/1.0" }, body: JSON.stringify({ routine: { id: r.id, title: r.title }, at: new Date(now).toISOString(), event, ...(say ? { message: say } : {}) }), signal: AbortSignal.timeout(10_000) });
        posted = res.ok ? "posted" : "post failed: http " + res.status;
      } catch (e) { posted = "post failed: " + (e as Error).message.slice(0, 80); }
    }
    let postId: string | undefined;
    if (say) {
      // A plain message like anything else Clem says by itself: no title over it, no markdown.
      say = say.replace(/\*\*|__|`/g, "").replace(/^\s*[-*•]\s+/gm, "").trim();
      postId = await this.post(say, `routine:${id}:${now}`);
      const urgent = important || event.kind === "change" && (event.changes as RoutineChange[] | undefined)?.some((c) => c.kind === "new_grade" || c.kind === "exam_posted");
      const out = delivery(s, { news: true, urgent }).channels.filter((c): c is Outward => c !== "app");
      if (postId) await this.push(`routine:${id}:${now}`, "Clem", say, { chat: (await this.workspace()).mainId || "main", message: postId }, s, { channels: ASKED, loud: r.loud });
    }
    const result = [say ? "told" : r.tell ? "nothing worth saying" : "", posted].filter(Boolean).join(", ") || "ran";
    await this.db.query("update organizer_routines set last_result = $3 where owner_id = $1 and id = $2", [this.owner, id, result.slice(0, 200)]);
    await this.record(`routine:${id}:${now}`, "routine", { type: "note", kind: "info", text: `${r.title}: ${result}`.slice(0, 300) }, `${r.title}: ${result}`, "said");
    return { ok: true, result, ...(say ? { said: say } : {}) };
  }
  /** What a routine's model sees besides its event: today's and tomorrow's agenda, upcoming deadlines, reminders. */
  private async routineContext() {
    const now = this.clock(), today = cairo(now).ymd;
    const [snap, g, s, reminders] = await Promise.all([this.workspace(), this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null })), this.settings(), this.reminders()]);
    const agenda = agendaText({ days: [today, addDays(today, 1)], slots: datedSlots(g.slots, today, 2), timed: timedItems(snap), prefs: s.study, now });
    const due = this.deadlines(g, snap).filter((d) => dueAt(d.due) > now && dueAt(d.due) - now < 14 * 864e5).slice(0, 15).map((d) => `- ${d.title} · due ${d.due}`).join("\n");
    return [agenda, due ? "Deadlines (next 2 weeks):\n" + due : "No deadlines in the next 2 weeks.", remindersText(reminders.slice(0, 10))].join("\n\n").slice(0, 6000);
  }

  // ---------- Watches ----------
  private async watchRows() {
    return (await this.db.query<{ watch: Watch; fired: number; stopped: boolean }>("select watch, fired, stopped from organizer_watches where owner_id = $1 and not stopped", [this.owner])).map((r) => ({ watch: r.watch, fired: r.fired, stopped: r.stopped }));
  }
  /** A watch from the person's words (the AI's clem.watch, or a card). */
  async watch(text: string, spaces: { id: string; name: string; code?: string }[], o: { repeat?: boolean; channel?: "app" | "push" } = {}) {
    const w = parseWatch(text, spaces, this.clock(), "w" + randomUUID().replace(/-/g, "").slice(0, 16));
    const watch: Watch = { ...w, ...(o.repeat ? { repeat: true } : {}), ...(o.channel ? { channel: o.channel } : {}) };
    await this.db.query("insert into organizer_watches (owner_id, id, watch) values ($1, $2, $3)", [this.owner, watch.id, watch]);
    return watch;
  }
  async watches() {
    const rows = await this.db.query<{ watch: Watch; fired: number; stopped: boolean; last_fired: Date | null }>("select watch, fired, stopped, last_fired from organizer_watches where owner_id = $1 order by created_at desc limit 100", [this.owner]);
    return rows.map((r) => ({ ...r.watch, fired: r.fired, stopped: r.stopped, live: live(r.watch, r, this.clock()), lastFired: ms(r.last_fired) || undefined }));
  }
  async stopWatch(id: string) { await this.db.query("update organizer_watches set stopped = true where owner_id = $1 and id = $2", [this.owner, id]); return this.watches(); }
}

/** A routine's message without the model: its news, plainly. */
function plainRoutine(r: Routine, event: { kind: string; [k: string]: unknown }) {
  if (event.kind === "change") return ((event.changes as RoutineChange[]) || []).map((c) => plainText({ ...c, kind: c.kind as ChangeKind }, { now: Date.now(), name: () => c.subject })).join("\n").slice(0, 1500);
  // Said plainly, under the routine's own name, since no model put it in words.
  if (event.kind === "page") return `${r.title}: ${event.url} changed.`;
  const p = event.payload, said = p && typeof p === "object" ? Object.entries(p as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ") : p ? String(p) : "";
  if (event.kind === "webhook") return `${r.title}: ${said ? said.slice(0, 600) : "it was called."}`;
  return r.instructions || r.title;
}
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

function groupBy<T>(xs: T[], key: (x: T) => string) { const out: Record<string, T[]> = {}; for (const x of xs) (out[key(x)] ||= []).push(x); return out; }
