import type { LectureCard, OrganizerCard, WatchCard } from "../../core/guc/cards";
import { Icon } from "../Icons";
import { useProStatus, type Pro } from "./pro";

/** What the organizer's cards can do: Undo, one tap, mute, Stop, and the lecture buttons (a chat in the subject with the
 *  request typed; nothing is generated until the person sends it). */
export type ProActions = Pick<Pro, "undo" | "confirm" | "dismiss" | "mute" | "stopWatch"> & {
  lecture: (subjectId: string, file: { id: string; name: string; saved?: boolean }, want: "summary" | "flashcards") => void;
  open: (href: string) => void;
  spaceName: (id: string) => string | undefined;
};

const WHEN: Record<string, string> = { morning: "Morning brief", midday: "Midday check", evening: "Evening prep", weekly: "Weekly review", event: "What changed", reminder: "Reminder" };
const ICON: Record<string, string> = { morning: "spark", midday: "clock", evening: "clock", weekly: "list", event: "list", reminder: "clock" };

/** One line's controls, from its live status in the engine's log. */
function LineActions({ k, status, actions }: { k: string; status?: string; actions?: ProActions }) {
  if (!actions || !status || status === "none") return null;
  if (status === "applied") return <button type="button" onClick={() => void actions.undo(k)} aria-label="Undo this">Undo</button>;
  if (status === "undone") return <small>Undone</small>;
  if (status === "confirm") return <><button type="button" onClick={() => void actions.dismiss(k)}>Not now</button><button type="button" className="primary" onClick={() => void actions.confirm(k)}>Do it</button></>;
  if (status === "dismissed") return <small>Skipped</small>;
  if (status === "failed") return <small>Couldn’t do this</small>;
  if (status === "muted") return <small>Muted</small>;
  if (status === "said" && k.startsWith("change:")) return <button type="button" className="pro-mute" onClick={() => void actions.mute(k)} aria-label="Don’t tell me about this kind of thing" title="Don’t tell me about this kind of thing">Mute</button>;
  return null;
}

export function OrganizerCardView({ card, actions }: { card: OrganizerCard; actions?: ProActions }) {
  const status = useProStatus(card.lines.flatMap((l) => (l.key ? [l.key] : [])));
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name={ICON[card.when || "event"] || "spark"} size={16} /><div><strong>{card.title}</strong><small>{WHEN[card.when || "event"]}</small></div></header>
    <div className="guc-card-body">
      <ul className="guc-new pro-lines">{card.lines.map((l, i) => <li key={l.key || i} data-status={l.key ? status(l.key) : undefined}>
        {l.time && <time>{l.time}</time>}
        <span className="pro-line">{l.href ? <a href={l.href} onClick={(e) => { e.preventDefault(); actions?.open(l.href!); }}>{l.text}</a> : l.text}{l.space && <small>{l.space}</small>}</span>
        {l.key && <LineActions k={l.key} status={status(l.key)} actions={actions} />}
      </li>)}</ul>
    </div>
  </div>;
}

export function LectureCardView({ card, actions }: { card: LectureCard; actions?: ProActions }) {
  const name = actions?.spaceName(card.subjectId), n = card.files.length;
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name="files" size={16} /><div><strong>{n === 1 ? `New lecture${name ? " in " + name : ""}` : `${n} new lectures${name ? " in " + name : ""}`}</strong><small>Want a summary or flashcards? One tap starts it.</small></div></header>
    <div className="guc-card-body">
      <ul className="guc-new">{card.files.map((f) => <li key={f.id}>
        <span className="guc-new-name"><span className="guc-saved-name">{f.name}</span></span>
        <button type="button" onClick={() => actions?.lecture(card.subjectId, f, "summary")} aria-label={`Summarize ${f.name}`}>Summarize</button>
        <button type="button" onClick={() => actions?.lecture(card.subjectId, f, "flashcards")} aria-label={`Make flashcards from ${f.name}`}>Make flashcards</button>
      </li>)}</ul>
    </div>
  </div>;
}

export function WatchCardView({ card, actions }: { card: WatchCard; actions?: ProActions }) {
  const status = useProStatus(["watch:" + card.id])("watch:" + card.id);
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name="clock" size={16} /><div><strong>{status === "stopped" ? "Stopped watching" : "Watching for you"}</strong><small>{card.text}</small></div></header>
    {actions && status !== "stopped" && <footer><button type="button" onClick={() => void actions.stopWatch(card.id)}>Stop</button></footer>}
  </div>;
}
