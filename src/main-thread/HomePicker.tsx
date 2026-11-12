// Home's quick picker (docs/MAIN-THREAD.md "Home to thread"): a quiet row under the box of the subjects and projects
// used last, and Find (Ctrl J) to type any of them, the @-mention list's fuzzy match and look. One tap or Enter opens a
// new chat in it at once.
import { useEffect, useMemo, useRef, useState } from "react";
import { pickSpaces } from "../../core/main-thread/home";
import type { Chat, Space } from "../../core/types";
import { Icon } from "../Icons";

export function HomePicker({ spaces, chats, onPick, openSignal = 0, onOpened }: { spaces: Space[]; chats: Chat[]; onPick: (spaceId: string) => void; /** Set by Ctrl J: opens Find, then `onOpened` clears it. */ openSignal?: number; onOpened?: () => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null), wrap = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => pickSpaces(spaces, chats, "", 3), [spaces, chats]);
  const found = useMemo(() => (open ? pickSpaces(spaces, chats, query, 8) : []), [open, spaces, chats, query]);
  useEffect(() => { if (openSignal) { setOpen(true); setQuery(""); setAt(0); onOpened?.(); } }, [openSignal]);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  if (!spaces.length) return null;
  const pick = (s?: Space) => { if (!s) return; setOpen(false); onPick(s.id); };
  return <div className="home-pick" ref={wrap} role="group" aria-label="New chat in a subject or project">
    <span className="home-pick-label">New chat in</span>
    {recent.map((s) => <button type="button" key={s.id} className="home-pick-chip" onClick={() => pick(s)}>
      <Icon name={s.kind === "project" ? "projects" : "subjects"} size={13} /><span>{s.name}</span>
    </button>)}
    <button type="button" className="home-pick-chip home-pick-find" aria-expanded={open} aria-keyshortcuts="Control+J" onClick={() => { setOpen(!open); setQuery(""); setAt(0); }}>
      <Icon name="search" size={13} /><span>Find</span><kbd>Ctrl J</kbd>
    </button>
    {open && <div className="slash-menu mention-menu home-pick-menu">
      <input ref={input} className="home-pick-input" value={query} placeholder="Type a subject or project" aria-label="Find a subject or project" role="combobox" aria-expanded="true" aria-controls="home-pick-list"
        aria-activedescendant={found[at] ? "home-pick-" + found[at].id : undefined}
        onChange={(e) => { setQuery(e.target.value); setAt(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (found.length) setAt((at + (e.key === "ArrowDown" ? 1 : -1) + found.length) % found.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(found[at]); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }} />
      <div role="listbox" id="home-pick-list" aria-label="Subjects and projects">
        {found.length ? found.map((s, i) => <button type="button" role="option" id={"home-pick-" + s.id} key={s.id} aria-selected={i === at} className={i === at ? "on" : ""}
          ref={i === at ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
          onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setAt(i)}>
          <Icon name={s.kind === "project" ? "projects" : "subjects"} size={16} />
          <span className="slash-name">{s.name}</span>
          <span className="slash-desc">{s.kind === "project" ? "Project" : "Subject"}</span>
        </button>) : <p className="home-pick-none">No subject or project matches.</p>}
      </div>
    </div>}
  </div>;
}
