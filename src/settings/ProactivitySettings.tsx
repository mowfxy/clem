import { useEffect, useState } from "react";
import type { Model } from "../../core/types";
import { desktop } from "../desktop/bridge";
import { ModelSelector } from "../ModelSelector";
import { SettingsCard, SettingRow } from "./SettingsParts";
import { CalendarSettings } from "./CalendarSettings";
import { describeTrigger, type Trigger } from "../../core/proactivity/routines";

export type Organizer = { model?: string; reasoning?: string };
type LogRow = { key: string; sweep: string; text: string; status: string; at: number; undo: boolean; type: string };
type WatchRow = { id: string; text: string; live: boolean; fired: number; repeat?: boolean; until?: string };
type MuteRow = { key: string; kind: string; subjectId?: string };
type RoutineRow = { id: string; title: string; trigger: Trigger; post?: string; runs: number; lastRun?: number; lastResult?: string; live: boolean; stopped: boolean; hook?: string };

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, string> = { applied: "Done", apply: "Doing it…", undone: "Undone", confirm: "Waiting for you", dismissed: "Skipped", failed: "Couldn’t do it", said: "Told you", held: "Kept for your next update" };

/** Settings → Proactivity. Clem's organizer runs the main thread and every job Clem does on its own; below it, the
 *  reminders still to ring, what it did today with Undo, and what you asked it to watch. How much it speaks, quiet hours,
 *  its routines and study time are not settings: Clem asks once in the main thread and the person changes them by
 *  telling it (clem.prefs; user, 2026-11-12). */
export function ProactivitySettings({ models, organizer, fallback, onChange, onConnect, onUndo }: { models: Model[]; organizer?: Organizer; fallback: string; onChange: (next: Organizer) => void; onConnect: () => void; onUndo?: (key: string) => Promise<unknown> }) {
  const chosen = organizer?.model && models.some((m) => m.id === organizer.model) ? organizer.model : fallback;
  const effort = organizer?.reasoning ?? models.find((m) => m.id === chosen)?.defaultReasoningEffort ?? "";
  const unset = !organizer?.model;
  return <>
    <SettingsCard title="Clem’s organizer" note="It runs your main thread and decides on its own what is worth telling you. Anything you want it to do on its own (a look at your day, the moment a grade lands, a webhook to your own tools), quiet hours and how much you hear from it: just tell Clem, in any chat.">
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
  const [log, setLog] = useState<LogRow[] | null>(null), [watches, setWatches] = useState<WatchRow[]>([]), [mutes, setMutes] = useState<MuteRow[]>([]), [routines, setRoutines] = useState<RoutineRow[]>([]);
  const load = () => {
    void desktop!.invoke({ action: "proLog" } as never).then((v) => setLog(Array.isArray(v) ? v as LogRow[] : []), () => setLog([]));
    void desktop!.invoke({ action: "proWatches" } as never).then((v) => setWatches(Array.isArray(v) ? v as WatchRow[] : []), () => {});
    void desktop!.invoke({ action: "proMutes" } as never).then((v) => setMutes(Array.isArray(v) ? v as MuteRow[] : []), () => {});
    void desktop!.invoke({ action: "proRoutines" } as never).then((v) => setRoutines(Array.isArray(v) ? (v as RoutineRow[]).filter((r) => !r.stopped) : []), () => {});
  };
  useEffect(load, []);
  return <>
    <CalendarSettings />
    <SettingsCard title="Routines" note={routines.length ? "They run on this PC, or on your VPS when it runs Clem’s jobs. Ask Clem in any chat to add or change one." : undefined}>
      {!routines.length ? <p>None yet. Ask Clem for anything it should do on its own, like “tell me the second a grade is posted” or “every Thursday night, look at next week”.</p>
        : routines.map((r) => <SettingRow key={r.id} title={r.title} description={[describeTrigger(r.trigger), r.post ? "posts to " + new URL(r.post).host : "", r.runs ? `ran ${r.runs}×${r.lastRun ? " · last " + new Date(r.lastRun).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}` : "hasn’t run yet", !r.live ? "finished" : ""].filter(Boolean).join(" · ")}>
          {r.hook && <button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(r.hook!)}>Copy URL</button>}
          <button type="button" className="secondary" onClick={() => void desktop!.invoke({ action: "proStopRoutine", id: r.id } as never).then((v) => setRoutines(Array.isArray(v) ? (v as RoutineRow[]).filter((x) => !x.stopped) : []), () => {})}>Stop</button>
        </SettingRow>)}
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
