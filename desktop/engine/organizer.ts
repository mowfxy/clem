// Clem's organizer in the engine (docs/MAIN-THREAD.md "Proactivity"): pg-boss sweeps (timed and after changes),
// deadline reminders, the attention filter, watches, the notifier and the log behind "What Clem did today".
// It never touches the workspace: what it decides is stored in organizer_actions and the window applies it
// (src/proactivity/pro.ts) from the inbox, as it does GUC's. The workspace it reads is a compact snapshot of the saved
// state.json (EngineHost.workspace); a VPS host is handed the same snapshot by the desktop. No electron here.
import { randomUUID } from "node:crypto";
import { cardBlock, type ClemCard } from "../../core/guc/cards.ts";
import { cairo, type HubDeadline } from "../../core/guc/hub.ts";
import type { GucNow } from "../../core/guc/ai-tools.ts";
import type { SubjectLink } from "../../core/guc/settings.ts";
import type { GucSlot } from "../../core/guc/types.ts";
import { localNowCard, withGuc } from "../../core/main-thread/context.ts";
import { actionKey, describe, needsConfirm, type ProAction, type Undo } from "../../core/proactivity/actions.ts";
import { capPushes, muteFor, muteKey, slotChanges, type Change, type ChangeKind, type Mute } from "../../core/proactivity/attention.ts";
import { datedSlots, deadlineReminders, dueAt, leftText, type Deadline } from "../../core/proactivity/rules.ts";
import { cairoAt, delivery, inQuiet, jobCron, JOB_KINDS, mergePro, proPatch, quietEnd, readPro, type Channel, type EventKind, type JobKind, type ProPatch, type ProSettings } from "../../core/proactivity/settings.ts";
import { snapshotOf, type Snapshot } from "../../core/proactivity/snapshot.ts";
import { changeText, digestLine, planSweep, readReply, sweepCard, type RatedChange, type SweepKind } from "../../core/proactivity/sweep.ts";
import { live, parseWatch, type Watch } from "../../core/proactivity/watches.ts";
import type { Db } from "./db.ts";
import type { EngineHost } from "./host.ts";
import type { Jobs } from "./jobs.ts";

/** What the organizer reads from GUC (empty while it isn't connected). */
export type GucFacts = { slots: GucSlot[]; deadlines: HubDeadline[]; links: SubjectLink[]; now: GucNow | null };
export type Open = { route?: string; chat?: string; message?: string };
export type LogRow = { key: string; sweep: string; text: string; status: string; at: number; undo: boolean; type: string };
export type ProInbox = { posts: { id: string; content: string; at: number }[]; apply: { key: string; action: ProAction }[] };

/** Event sweeps wait a minute for more changes, and run at most every 10 minutes. */
export const EVENT_DEBOUNCE_S = 60, EVENT_GAP_S = 600;
const KIND_OF: Record<ChangeKind, EventKind> = { new_grade: "grade", new_announcement: "announcement", new_material: "lecture", file_saved: "lecture", deadline_added: "deadline", deadline_changed: "deadline", schedule_changed: "schedule", slot_cancelled: "schedule", slot_moved: "schedule", slot_added: "schedule", room_changed: "schedule" };
const ms = (t: Date | string | null | undefined) => (t ? new Date(t).getTime() : 0);
/** Channels that reach the person away from the window. */
export type Outward = Exclude<Channel, "app">;
const outward = (channels: Channel[]) => channels.filter((c): c is Outward => c !== "app");
/** What the person asked to be told about goes wherever they can be reached. */
const ASKED: Outward[] = ["push", "telegram"];
/** The Telegram relay as the organizer sees it (desktop/engine/telegram.ts). */
export type TelegramChannel = { available: boolean; paired(): Promise<boolean>; status(): Promise<{ configured: boolean }>; deliver(n: { title: string; body: string; cards?: string; open?: Open }): Promise<void> };

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
    // Telegram turned on for something while it isn't paired: the pair card, once, in the main thread.
    if (Object.values(patch.events || {}).some((e) => e?.channels?.includes("telegram"))) await this.offerTelegram("channel").catch(() => null);
    return next;
  }
  async start(jobs: Jobs) {
    this.jobs = jobs;
    await jobs.queue("organizer.sweep", async ({ kind }: { kind: SweepKind }) => { await this.sweep(kind); }, { retries: 1, delay: 120 });
    await jobs.queue("organizer.tick", async () => { await this.tick(); }, { retries: 0 });
    await jobs.schedule("organizer.tick", "*/10 * * * *");
    await this.reschedule(await this.settings());
    // Opened after the morning brief's time without one today (Clem was closed): it runs now, once.
    const t = setTimeout(() => void this.catchUp().catch((e) => this.host.log("warn", "[organizer] catch-up: " + (e as Error).message)), 20_000);
    t.unref?.();
  }
  private async catchUp() {
    const s = await this.settings(), c = cairo(this.clock());
    if (!s.jobs.morning.on || c.time < s.jobs.morning.time) return;
    const [row] = await this.db.query<{ last_day: string }>("select last_day from organizer_sweeps where owner_id = $1 and kind = 'morning'", [this.owner]);
    if (row?.last_day !== c.ymd) await this.sweep("morning");
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

  // ---------- A sweep ----------
  private async workspace(): Promise<Snapshot> { return snapshotOf(await this.host.workspace?.().catch(() => null), this.clock()); }
  private async done() { return new Set((await this.db.query<{ key: string }>("select key from organizer_actions where owner_id = $1", [this.owner])).map((r) => r.key)); }
  private async mutes(): Promise<Mute[]> { return (await this.db.query<{ mute: Mute }>("select mute from organizer_mutes where owner_id = $1", [this.owner])).map((r) => r.mute); }
  /** GUC events since the last sweep, as changes with their subject. */
  private async events(after: Date | null, links: SubjectLink[]) {
    const rows = await this.db.query<{ event_key: string; kind: ChangeKind; course_key: string | null; title: string; detail: string; created_at: Date }>(
      "select event_key, kind, course_key, title, detail, created_at from guc_events where owner_id = $1 and created_at > $2 order by created_at limit 300", [this.owner, after || new Date(0)]);
    const subject = new Map(links.map((l) => [l.courseKey, l.subjectId])), code = new Map(links.map((l) => [l.courseKey, l.code]));
    const soon = (detail: string) => { const m = /(\d{4}-\d{2}-\d{2}[T\d:.Z+-]*)\s*$/.exec(detail); return !!m && dueAt(m[1]) - this.clock() < 48 * 3600e3 && dueAt(m[1]) > this.clock(); };
    const changes: Change[] = rows.filter((r) => r.kind !== "schedule_changed").map((r) => {
      let materialId: string | undefined, detail = r.detail;
      if (r.kind === "new_material") materialId = r.event_key.replace(/^mat:/, "");
      if (r.kind === "file_saved") { try { const d = JSON.parse(r.detail); materialId = String(d.id); detail = d.week || ""; } catch { /* old row */ } }
      return { key: r.event_key, kind: r.kind, title: r.title, detail, ...(r.course_key && subject.get(r.course_key) ? { subjectId: subject.get(r.course_key) } : {}), ...(r.course_key && code.get(r.course_key) ? { code: code.get(r.course_key) } : {}), ...(materialId ? { materialId } : {}), ...(r.kind.startsWith("deadline") && soon(r.detail) ? { soon: true } : {}) };
    });
    return { changes, last: rows.at(-1)?.created_at };
  }
  private deadlines(g: GucFacts, snap: Snapshot): Deadline[] {
    const subject = new Map(g.links.map((l) => [l.courseKey, l.subjectId]));
    return [...g.deadlines.map((d) => ({ id: d.id, title: d.title, due: d.due, code: d.code, ...(subject.get(d.courseKey) ? { spaceId: subject.get(d.courseKey) } : {}) })),
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
    const ev = await this.events(state?.events_after || null, g.links);
    const subjectOfCode = (code: string) => g.links.find((l) => l.code === code)?.subjectId;
    const slotCh = state?.slots && g.slots.length ? slotChanges(state.slots, g.slots, started, subjectOfCode) : [];
    const today = cairo(started).ymd;
    const facts = { now: started, snap, prev: state?.snapshot || undefined, slots: datedSlots(g.slots, today, 8), deadlines: this.deadlines(g, snap), events: [...ev.changes, ...slotCh] };
    const watches = await this.watchRows();
    const nowCard = withGuc({ ...localNowCard({ spaces: snap.spaces, plans: snap.plans.map((p) => ({ spaceId: p.spaceId, tasks: p.tasks.map((t) => ({ title: t.title, due: t.due, done: t.done ? 1 : undefined, kind: t.milestone ? "milestone" as const : "task" as const })) })), today }) }, g.now);
    let plan = planSweep(kind, facts, { done, lastDay: last?.last_day || undefined, now: nowCard, mutes, watches, model: !!this.host.complete });
    let called = false;
    if (plan.ask && this.host.complete) {
      try { const reply = await this.host.complete({ ...plan.ask, model: snap.organizer?.model, reasoning: snap.organizer?.reasoning }); called = true; plan = readReply(reply, plan, snap, done); }
      catch (e) { this.host.log("warn", "[organizer] model: " + (e as Error).message); }
    }
    // What this sweep saw, so the next one sees only what changes after it. A first sweep only sets the baseline.
    await this.db.query(`insert into organizer_sweeps (owner_id, kind, snapshot, slots, events_after, last_at) values ($1, '_state', $2, $3, $4, now())
      on conflict (owner_id, kind) do update set snapshot = excluded.snapshot, slots = case when jsonb_array_length(excluded.slots) > 0 then excluded.slots else organizer_sweeps.slots end, events_after = coalesce(excluded.events_after, organizer_sweeps.events_after), last_at = now()`,
      [this.owner, snap, JSON.stringify(g.slots), ev.last || state?.events_after || null]);
    await this.db.query("insert into organizer_sweeps (owner_id, kind, last_day, last_at) values ($1, $2, $3, now()) on conflict (owner_id, kind) do update set last_day = excluded.last_day, last_at = now()", [this.owner, kind, today]);
    let posted = false;
    if (plan.changed) posted = await this.deliverSweep(kind, plan, s, snap);
    await this.db.query("insert into organizer_runs (owner_id, kind, changed, model, actions, ms) values ($1, $2, $3, $4, $5, $6)", [this.owner, kind, plan.changed, called, plan.actions.length, this.clock() - started]);
    await this.db.query("delete from organizer_runs where owner_id = $1 and id not in (select id from organizer_runs where owner_id = $1 order by id desc limit 300)", [this.owner]);
    return { changed: plan.changed, called, actions: plan.actions.length, posted };
  }

  private async deliverSweep(kind: SweepKind, plan: ReturnType<typeof planSweep>, s: ProSettings, snap: Snapshot) {
    const name = (id?: string) => snap.spaces.find((x) => x.id === id)?.name, now = this.clock();
    // Actions: notes are said; offers wait for a tap; the rest wait for the window to apply them (with Undo).
    const taken: ProAction[] = [];
    for (const a of plan.actions) {
      const status = a.type === "note" ? "said" : needsConfirm(a) ? "confirm" : "apply";
      if (await this.record(actionKey(a), kind, a, describe(a, name), status)) taken.push(a);
    }
    for (const h of plan.hits) await this.db.query("update organizer_watches set fired = fired + 1, last_fired = now() where owner_id = $1 and id = $2", [this.owner, h.watch.id]);
    // Attention: urgent and notify are said (urgent pushed now, notify in one push), digest is one line, silent nothing.
    const fresh = async (key: string) => !(await this.db.query("select 1 from organizer_actions where owner_id = $1 and key = $2", [this.owner, key])).length;
    const said: RatedChange[] = [];
    for (const r of plan.rated.filter((r) => r.level === "urgent" || r.level === "notify")) if (await fresh("change:" + r.change.key)) said.push(r);
    // What the person asked to hear is pushed (once) even when its kind isn't; a change is never pushed twice.
    const asked = plan.hits.filter((h) => h.watch.channel !== "app").map((h) => ({ change: h.change, level: "urgent" as const, why: "You asked." }));
    const out = (r: RatedChange) => (asked.some((a) => a.change.key === r.change.key) ? ASKED : outward(s.events[KIND_OF[r.change.kind]].channels));
    const pushable = [...said.filter((r) => out(r).length && s.events[KIND_OF[r.change.kind]].on && !asked.some((a) => a.change.key === r.change.key)), ...asked];
    const capped = capPushes(s.level, await this.pushedToday(), pushable.filter((p) => s.level !== "quiet" || p.level === "urgent"));
    const digest = plan.rated.filter((r) => r.level === "digest");
    for (const r of said) await this.record("change:" + r.change.key, kind, { type: "note", kind: "info", text: changeText(r.change).slice(0, 300) }, changeText(r.change), "said", { change: r.change, level: r.level });
    const lectures = plan.lectures.filter((l) => !plan.rated.some((r) => r.level === "silent" && r.change.materialId === l.materialId));
    for (const l of lectures) await this.record(l.key, kind, { type: "note", kind: "lecture", text: `New lecture: ${l.title}`.slice(0, 300), spaceId: l.subjectId, key: l.key }, `New lecture: ${l.title}`, "said");
    const urgent = said.some((r) => r.level === "urgent") || plan.hits.length > 0 || taken.some((a) => needsConfirm(a) || (a.type === "note" && a.kind === "clash"));
    const say = delivery(s, kind === "event" ? { event: said[0] ? KIND_OF[said[0].change.kind] : lectures.length ? "lecture" : "plan", urgent } : { job: kind as JobKind, urgent });
    const card = sweepCard(kind, now, { said, digest: digestLine(digest, name), hits: plan.hits, brief: plan.brief, actions: taken }, name);
    const blocks: ClemCard[] = [...(card ? [card] : []), ...Object.entries(groupBy(lectures, (l) => l.subjectId)).map(([subjectId, ls]) => ({ type: "lecture" as const, subjectId, files: ls.slice(0, 10).map((l) => ({ id: l.materialId, name: l.title.slice(0, 300), saved: l.saved })) }))];
    // Quiet speaks only for what is urgent or waits on a tap; organizing above still happened and is in the log.
    if (!blocks.length || !say.post) return false;
    const postId = await this.post(blocks.map((b) => cardBlock(b)).join("\n\n"), `sweep:${kind}:${now}`);
    if (!postId) return false;
    const open: Open = { chat: snap.mainId || "main", message: postId };
    // Telegram gets the card itself (with its buttons); a desktop notification gets a title and a line.
    const cards = blocks.map((b) => cardBlock(b)).join("\n\n");
    for (const p of capped.push.filter((p) => p.level === "urgent")) await this.push("change:" + p.change.key, p.change.title, p.change.detail || "Tap to see it in Clem.", open, s, { channels: out(p) });
    const batch = capped.push.filter((p) => p.level !== "urgent");
    if (batch.length) await this.push(`batch:${postId}`, batch.length === 1 ? batch[0].change.title : `${batch.length} updates`, batch.map((b) => b.change.title).join(" · ").slice(0, 240), open, s, { channels: [...new Set(batch.flatMap(out))], cards });
    const jobOut = say.channels.filter((c): c is Outward => c !== "app");
    if (!pushable.length && kind !== "event" && kind !== "midday" && jobOut.length && s.level === "proactive") await this.push(`job:${kind}:${cairo(now).ymd}`, card?.title || "Clem", (card?.lines || []).slice(0, 3).map((l) => l.text).join(" · ").slice(0, 240), open, s, { channels: jobOut, cards });
    return true;
  }
  /** Records an action once (by key); false when it was already there. */
  private async record(key: string, sweep: string, action: ProAction, text: string, status: string, extra?: object) {
    const rows = await this.db.query("insert into organizer_actions (owner_id, key, sweep, action, text, status, created_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning 1",
      [this.owner, key.slice(0, 300), sweep, { ...action, ...(extra || {}) }, text.slice(0, 300), status, new Date(this.clock())]);
    return rows.length > 0;
  }
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
  private async pushedToday() {
    // One thing told on both channels counts once against the cap.
    const [{ n }] = await this.db.query<{ n: number }>("select count(distinct event_key)::int as n from notifications_sent where owner_id = $1 and channel in ('push', 'telegram') and sent_at >= $2", [this.owner, new Date(cairoAt(cairo(this.clock()).ymd))]);
    return n;
  }
  /** A notification on each of `channels` (default: the desktop), once per key and channel ever
   *  (notifications_sent). In quiet hours it waits (notify_queue) and goes when they end. Telegram goes only while it is
   *  paired, with the cards when there are any; one that fails waits ten minutes and is tried again. */
  async push(key: string, title: string, body: string, open: Open, s?: ProSettings, o: { channels?: Outward[]; cards?: string } = {}) {
    s ||= await this.settings();
    const got: string[] = [];
    for (const ch of o.channels || ["push"]) got.push(await this.pushOn(ch, key, title, body, open, s, o.cards));
    return got.includes("sent") ? "sent" : got.includes("deferred") ? "deferred" : got.includes("sent-before") ? "sent-before" : "off";
  }
  private async pushOn(ch: Outward, key: string, title: string, body: string, open: Open, s: ProSettings, cards?: string) {
    const now = this.clock();
    if (ch === "telegram" && !(await this.telegram?.paired().catch(() => false))) return "off";
    if ((await this.db.query("select 1 from notifications_sent where owner_id = $1 and event_key = $2 and channel = $3", [this.owner, key, ch])).length) return "sent-before";
    const later = (at: number) => this.db.query("insert into notify_queue (owner_id, event_key, channel, payload, due_at) values ($1, $2, $3, $4, $5) on conflict do nothing", [this.owner, key, ch, { title, body, open, ...(cards ? { cards } : {}) }, new Date(at)]);
    if (inQuiet(s, now)) { await later(quietEnd(s, now)); return "deferred"; }
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
  /** The pair card in the main thread, when Telegram isn't paired: once on first run, once when a Telegram channel is
   *  turned on, and whenever the person asks (Settings → Pair in chat). Never twice for the same reason. */
  async offerTelegram(why: "first" | "channel" | "asked") {
    const t = this.telegram;
    if (!t?.available || (why !== "asked" && await t.paired())) return null;
    if (why === "first" && !(await t.status().catch(() => null))?.configured) return null;
    return this.post(cardBlock({ type: "telegram_pair" }), why === "asked" ? `telegram-pair:asked:${this.clock()}` : `telegram-pair:${why}`);
  }
  /** Every 10 minutes: deadline reminders (48h and 3h before, by default), then what quiet hours held back. */
  async tick() {
    const s = await this.settings(), now = this.clock();
    if (s.events.deadline.on) {
      const [snap, g] = await Promise.all([this.workspace(), this.guc().catch((): GucFacts => ({ slots: [], deadlines: [], links: [], now: null }))]);
      const name = (id?: string) => snap.spaces.find((x) => x.id === id)?.name;
      const due = deadlineReminders(this.deadlines(g, snap), now, s.deadlineHours);
      const cards: ClemCard[] = [], said: typeof due = [];
      for (const r of due) {
        const text = `${r.deadline.title} is due ${leftText(r.left)}`;
        if (!(await this.record(r.key, "reminder", { type: "note", kind: "info", text: text.slice(0, 300) }, text, "said"))) continue;
        said.push(r);
        cards.push({ type: "reminder", title: text.slice(0, 200), due: new Date(dueAt(r.deadline.due)).toISOString().slice(0, 16) + "Z", ...(name(r.deadline.spaceId) ? { space: name(r.deadline.spaceId)!.slice(0, 120) } : {}), ...(r.deadline.spaceId ? { spaceId: r.deadline.spaceId } : {}) });
      }
      const tight = said.some((r) => r.hours <= 3);
      if (cards.length && delivery(s, { event: "deadline", urgent: tight }).post) {
        const postId = await this.post(cards.map((c) => cardBlock(c)).join("\n\n"), "reminders:" + said.map((r) => r.key).join(","));
        const channels = outward(s.events.deadline.channels);
        if (postId && (s.level !== "quiet" || tight) && channels.length) for (const [i, r] of said.entries()) {
          const guc = !r.deadline.id.startsWith("plan-");
          await this.push(r.key, `Due ${leftText(r.left)}`, r.deadline.title, guc ? { route: "#/app/guc/deadlines/" + encodeURIComponent(r.deadline.id) } : { chat: snap.mainId || "main", message: postId }, s, { channels, cards: cardBlock(cards[i]) });
        }
      }
    }
    return this.flush();
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
  /** Posts for the main thread and actions to apply, until acknowledged. */
  async inbox(): Promise<ProInbox> {
    const posts = await this.db.query<{ id: string; content: string; created_at: Date }>("select id, content, created_at from organizer_posts where owner_id = $1 and delivered_at is null order by created_at limit 50", [this.owner]);
    const apply = await this.db.query<{ key: string; action: ProAction }>("select key, action from organizer_actions where owner_id = $1 and status = 'apply' order by created_at limit 100", [this.owner]);
    return { posts: posts.map((p) => ({ id: p.id, content: p.content, at: ms(p.created_at) })), apply: apply.map((a) => ({ key: a.key, action: a.action })) };
  }
  async ack(o: { posts?: string[]; results?: { key: string; ok: boolean; undo?: Undo | null; error?: string }[] }) {
    for (const id of o.posts || []) await this.db.query("update organizer_posts set delivered_at = now() where owner_id = $1 and id = $2", [this.owner, id]);
    for (const r of o.results || []) await this.db.query("update organizer_actions set status = $3, undo = $4, error = $5, updated_at = now() where owner_id = $1 and key = $2 and status = 'apply'", [this.owner, r.key, r.ok ? "applied" : "failed", r.undo ?? null, r.error?.slice(0, 200) ?? null]);
    await this.db.query("delete from organizer_posts where owner_id = $1 and delivered_at < now() - interval '7 days'", [this.owner]);
  }
  /** "What Clem did today": everything since Cairo midnight (or `since`), newest first. */
  async log(since?: number): Promise<LogRow[]> {
    const from = since ?? cairoAt(cairo(this.clock()).ymd);
    const rows = await this.db.query<{ key: string; sweep: string; text: string; status: string; created_at: Date; undo: unknown; action: ProAction }>("select key, sweep, text, status, created_at, undo, action from organizer_actions where owner_id = $1 and created_at >= $2 order by created_at desc limit 200", [this.owner, new Date(from)]);
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
  /** "Don't tell me about this kind of thing": the change behind a card line becomes a mute (its kind, in its subject). */
  async mute(key: string) {
    const [row] = await this.db.query<{ action: { change?: Change } }>("select action from organizer_actions where owner_id = $1 and key = $2", [this.owner, key]);
    if (!row?.action?.change) return null;
    const m = muteFor(row.action.change);
    await this.db.query("insert into organizer_mutes (owner_id, mute_key, mute) values ($1, $2, $3) on conflict do nothing", [this.owner, muteKey(m), m]);
    return m;
  }
  async unmute(key: string) { await this.db.query("delete from organizer_mutes where owner_id = $1 and mute_key = $2", [this.owner, key]); }
  async mutesList() { return (await this.db.query<{ mute_key: string; mute: Mute }>("select mute_key, mute from organizer_mutes where owner_id = $1 order by created_at", [this.owner])).map((r) => ({ key: r.mute_key, ...r.mute })); }

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

function groupBy<T>(xs: T[], key: (x: T) => string) { const out: Record<string, T[]> = {}; for (const x of xs) (out[key(x)] ||= []).push(x); return out; }
