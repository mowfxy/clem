import { useMemo } from "react";
import { readCard } from "../../core/guc/cards";
import { Icon } from "../Icons";

export type CardHandlers = {
  /** A hand-off card was pressed: open the chat it continued in (or its subject or project when the chat is gone). */
  onOpenChat?: (chatId: string, spaceId: string) => void;
  /** The space's name now, so a renamed subject reads right on older cards. */
  spaceName?: (spaceId: string) => string | undefined;
};

/** A ```clem-card block, drawn like the other proposal cards. A body that is not a known card draws nothing. */
export function ClemCardBlock({ body, handlers = {} }: { body: string; handlers?: CardHandlers }) {
  const card = useMemo(() => readCard(body), [body]);
  if (!card) return null;
  if (card.type === "handoff") {
    const name = handlers.spaceName?.(card.spaceId) || card.spaceName;
    return (
      <button type="button" className="edit-proposal clem-card clem-handoff" aria-label={`Continued in ${name}. Open the chat`} onClick={() => handlers.onOpenChat?.(card.chatId, card.spaceId)}>
        <header>
          <Icon name={card.spaceKind === "project" ? "projects" : "subjects"} size={16} />
          <div><strong>Continued in {name}</strong><small>{card.title || (card.reason === "mention" ? "You mentioned it, so the answer carries on there." : "The answer carries on in its chat.")}</small></div>
          <Icon name="arrow" size={15} />
        </header>
      </button>
    );
  }
  if (card.type === "brief") return (
    <div className="edit-proposal clem-card">
      <header><Icon name="spark" size={16} /><div><strong>{card.title}</strong>{card.when && <small>{card.when === "morning" ? "Morning brief" : "Evening prep"}</small>}</div></header>
      {card.items.length > 0 && <ul className="clem-card-list">{card.items.map((it, i) => <li key={i}>{it.time && <time>{it.time}</time>}<span>{it.text}</span>{it.space && <small>{it.space}</small>}</li>)}</ul>}
    </div>
  );
  if (card.type === "reminder") return (
    <div className="edit-proposal clem-card">
      <header><Icon name="clock" size={16} /><div><strong>{card.title}</strong><small>{[card.due && "Due " + card.due.slice(0, 10), card.space].filter(Boolean).join(" · ") || "Reminder"}</small></div></header>
      {card.note && <p className="automation-prompt">{card.note}</p>}
    </div>
  );
  return (
    <div className="edit-proposal clem-card">
      <header><Icon name="list" size={16} /><div><strong>{card.title || "Since you last looked"}</strong></div></header>
      <ul className="clem-card-list">{card.lines.map((l, i) => <li key={i}><span>{l.text}</span>{l.space && <small>{l.space}</small>}</li>)}</ul>
    </div>
  );
}
