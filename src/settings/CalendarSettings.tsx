import { useEffect, useRef, useState } from "react";
import { desktop } from "../desktop/bridge";
import { GoogleCalendarLogo } from "../BrandLogos";
import { SettingsCard, SettingRow, Switch } from "./SettingsParts";

// The calendar parts of Settings (docs/MAIN-THREAD.md "Calendar, reminders and study time"): Google Calendar as a row
// in Connectors (read-only, plus an option to put reminders in Clem's own "Clem" calendar there), and the reminders still
// to ring in Proactivity. When the person studies is theirs
// to tell Clem in chat (clem.prefs).

type Reminder = { id: string; text: string; at: number; repeat?: "daily" | "weekly"; source: string };
const ask = <T,>(request: object) => desktop!.invoke(request as never) as Promise<T>;
const whenText = (t: number) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Settings → Proactivity: the reminders still to ring. */
export function CalendarSettings() {
  return <Reminders />;
}

/** Settings → Connectors: Google Calendar, beside Google Drive. */
export function GoogleCalendarRow() {
  const [state, setState] = useState<{ connected: boolean; write?: boolean; error?: string } | null>(null), [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<boolean | null>(null);
  const waiting = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const check = (refresh = false) => ask<{ connected: boolean; checked: boolean; write?: boolean; error?: string }>({ action: "calendarStatus", refresh }).then((r) => { setState({ connected: !!r?.connected, write: !!r?.write, error: r?.error }); return !!r?.connected && (!google || !!r?.write); }, () => { setState((x) => x || { connected: false }); return false; });
  useEffect(() => { void check(); void ask<{ googleReminders?: boolean }>({ action: "proSettings" }).then((s) => setGoogle(!!s?.googleReminders), () => setGoogle(false)); return () => clearInterval(waiting.current); }, []);
  const setReminders = (on: boolean) => { setGoogle(on); void ask({ action: "proSettings", set: { googleReminders: on } }).catch(() => setGoogle(!on)); };
  // After "Connect" the browser finishes with Google; Clem notices on its own.
  const connect = async () => {
    setBusy(true);
    try { await ask({ action: "calendarConnect" }); } finally { setBusy(false); }
    clearInterval(waiting.current);
    const started = Date.now();
    waiting.current = setInterval(() => { if (Date.now() - started > 5 * 60_000) { clearInterval(waiting.current); return; } void check(true).then((on) => on && clearInterval(waiting.current)); }, 2500);
  };
  const disconnect = () => { setBusy(true); void ask({ action: "calendarDisconnect" }).then(() => setState({ connected: false }), (e: Error) => setState((x) => ({ connected: x?.connected ?? true, error: e.message }))).finally(() => setBusy(false)); };
  const status = state === null ? "Checking…" : state.error || (state.connected ? "Connected. Clem plans around your events and never changes them." : "Clem plans around your events and reminds you about quizzes and exams in it.");
  // Connected before Clem could add reminders: Google has to be asked again for its own calendar.
  const reconnect = !!state?.connected && !state.write && !!google;
  return <>
    <SettingRow lead={<span className="connector-tile"><GoogleCalendarLogo size={22} /></span>} title="Google Calendar" description={status}>
      {state !== null && (state.connected
        ? <button type="button" className="secondary" disabled={busy} onClick={disconnect}>Disconnect</button>
        : <button type="button" className="secondary" disabled={busy} onClick={() => void connect()}>Connect</button>)}
    </SettingRow>
    {!!state?.connected && google !== null && <SettingRow title="Add reminders to Google Calendar"
      description={reconnect ? "Connect again and allow Clem's own calendar, so your reminders can go there." : "Your reminders also go in a calendar called “Clem”, with Google's notification at the time. Clem only changes that calendar."}>
      {reconnect && <button type="button" className="secondary" disabled={busy} onClick={() => void connect()}>Connect again</button>}
      <Switch checked={google} onChange={setReminders} label="Add reminders to Google Calendar" />
    </SettingRow>}
  </>;
}

function Reminders() {
  const [list, setList] = useState<Reminder[] | null>(null);
  useEffect(() => { void ask<Reminder[]>({ action: "proReminders" }).then((v) => setList(Array.isArray(v) ? v : []), () => setList([])); }, []);
  if (!list?.length) return null;
  return <SettingsCard title="Upcoming reminders" note="Ask in any chat: “remind me Sunday at 9 to submit the lab report”.">
    {list.slice(0, 20).map((r) => <SettingRow key={r.id} title={r.text} description={`${whenText(r.at)}${r.repeat ? ` · every ${r.repeat === "daily" ? "day" : "week"}` : ""}${r.source === "study" ? " · study session" : ""}`}>
      <button type="button" className="secondary" onClick={() => void ask({ action: "proCancelReminder", id: r.id }).then(() => setList((x) => x?.filter((y) => y.id !== r.id) || x), () => {})}>Cancel</button>
    </SettingRow>)}
  </SettingsCard>;
}
