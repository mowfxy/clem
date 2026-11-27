import { useEffect, useRef, useState } from 'react';
import type { Reaction } from '../../core/types';
import { CHAT_REACTIONS, PERSON, groups, label } from '../../core/reactions';
import './reactions.css';

const LONG_PRESS_MS = 450;

function SmileGlyph() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="10" r="6.5" /><path d="M6.6 11.6c.6.9 1.4 1.4 2.4 1.4s1.8-.5 2.4-1.4" /><circle cx="7" cy="8.4" r=".6" fill="currentColor" stroke="none" /><circle cx="11" cy="8.4" r=".6" fill="currentColor" stroke="none" /><path d="M16.5 2.5v4M14.5 4.5h4" /></svg>;
}

/**
 * The reactions under a message in any chat (main thread, subject and project chats): chips grouped by emoji, and a
 * small button (shown on hover, focus, or a long press on touch) that opens the picker. One tap reacts; tapping a chip
 * you gave removes it.
 */
export function ChatReactions({ reactions, onToggle, side }: { reactions?: Reaction[]; onToggle: (emoji: string) => void; side: 'user' | 'assistant' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.cr-add')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  // Long press on the message itself (touch) opens the picker.
  useEffect(() => {
    const message = root.current?.closest('.message');
    if (!message) return;
    let timer = 0;
    const down = (e: Event) => { if ((e as PointerEvent).pointerType !== 'touch') return; timer = window.setTimeout(() => setOpen(true), LONG_PRESS_MS); };
    const cancel = () => clearTimeout(timer);
    message.addEventListener('pointerdown', down); message.addEventListener('pointerup', cancel); message.addEventListener('pointercancel', cancel); message.addEventListener('pointermove', cancel);
    return () => { cancel(); message.removeEventListener('pointerdown', down); message.removeEventListener('pointerup', cancel); message.removeEventListener('pointercancel', cancel); message.removeEventListener('pointermove', cancel); };
  }, []);
  const shown = groups(reactions);
  return <div className={`chat-reactions ${side}${shown.length ? ' has' : ''}`} ref={root}>
    {shown.map(({ emoji, by }) => {
      const mine = by.includes(PERSON);
      return <button key={emoji} type="button" className={`cr-chip${mine ? ' mine' : ''}`} aria-pressed={mine} aria-label={label(emoji, by)} title={label(emoji, by)} onClick={() => onToggle(emoji)}>
        <span className="cr-emoji">{emoji}</span>{by.length > 1 && <span className="cr-n">{by.length}</span>}
      </button>;
    })}
    <button type="button" className="cr-add" aria-label="React" aria-expanded={open} onClick={() => setOpen(!open)}><SmileGlyph /></button>
    {open && <div className="cr-pick" role="menu" aria-label="Reactions">
      {CHAT_REACTIONS.map((e) => <button key={e} type="button" role="menuitem" aria-label={e} className={(reactions || []).some((r) => r.by === PERSON && r.emoji === e) ? 'on' : ''} onClick={() => { onToggle(e); setOpen(false); }}>{e}</button>)}
    </div>}
  </div>;
}
