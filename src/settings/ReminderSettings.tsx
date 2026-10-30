import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { SettingsCard, SettingRow, Switch } from "./SettingsParts";

/** Flashcard reminders (desktop/study-reminders.ts): on or off, and when. */
export function ReminderSettings() {
  const [value, setValue] = useState<{ enabled: boolean; time: string } | null>(null);
  useEffect(() => { void desktop?.invoke({ action: "reminders" }).then(setValue).catch(() => {}); }, []);
  if (!desktop || !value) return null;
  const change = (set: { enabled?: boolean; time?: string }) => { setValue({ ...value, ...set }); void desktop!.invoke({ action: "reminders", set }).then(setValue).catch(() => {}); };
  return <SettingsCard title="Study reminders">
    <SettingRow title="Remind me when cards are due" description="Once a day at most."><Switch label="Remind me when cards are due" checked={value.enabled} onChange={(enabled) => change({ enabled })} /></SettingRow>
    {value.enabled && <SettingRow title="Time"><input type="time" aria-label="Reminder time" className="reminder-time" value={value.time} onChange={(e) => { if (/^\d\d:\d\d$/.test(e.target.value)) change({ time: e.target.value }); }} /></SettingRow>}
  </SettingsCard>;
}
