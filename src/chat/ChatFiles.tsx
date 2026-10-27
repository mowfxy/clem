import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icons';
import { FileGlyph } from '../files/FileGlyph';
import { sizeLabel } from '../store';
import { shortWhen } from '../ui/when';
import type { Chat, StoredFile } from '../../core/types';
import './chat-files.css';

/** A fountain-pen nib: what Clem wrote for you, drawn in the line weight of the app's other icons. */
function NibMark() {
  return <svg className="cf-nib" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M8 1.5 12.5 6 10.5 12.5H5.5L3.5 6Z" /><path d="M8 1.5V8.2" /><circle cx="8" cy="9.3" r="1.1" /><path d="M5.5 14.5h5" />
  </svg>;
}

/** The files of one chat: those the person sent in it and those Clem made in it, newest first in each. */
export function chatFiles(chat: Chat, files: StoredFile[]) {
  const byId = new Map(files.map((f) => [f.id, f]));
  const sent: StoredFile[] = [], made: StoredFile[] = [], seen = new Set<string>();
  const put = (f: StoredFile | undefined, mine: boolean) => { if (!f || seen.has(f.id)) return; seen.add(f.id); (mine && !f.made ? sent : made).push(f); };
  for (const m of chat.messages) for (const id of m.attachments || []) put(byId.get(id), m.role === 'user');
  for (const f of files) if (f.chatId === chat.id) put(f, !f.made);
  const newest = (a: StoredFile, b: StoredFile) => (b.updated || b.created) - (a.updated || a.created);
  return { sent: sent.sort(newest), made: made.sort(newest) };
}

/**
 * The chat's files button, top right of the conversation: a count of what was sent and made here, and a card that grows
 * out of the button listing them, each one to open or download.
 */
export function ChatFiles({ chat, files, onOpen, onDownload }: { chat: Chat; files: StoredFile[]; onOpen: (file: StoredFile) => void; onDownload: (file: StoredFile) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const { sent, made } = useMemo(() => chatFiles(chat, files), [chat, files]);
  const count = sent.length + made.length;
  useEffect(() => { setOpen(false); }, [chat.id]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const row = (f: StoredFile) => <li key={f.id}>
    <button type="button" className="cf-open" onClick={() => { setOpen(false); onOpen(f); }}>
      <FileGlyph file={f} size={30} />
      <span><strong>{f.name}</strong><small>{[sizeLabel(f.size), shortWhen(f.updated || f.created)].filter(Boolean).join(' · ')}</small></span>
    </button>
    <button type="button" className="icon-button cf-download" aria-label={`Download ${f.name}`} title="Download" onClick={() => onDownload(f)}><Icon name="download" size={16} /></button>
  </li>;
  return <div className="chat-files" ref={root}>
    <button ref={button} type="button" className={`icon-button chat-files-button ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`Files in this chat${count ? `, ${count}` : ''}`} title="Files in this chat" onClick={() => setOpen(!open)}>
      <Icon name="files" size={18} />
      {count > 0 && <span className="cf-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
    {open && <div className="cf-card" role="dialog" aria-label="Files in this chat">
      <header><strong>Files in this chat</strong><span>{count ? `${count} file${count === 1 ? '' : 's'}` : ''}</span></header>
      {!count && <p className="cf-empty">Files you send here and files Clem makes here show up in this list.</p>}
      {made.length > 0 && <section><h3><NibMark />Made by Clem<span>{made.length}</span></h3><ul>{made.map(row)}</ul></section>}
      {sent.length > 0 && <section><h3><Icon name="attach" size={13} />Sent by you<span>{sent.length}</span></h3><ul>{sent.map(row)}</ul></section>}
    </div>}
  </div>;
}
