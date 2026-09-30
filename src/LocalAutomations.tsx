import { confirmDialog } from "./dialogs";
import { Icon } from "./Icons";
import type { Automation } from "../core/types";
import { DAYS, nextAutomation, firstAutomationRun } from "./automation-schedule";
export { nextAutomation, firstAutomationRun };
/** A routine proposed in a chat by an ```automation block. */
export type AutomationBlock = { name: string; prompt: string; repeat: "daily" | "weekly"; time: string; day?: string };
export function readAutomationBlock(code: string): AutomationBlock | null {
  try {
    const b = JSON.parse(code);
    if (typeof b?.name !== "string" || !b.name.trim() || typeof b.prompt !== "string" || !b.prompt.trim()) return null;
    const time = typeof b.time === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : "09:00";
    const repeat = b.repeat === "weekly" ? "weekly" : "daily";
    const day = repeat === "weekly" && DAYS.includes(String(b.day).toLowerCase()) ? String(b.day).toLowerCase() : undefined;
    return { name: b.name.trim().slice(0, 100), prompt: b.prompt.trim().slice(0, 8000), repeat, time, ...(day ? { day } : {}) };
  } catch { return null; }
}
/** “Every day at 8:00” / “Every Monday at 8:00”. */
export function describeSchedule(block: Pick<AutomationBlock, "repeat" | "time" | "day">) {
  const [h, m] = block.time.split(":").map(Number);
  const time = new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return block.repeat === "weekly" ? `Every ${block.day ? block.day[0].toUpperCase() + block.day.slice(1) : "week"} at ${time}` : `Every day at ${time}`;
}
const when = (t?: number) => t ? new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
/** Settings list: routines are created from a chat, and managed (paused, resumed, deleted) here. */
export function LocalAutomations({
  items,
  onChange,
}: {
  items: Automation[];
  /** Receives an update of the latest list, so a change never overwrites a run that happened meanwhile. */
  onChange: (update: (items: Automation[]) => Automation[]) => void;
}) {
  if (!items.length)
    return <div className="automation-empty"><Icon name="clock" size={20} /><p>No routines yet. Ask in any chat, like “every morning at 8, summarise the news”.</p></div>;
  return (
    <div className="automation-list">
      {items.map((a) => (
        <div className="setting-row v2 automation-row" key={a.id}>
          <div className="setting-row-text">
            <h3>{a.name}</h3>
            <p>{a.lastError ? <span className="automation-error">{a.lastError}</span> : a.enabled ? `${a.schedule === "weekly" ? "Weekly" : "Daily"} · next ${when(a.nextRun)}` : "Paused"}</p>
          </div>
          <div className="setting-row-control">
            <button className="secondary" onClick={() => onChange((items) => items.map((x) => x.id === a.id ? { ...x, enabled: !x.enabled, nextRun: x.nextRun && x.nextRun <= Date.now() ? nextAutomation(x.schedule, x.nextRun) : x.nextRun || Date.now() } : x))}>{a.enabled ? "Pause" : "Resume"}</button>
            <button className="secondary icon-only" aria-label={`Delete ${a.name}`} aria-description="Delete" onClick={async () => {
              if (await confirmDialog({ title: "Delete this routine?", message: "It stops running. Chats it already created are kept.", confirm: "Delete", danger: true }))
                onChange((items) => items.filter((x) => x.id !== a.id));
            }}><Icon name="trash" size={15} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
