import type { LectureCard, OrganizerCard, WatchCard } from "../../core/guc/cards";
import { useState } from "react";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { useProStatus, type Pro } from "./pro";

/** What the organizer's cards can do: Undo, one tap, mute, Stop, and the lecture buttons (a chat in the subject with the
 *  request typed; nothing is generated until the person sends it). */
export type ProActions = Pick<Pro, "undo" | "confirm" | "dismiss" | "mute" | "stopWatch"> & {
  lecture: (subjectId: string, file: { id: string; name: string; saved?: boolean }, want: "summary" | "flashcards") => void;
  open: (href: string) => void;
  spaceName: (id: string) => string | undefined;
};

const WHEN: Record<string, string> = { morning: "Morning brief", midday: "Midday check", evening: "Evening prep", weekly: "Weekly review", event: "What changed", reminder: "Reminder", study: "Study plan" };
const ICON: Record<string, string> = { morning: "spark", midday: "clock", evening: "clock", weekly: "list", event: "list", reminder: "clock", study: "clock" };

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

/** A reminder the person set (it carries an id): when it rings, and Cancel while it is still to come. */
export function ReminderCardView({ card }: { card: { title: string; at?: string; id?: string; space?: string; note?: string; repeat?: "daily" | "weekly"; rang?: boolean } }) {
  const [state, setState] = useState<"idle" | "busy" | "cancelled" | "gone">("idle");
  // A card that is the reminder ringing is past by definition; one that was just set is upcoming until its time.
  const at = card.at ? Date.parse(card.at) : NaN, upcoming = !card.rang && Number.isFinite(at) && at > Date.now();
  const when = Number.isFinite(at) ? new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const cancel = () => {
    if (!desktop || !card.id) return;
    setState("busy");
    void desktop.invoke({ action: "proCancelReminder", id: card.id } as never).then((r) => setState((r as { ok?: boolean })?.ok ? "cancelled" : "gone"), () => setState("idle"));
  };
  const what = state === "cancelled" ? "Cancelled" : [upcoming ? `Reminds you ${when}` : when, card.repeat && (card.repeat === "daily" ? "every day" : "every week"), card.space].filter(Boolean).join(" · ");
  return <div className="edit-proposal clem-card pro-card">
    <header><Icon name="clock" size={16} /><div><strong>{card.title}</strong><small>{what || "Reminder"}</small></div></header>
    {card.note && <p className="automation-prompt">{card.note}</p>}
    {card.id && desktop && (upcoming || card.repeat) && state !== "cancelled" && <footer><button type="button" disabled={state === "busy"} onClick={cancel}>{state === "gone" ? "Already done" : "Cancel reminder"}</button></footer>}
  </div>;
}
