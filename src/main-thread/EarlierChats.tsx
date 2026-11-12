import { useState } from "react";
import type { Chat, Space } from "../../core/types";
import { SettingsCard, SettingRow } from "../settings/SettingsParts";
import { PickMenu } from "../ui/PickMenu";
import { shortWhen } from "../ui/when";

/** Where a chat can be moved: every subject, then every project. */
export function MoveToSpace({ chat, spaces, onMove }: { chat: Chat; spaces: Space[]; onMove: (spaceId: string) => void }) {
  if (!spaces.length) return null;
  const options = [...spaces.filter((s) => s.kind === "subject"), ...spaces.filter((s) => s.kind === "project")].map((s) => ({ value: s.id, label: s.name }));
  return <PickMenu label={`Move ${chat.title} to`} value="" placeholder="Move to…" options={options} onChange={(id) => id && onMove(id)} />;
}

/** Settings → Data & privacy: the chats from before every chat lived in a subject or project. Read-only, never
 *  deleted; moving one into a subject or project makes it an ordinary chat there. */
export function EarlierChats({ chats, spaces, onOpen, onMove }: { chats: Chat[]; spaces: Space[]; onOpen: (chat: Chat) => void; onMove: (chat: Chat, spaceId: string) => void }) {
  const [limit, setLimit] = useState(20);
  return (
    <SettingsCard title="Earlier chats" note={chats.length ? "From before every chat lived in a subject or project. Read-only until you move one." : undefined}>
      {!chats.length ? <SettingRow title="No earlier chats" description="Every chat is in a subject or project." /> : chats.slice(0, limit).map((c) => (
        <SettingRow key={c.id} title={c.title || "Conversation"} description={`${shortWhen(c.updated)} · ${c.messages.length} message${c.messages.length === 1 ? "" : "s"}`}>
          <span className="earlier-actions">
            <button type="button" className="secondary" onClick={() => onOpen(c)}>Open</button>
            <MoveToSpace chat={c} spaces={spaces} onMove={(id) => onMove(c, id)} />
          </span>
        </SettingRow>
      ))}
      {chats.length > limit && <SettingRow title={`${chats.length - limit} more`}><button type="button" className="secondary" onClick={() => setLimit((n) => n + 20)}>Show more</button></SettingRow>}
    </SettingsCard>
  );
}
