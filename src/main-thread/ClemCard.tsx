import { useMemo } from "react";
import { readCard } from "../../core/guc/cards";
import { Icon } from "../Icons";
import { GUC_CARDS, GucCardView, type GucActions } from "../guc/GucCards";
import { LectureCardView, OrganizerCardView, ReminderCardView, RoutineCardView, WatchCardView, type ProActions } from "../proactivity/ProCards";
import { TelegramPairCard } from "../telegram/TelegramPair";
import { GucPasswordCard } from "../guc/GucPassword";
import { PASSWORD_ROUTE } from "../../core/guc/password";
import { VpsConfirmCardView, VpsMovedCardView } from "../vps/VpsCards";

export type CardHandlers = {
  /** A hand-off card was pressed: open the chat it continued in (or its subject or project when the chat is gone). */
  onOpenChat?: (chatId: string, spaceId: string) => void;
  /** The space's name now, so a renamed subject reads right on older cards. */
  spaceName?: (spaceId: string) => string | undefined;
  /** GUC cards' actions (src/guc/setup.ts), and the subject of the chat the card is in. */
  guc?: GucActions;
  chatSpace?: string | null;
  /** The organizer's cards: Undo, one tap, mute, Stop and the lecture buttons (src/proactivity/pro.ts). */
  pro?: ProActions;
};

/** A ```clem-card block, drawn like the other proposal cards. A body that is not a known card draws nothing. */
export function ClemCardBlock({ body, handlers = {} }: { body: string; handlers?: CardHandlers }) {
  const card = useMemo(() => readCard(body), [body]);
  if (!card) return null;
  if (GUC_CARDS.has(card.type)) return <GucCardView card={card as Parameters<typeof GucCardView>[0]["card"]} actions={handlers.guc} spaceId={handlers.chatSpace} />;
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
  if (card.type === "organizer") return <OrganizerCardView card={card} actions={handlers.pro} />;
  if (card.type === "lecture") return <LectureCardView card={card} actions={handlers.pro} />;
  if (card.type === "watch") return <WatchCardView card={card} actions={handlers.pro} />;
  if (card.type === "routine") return <RoutineCardView card={card} actions={handlers.pro} />;
  if (card.type === "telegram_pair") return <TelegramPairCard />;
  if (card.type === "vps_moved") return <VpsMovedCardView card={card} onOpen={handlers.guc ? () => handlers.guc!.openHub("/app/connectors/vps") : undefined} />;
  if (card.type === "vps_confirm") return <VpsConfirmCardView card={card} />;
  if (card.type === "guc_password") return <GucPasswordCard onUpdate={handlers.guc ? () => handlers.guc!.openHub(PASSWORD_ROUTE) : undefined} />;
  if (card.type === "brief") return (
    <div className="edit-proposal clem-card">
      <header><Icon name="spark" size={16} /><div><strong>{card.title}</strong>{card.when && <small>{card.when === "morning" ? "Morning brief" : "Evening prep"}</small>}</div></header>
      {card.items.length > 0 && <ul className="clem-card-list">{card.items.map((it, i) => <li key={i}>{it.time && <time>{it.time}</time>}<span>{it.text}</span>{it.space && <small>{it.space}</small>}</li>)}</ul>}
    </div>
  );
  if (card.type === "reminder" && (card.id || card.at)) return <ReminderCardView card={card} />;
  if (card.type === "reminder") return (
    <div className="edit-proposal clem-card">
      <header><Icon name="clock" size={16} /><div><strong>{card.title}</strong><small>{[card.due && "Due " + card.due.slice(0, 10), card.space].filter(Boolean).join(" · ") || "Reminder"}</small></div></header>
      {card.note && <p className="automation-prompt">{card.note}</p>}
    </div>
  );
  if (card.type !== "digest") return null;
  return (
    <div className="edit-proposal clem-card">
      <header><Icon name="list" size={16} /><div><strong>{card.title || "Since you last looked"}</strong></div></header>
      <ul className="clem-card-list">{card.lines.map((l, i) => <li key={i}><span>{l.text}</span>{l.space && <small>{l.space}</small>}</li>)}</ul>
    </div>
  );
}
