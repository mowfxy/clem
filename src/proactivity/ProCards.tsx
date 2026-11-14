import type { LectureCard, OrganizerCard, RoutineCard, WatchCard } from "../../core/guc/cards";
import { useState } from "react";
import { Icon } from "../Icons";
import { useProStatus } from "./pro";

/** Cards Clem posted by itself before its messages became plain words (docs/MAIN-THREAD.md "Proactivity"): they still
 *  render in an older thread, as what they said, with no Undo, Do it, Mute, Stop or Cancel (the person says it in
 *  words now). Only the lecture card keeps its buttons: they start a chat, nothing more. */
export type ProActions = {
  lecture: (subjectId: string, file: { id: string; name: string; saved?: boolean }, want: "summary" | "flashcards") => void;
  open: (href: string) => void;
  spaceName: (id: string) => string | undefined;
};

const WHEN: Record<string, string> = { morning: "Morning brief", midday: "Midday check", evening: "Evening prep", weekly: "Weekly review", event: "What changed", reminder: "Reminder", study: "Study plan" };
const ICON: Record<string, string> = { morning: "spark", midday: "clock", evening: "clock", weekly: "list", event: "list", reminder: "clock", study: "clock" };
/** What happened to a line since, read live: said once, nothing to press. */
const DONE: Record<string, string> = { undone: "Undone", revert: "Undone", dismissed: "Skipped", failed: "Couldn’t do this" };

export function OrganizerCardView({ card, actions }: { card: OrganizerCard; actions?: ProActions }) {
  const status = useProStatus(card.lines.flatMap((l) => (l.key ? [l.key] : [])));
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name={ICON[card.when || "event"] || "spark"} size={16} /><div><strong>{card.title}</strong><small>{WHEN[card.when || "event"]}</small></div></header>
    <div className="guc-card-body">
      <ul className="guc-new pro-lines">{card.lines.map((l, i) => <li key={l.key || i} data-status={l.key ? status(l.key) : undefined}>
        {l.time && <time>{l.time}</time>}
        <span className="pro-line">{l.href ? <a href={l.href} onClick={(e) => { e.preventDefault(); actions?.open(l.href!); }}>{l.text}</a> : l.text}{l.space && <small>{l.space}</small>}</span>
        {l.key && DONE[status(l.key) || ""] && <small>{DONE[status(l.key)!]}</small>}
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

export function WatchCardView({ card }: { card: WatchCard; actions?: ProActions }) {
  const status = useProStatus(["watch:" + card.id])("watch:" + card.id);
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name="clock" size={16} /><div><strong>{status === "stopped" ? "Stopped watching" : "Watching for you"}</strong><small>{card.text}</small></div></header>
  </div>;
}

/** A routine Clem set up for the person: what starts it and what it does, and its webhook URL to copy. */
export function RoutineCardView({ card }: { card: RoutineCard; actions?: ProActions }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(card.hook || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  return <div className="edit-proposal clem-card guc-card pro-card">
    <header><Icon name="spark" size={16} /><div><strong>{card.title}</strong><small>{[card.when, card.does].filter(Boolean).join(" · ")}</small></div></header>
    {card.hook && <><p className="automation-prompt pro-hook"><code>{card.hook}</code></p><footer><button type="button" className="secondary" onClick={copy}>{copied ? "Copied" : "Copy URL"}</button></footer></>}
  </div>;
}

/** A reminder: what, and when it rings (or rang). Cancelling one is said in words now (clem.unremind). */
export function ReminderCardView({ card }: { card: { title: string; at?: string; id?: string; space?: string; note?: string; repeat?: "daily" | "weekly"; rang?: boolean } }) {
  const at = card.at ? Date.parse(card.at) : NaN, upcoming = !card.rang && Number.isFinite(at) && at > Date.now();
  const when = Number.isFinite(at) ? new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const what = [upcoming ? `Reminds you ${when}` : when, card.repeat && (card.repeat === "daily" ? "every day" : "every week"), card.space].filter(Boolean).join(" · ");
  return <div className="edit-proposal clem-card pro-card">
    <header><Icon name="clock" size={16} /><div><strong>{card.title}</strong><small>{what || "Reminder"}</small></div></header>
    {card.note && <p className="automation-prompt">{card.note}</p>}
  </div>;
}
