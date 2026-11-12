import { useEffect, useState } from "react";
import type { Model } from "../../core/types";
import { JOB_KINDS, readPro, type JobKind, type Level, type ProPatch, type ProSettings } from "../../core/proactivity/settings";
import { desktop } from "../desktop/bridge";
import { ModelSelector } from "../ModelSelector";
import { SettingsCard, SettingRow, Switch } from "./SettingsParts";
import { CalendarSettings } from "./CalendarSettings";

export type Organizer = { model?: string; reasoning?: string };
type LogRow = { key: string; sweep: string; text: string; status: string; at: number; undo: boolean; type: string };
type WatchRow = { id: string; text: string; live: boolean; fired: number; repeat?: boolean; until?: string };
type MuteRow = { key: string; kind: string; subjectId?: string };

const LEVEL_TEXT: Record<Level, string> = {
  quiet: "Only what can’t wait. Clem still plans and tidies in the background.",
  balanced: "Briefs, and what Clem thinks matters to you. The rest waits for a digest.",
  proactive: "Whatever Clem thinks will help, as it happens. Clem never repeats itself.",
};
const JOB_TEXT: Record<JobKind, [string, string]> = {
  morning: ["Morning brief", "Plans your day into time blocks"], midday: ["Midday check", "Moves what slipped this morning"],
  evening: ["Evening prep", "Tomorrow’s classes and what’s due"], weekly: ["Weekly review", "How the week went and what’s next"],
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, string> = { applied: "Done", apply: "Doing it…", undone: "Undone", confirm: "Waiting for you", dismissed: "Skipped", failed: "Couldn’t do it", said: "Told you" };

/** Settings → Proactivity. Clem's organizer runs the main thread and every job Clem does on its own; below it, how much
 *  Clem speaks and where, its timed jobs, what you asked it to watch, and what it did today with Undo. */
export function ProactivitySettings({ models, organizer, fallback, onChange, onConnect, onUndo }: { models: Model[]; organizer?: Organizer; fallback: string; onChange: (next: Organizer) => void; onConnect: () => void; onUndo?: (key: string) => Promise<unknown> }) {
  const chosen = organizer?.model && models.some((m) => m.id === organizer.model) ? organizer.model : fallback;
  const effort = organizer?.reasoning ?? models.find((m) => m.id === chosen)?.defaultReasoningEffort ?? "";
  const unset = !organizer?.model;
  return <>
    <SettingsCard title="Clem’s organizer" note="It answers in your main thread, hands questions to the right subject or project, and keeps the thread’s running notes. It decides on its own what is worth telling you; tidying your plan follows rules and costs no AI use.">
      <SettingRow title="Model" description={unset ? "Uses your default model until you pick one." : models.find((m) => m.id === chosen && m.connected) ? undefined : "Not connected right now. Clem uses your default model meanwhile."}>
        <ModelSelector models={models} value={chosen} effort={effort} label="Choose Clem’s organizer model"
          onChange={(id) => onChange({ model: id, reasoning: models.find((m) => m.id === id)?.defaultReasoningEffort || undefined })}
          onEffort={(value) => onChange({ ...organizer, model: chosen || undefined, reasoning: value })} onConnect={onConnect} />
      </SettingRow>
    </SettingsCard>
    {desktop && <Proactivity onUndo={onUndo} />}
  </>;
}

function Proactivity({ onUndo }: { onUndo?: (key: string) => Promise<unknown> }) {
  const [s, setS] = useState<ProSettings | null>(null), [failed, setFailed] = useState(false);
  const [log, setLog] = useState<LogRow[] | null>(null), [watches, setWatches] = useState<WatchRow[]>([]), [mutes, setMutes] = useState<MuteRow[]>([]);
  const load = () => {
    setFailed(false);
    void desktop!.invoke({ action: "proSettings" } as never).then((v) => setS(readPro(v)), () => setFailed(true));
    void desktop!.invoke({ action: "proLog" } as never).then((v) => setLog(Array.isArray(v) ? v as LogRow[] : []), () => setLog([]));
    void desktop!.invoke({ action: "proWatches" } as never).then((v) => setWatches(Array.isArray(v) ? v as WatchRow[] : []), () => {});
    void desktop!.invoke({ action: "proMutes" } as never).then((v) => setMutes(Array.isArray(v) ? v as MuteRow[] : []), () => {});
  };
  useEffect(load, []);
  // Edits show at once; the engine's answer replaces the guess.
  const change = (patch: ProPatch, guess: (x: ProSettings) => ProSettings) => { if (!s) return; setS(guess(s)); void desktop!.invoke({ action: "proSettings", set: patch } as never).then((v) => setS(readPro(v)), () => setS(s)); };
  if (failed) return <SettingsCard title="How Clem keeps you posted"><SettingRow title="Couldn’t load these settings" description="Clem’s background engine isn’t answering yet."><button type="button" className="secondary" onClick={load}>Try again</button></SettingRow></SettingsCard>;
  if (!s) return <SettingsCard title="How Clem keeps you posted">{[0, 1, 2].map((i) => <div key={i} className="st-row" aria-busy="true"><div className="st-row-text"><span className="st-skel" /><span className="st-skel short" /></div></div>)}</SettingsCard>;
  return <>
    <SettingsCard title="How Clem keeps you posted">
      <SettingRow title="How much Clem speaks" description={LEVEL_TEXT[s.level]}>
        <span className="text-size" role="radiogroup" aria-label="How much Clem speaks">{(["quiet", "balanced", "proactive"] as const).map((l) => <button key={l} type="button" role="radio" aria-checked={s.level === l} onClick={() => change({ level: l }, (x) => ({ ...x, level: l }))}>{l[0].toUpperCase() + l.slice(1)}</button>)}</span>
      </SettingRow>
      <SettingRow title="Quiet hours" description={s.quiet.on ? "Desktop and Telegram notifications wait until they end. Nothing is dropped." : "Off: notifications can come any time."}>
        {s.quiet.on && <><input type="time" aria-label="Quiet hours start" className="reminder-time" value={s.quiet.from} onChange={(e) => { const v = e.target.value; if (/^\d\d:\d\d$/.test(v)) change({ quiet: { from: v } }, (x) => ({ ...x, quiet: { ...x.quiet, from: v } })); }} />
          <input type="time" aria-label="Quiet hours end" className="reminder-time" value={s.quiet.to} onChange={(e) => { const v = e.target.value; if (/^\d\d:\d\d$/.test(v)) change({ quiet: { to: v } }, (x) => ({ ...x, quiet: { ...x.quiet, to: v } })); }} /></>}
        <Switch label="Quiet hours" checked={s.quiet.on} onChange={(on) => change({ quiet: { on } }, (x) => ({ ...x, quiet: { ...x.quiet, on } }))} />
      </SettingRow>
    </SettingsCard>
    <CalendarSettings />
    <SettingsCard title="Clem’s routines" note="Cairo time. Each runs only when something changed, and never repeats itself.">
      {JOB_KINDS.map((k) => { const j = s.jobs[k]; return <SettingRow key={k} title={JOB_TEXT[k][0]} description={JOB_TEXT[k][1] + (j.day !== undefined ? ` · ${DAYS[j.day]}s` : "")}>
        {j.on && <input type="time" aria-label={`${JOB_TEXT[k][0]} time`} className="reminder-time" value={j.time} onChange={(e) => { const v = e.target.value; if (/^\d\d:\d\d$/.test(v)) change({ jobs: { [k]: { time: v } } }, (x) => ({ ...x, jobs: { ...x.jobs, [k]: { ...x.jobs[k], time: v } } })); }} />}
        <Switch label={JOB_TEXT[k][0]} checked={j.on} onChange={(on) => change({ jobs: { [k]: { on } } }, (x) => ({ ...x, jobs: { ...x.jobs, [k]: { ...x.jobs[k], on } } }))} />
      </SettingRow>; })}
    </SettingsCard>
    <SettingsCard title="What Clem did today" note={log?.length ? "Undo puts things back as they were; anything you changed since stays." : undefined}>
      {log === null ? [0, 1].map((i) => <div key={i} className="st-row" aria-busy="true"><div className="st-row-text"><span className="st-skel" /></div></div>)
        : !log.length ? <p>Nothing yet today. Clem’s morning brief and any changes from your subjects will show here.</p>
        : log.map((r) => <SettingRow key={r.key} title={r.text} description={`${time(r.at)} · ${STATUS[r.status] || r.status}`}>
          {r.undo && onUndo && <button type="button" className="secondary" onClick={() => void onUndo(r.key).then(() => setLog((l) => l?.map((x) => (x.key === r.key ? { ...x, status: "undone", undo: false } : x)) || l))}>Undo</button>}
        </SettingRow>)}
    </SettingsCard>
    {(watches.length > 0 || mutes.length > 0) && <SettingsCard title="Watching and muted" note="Ask in any chat: “tell me when the midterm room is posted”.">
      {watches.map((w) => <SettingRow key={w.id} title={w.text} description={!w.live ? (w.fired ? "Told you" : "Ended") : w.repeat ? "Every time" : `Once${w.until ? ` · until ${w.until}` : ""}`}>
        {w.live && <button type="button" className="secondary" onClick={() => void desktop!.invoke({ action: "proStopWatch", id: w.id } as never).then((v) => setWatches(v as WatchRow[]), () => {})}>Stop</button>}
      </SettingRow>)}
      {mutes.map((m) => <SettingRow key={m.key} title={`Not telling you about ${m.kind.replace(/_/g, " ")}`} description={m.subjectId ? "In one subject" : "Everywhere"}>
        <button type="button" className="secondary" onClick={() => void desktop!.invoke({ action: "proUnmute", key: m.key } as never).then(() => setMutes((x) => x.filter((y) => y.key !== m.key)), () => {})}>Unmute</button>
      </SettingRow>)}
    </SettingsCard>}
  </>;
}
