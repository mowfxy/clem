import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { SettingsCard, SettingRow } from "./SettingsParts";

// Settings → Proactivity: the reminders still to ring (docs/MAIN-THREAD.md "Reminders and study time"). Clem sends them
// itself, in the main thread, on the desktop and on Telegram. When the person studies is theirs to tell Clem in chat
// (clem.prefs).

type Reminder = { id: string; text: string; at: number; repeat?: "daily" | "weekly"; source: string };
const ask = <T,>(request: object) => desktop!.invoke(request as never) as Promise<T>;
const whenText = (t: number) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Settings → Proactivity: the reminders still to ring. */
export function CalendarSettings() {
  return <Reminders />;
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
