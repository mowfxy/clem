import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Chat, Space } from "../../core/types";
import { Icon } from "../Icons";

const OPEN_KEY = "clem-sidebar-open";
/** Chats listed under an open subject or project before "Show all". */
const PER_SPACE = 6;
/** Past this many rows the list is virtualized. */
const VIRTUAL_FROM = 80;
const ROW = 34;

type Row =
  | { key: string; kind: "label"; label: string }
  | { key: string; kind: "space"; space: Space; open: boolean; count: number }
  | { key: string; kind: "chat"; chat: Chat }
  | { key: string; kind: "more"; space: Space; rest: number }
  | { key: string; kind: "none"; space: Space };

function readOpen(): string[] { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } }

/**
 * The sidebar's list: subjects, then projects, each opening to its chats (newest first, pinned on top). Which ones are
 * open is remembered on this device. "New chat" sits on each row; there are no chats outside a subject or project.
 * `row` draws a chat row exactly as the old history did (menu, rename, live and unseen marks).
 */
export function SidebarSpaces({ spaces, chats, activeChat, activeSpace, row, onOpenSpace, onNewChat, onCreate }: {
  spaces: Space[]; chats: Chat[]; activeChat: string | null; activeSpace: string | null;
  row: (chat: Chat) => ReactNode; onOpenSpace: (id: string, tab?: "chats") => void; onNewChat: (spaceId: string) => void; onCreate: (kind: "subject" | "project") => void;
}) {
  const [open, setOpen] = useState<string[]>(readOpen);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(open.slice(-200))); } catch { /* Only this device's convenience. */ } }, [open]);
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  // The chat on screen is always visible: its subject or project opens.
  const here = chats.find((c) => c.id === activeChat)?.spaceId;
  useEffect(() => { if (here) setOpen((o) => (o.includes(here) ? o : [...o, here])); }, [here]);
  const rows = useMemo(() => {
    const by = new Map<string, Chat[]>();
    for (const c of chats) if (c.spaceId) { const list = by.get(c.spaceId); if (list) list.push(c); else by.set(c.spaceId, [c]); }
    const out: Row[] = [];
    for (const [kind, label] of [["subject", "Subjects"], ["project", "Projects"]] as const) {
      const list = spaces.filter((s) => s.kind === kind);
      if (!list.length) continue;
      out.push({ key: "label-" + kind, kind: "label", label });
      for (const s of list) {
        const own = (by.get(s.id) || []).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
        const isOpen = open.includes(s.id);
        out.push({ key: "s-" + s.id, kind: "space", space: s, open: isOpen, count: own.length });
        if (!isOpen) continue;
        // The chat on screen stays listed even when it is older than the first few.
        const first = own.slice(0, PER_SPACE), extra = own.slice(PER_SPACE).filter((c) => c.id === activeChat);
        for (const c of [...first, ...extra]) out.push({ key: "c-" + c.id, kind: "chat", chat: c });
        if (own.length > first.length + extra.length) out.push({ key: "m-" + s.id, kind: "more", space: s, rest: own.length - first.length - extra.length });
        if (!own.length) out.push({ key: "n-" + s.id, kind: "none", space: s });
      }
    }
    return out;
  }, [spaces, chats, open, activeChat]);
  const box = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => box.current, estimateSize: () => ROW, getItemKey: (i) => rows[i].key, overscan: 10, enabled: rows.length > VIRTUAL_FROM });
  const draw = (r: Row) => {
    switch (r.kind) {
      case "label": return <div className="history-label side-label"><span>{r.label}</span></div>;
      case "space": return (
        <div className={`history-row side-space ${r.space.id === activeSpace ? "chosen" : ""}`}>
          <button type="button" className="side-chev" aria-label={`${r.open ? "Hide" : "Show"} chats in ${r.space.name}`} aria-expanded={r.open} onClick={() => toggle(r.space.id)}><Icon name={r.open ? "down" : "right"} size={13} /></button>
          <button type="button" className={`history-item side-space-item ${r.space.id === activeSpace ? "chosen" : ""}`} aria-current={r.space.id === activeSpace ? "page" : undefined} onClick={() => { onOpenSpace(r.space.id); if (!r.open) toggle(r.space.id); }}>
            <span className="history-title">{r.space.name}</span>
          </button>
          <button type="button" className="history-more side-new" aria-label={`New chat in ${r.space.name}`} title="New chat" onClick={() => { if (!r.open) toggle(r.space.id); onNewChat(r.space.id); }}><Icon name="plus" size={15} /></button>
        </div>
      );
      case "chat": return <div className="side-chat">{row(r.chat)}</div>;
      case "more": return <button type="button" className="history-more-chats side-more" onClick={() => onOpenSpace(r.space.id, "chats")}>{r.rest} more in {r.space.name}</button>;
      case "none": return <button type="button" className="history-more-chats side-more" onClick={() => onNewChat(r.space.id)}>Start a chat</button>;
    }
  };
  if (!spaces.length) return (
    <div className="sidebar-history" ref={box}>
      <div className="history-group"><div className="history-label"><span>Subjects and projects</span></div>
        <p className="history-empty">Every chat lives in a subject or project. Make one to start.</p>
        <div className="side-create"><button type="button" className="history-more-chats" onClick={() => onCreate("subject")}>New subject</button><button type="button" className="history-more-chats" onClick={() => onCreate("project")}>New project</button></div>
      </div>
    </div>
  );
  const items = virtual.getVirtualItems();
  return (
    <div className="sidebar-history" ref={box}>
      <section className="history-group side-tree" aria-label="Subjects and projects">
        {rows.length > VIRTUAL_FROM
          ? <div style={{ height: virtual.getTotalSize(), position: "relative" }}>{items.map((i) => <div key={i.key} data-index={i.index} ref={virtual.measureElement} className="side-vrow" style={{ transform: `translateY(${i.start}px)` }}>{draw(rows[i.index])}</div>)}</div>
          : rows.map((r) => <div key={r.key} className="side-vrow-static">{draw(r)}</div>)}
      </section>
    </div>
  );
}
