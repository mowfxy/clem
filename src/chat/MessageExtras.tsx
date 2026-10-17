import { parseModelJson } from '../../core/model-json';
import { useEffect, useRef, useState } from 'react';
import type { Model, Review, Verification } from '../../core/types';
import type { Citation } from '../../core/citations';
import { Icon } from '../Icons';
import { MessageBody } from './MessageBody';
import { copyText } from '../clipboard';

/** Picks a reviewer: another provider first, then another model, then the same one. */
export function reviewerFor(models: Model[], current: string) {
  const connected = models.filter(m => m.connected), mine = connected.find(m => m.id === current);
  const ranked = [...connected].sort((a, b) => Number(b.provider !== mine?.provider) - Number(a.provider !== mine?.provider) || Number(b.id !== current) - Number(a.id !== current) || Number(!!b.isDefault) - Number(!!a.isDefault));
  return ranked;
}

/** A title for an exported answer: its first heading, else the chat title. */
export function exportTitle(content: string, fallback: string) {
  const heading = /^#{1,2}\s+(.+)$/m.exec(content)?.[1];
  return (heading || fallback || 'Mowr document').replace(/[*_`#]/g, '').trim().slice(0, 120);
}

export function MessageTools({ content, models, model, onReview, onVerify, canVerify, busy, title = '', onExport, at }: { at?: number; content: string; models: Model[]; model?: string; onReview: (model: string) => void; onVerify?: () => void; canVerify: boolean; busy: boolean; title?: string; onExport?: (format: 'pdf' | 'docx' | 'pptx', content: string, title: string) => Promise<void> }) {
  const [copied, setCopied] = useState(false), [menu, setMenu] = useState(false), [exporting, setExporting] = useState<'menu' | 'pdf' | 'docx' | 'pptx' | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Menus open upward when the answer sits low in the window, so they are never hidden under the composer.
  const [up, setUp] = useState(false);
  const place = () => { const r = wrap.current?.getBoundingClientRect(); setUp(!!r && r.bottom > innerHeight - 320 && r.top > 300); };
  useEffect(() => { if (!menu && exporting !== 'menu') return; const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) { setMenu(false); setExporting(x => x === 'menu' ? null : x); } }; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setExporting(x => x === 'menu' ? null : x); } }; addEventListener('mousedown', close); addEventListener('keydown', esc); return () => { removeEventListener('mousedown', close); removeEventListener('keydown', esc); }; }, [menu, exporting]);
  const exportAs = async (format: 'pdf' | 'docx' | 'pptx') => { setExporting(format); try { await onExport?.(format, content, exportTitle(content, title)); } finally { setExporting(null); } };
  const reviewers = reviewerFor(models, model || '');
  const plain = content.replace(/```(?:visual|check|edit)[\s\S]*?(?:```|$)/g, '').trim();
  return <div className="message-tools" ref={wrap}>
    <button type="button" aria-label={copied ? 'Copied' : 'Copy answer'} aria-description="Copy" onClick={() => void copyText(plain).then(ok => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1400); })}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
    {reviewers.length > 0 && <button type="button" aria-label="Second opinion" aria-description="Second opinion" aria-expanded={menu} disabled={busy} onClick={() => { place(); setMenu(!menu); }}><Icon name="compare" size={16} /><span>Second opinion</span></button>}
    {canVerify && onVerify && <button type="button" aria-label="Check against sources" aria-description="Check against your sources" disabled={busy} onClick={onVerify}><Icon name="verify" size={16} /><span>Check sources</span></button>}
    {onExport && <button type="button" aria-label="Export" aria-description="Export as a document" aria-expanded={exporting === 'menu'} disabled={busy || (!!exporting && exporting !== 'menu')} onClick={() => { place(); setMenu(false); setExporting(exporting === 'menu' ? null : 'menu'); }}><Icon name="download" size={16} /><span>{exporting && exporting !== 'menu' ? 'Exporting…' : 'Export'}</span></button>}
    {exporting === 'menu' && <div className={'review-menu export-menu' + (up ? ' up' : '')} role="menu">
      <p>Save this answer as a formatted document</p>
      <button role="menuitem" onClick={() => void exportAs('pdf')}><span>PDF document</span><small>Typeset, A4</small></button>
      <button role="menuitem" onClick={() => void exportAs('docx')}><span>Word document</span><small>Editable .docx</small></button>
      <button role="menuitem" onClick={() => void exportAs('pptx')}><span>PowerPoint</span><small>One slide per ## heading</small></button>
    </div>}
    {menu && <div className={'review-menu' + (up ? ' up' : '')} role="menu">
      <p>Ask another model to review this answer</p>
      {reviewers.slice(0, 6).map((m, i) => <button key={m.id} role="menuitem" onClick={() => { setMenu(false); onReview(m.id); }}><span>{m.name}</span>{i === 0 && <small>{m.provider !== models.find(x => x.id === model)?.provider ? 'Different provider' : m.id !== model ? 'Different model' : 'Fresh context'}</small>}</button>)}
    </div>}
    <MessageTime at={at} />
  </div>;
}

const verdictOf = (text: string) => /^\W*disagree/i.test(text) ? 'disagree' : /^\W*mostly agree/i.test(text) ? 'mostly' : /^\W*agree/i.test(text) ? 'agree' : '';

export function ReviewPanel({ review, models }: { review: Review; models: Model[] }) {
  const name = models.find(m => m.id === review.model)?.name || review.model.replace(/^claude:/, 'Claude ').replace(/^grok:/, '');
  const verdict = verdictOf(review.content);
  return <aside className={`review-panel ${verdict}`} aria-label={`Second opinion from ${name}`}>
    <header><Icon name="compare" size={15} /><span>Second opinion</span><small>{name}</small>{review.status === 'running' && <span className="review-live" aria-label="Reviewing" />}</header>
    {review.content ? <MessageBody content={review.content} streaming={review.status === 'running'} /> : review.status === 'running' ? <p className="review-wait">Reading the answer…</p> : null}
    {review.status === 'error' && !review.content && <p className="review-wait">The review could not finish.</p>}
  </aside>;
}

export function VerifyPanel({ verify, onCite, canCite }: { verify: Verification; onCite: (c: Citation) => void; canCite: (c: Citation) => boolean }) {
  if (verify.status === 'running') return <aside className="verify-panel"><header><Icon name="verify" size={15} /><span>Checking against your sources</span><span className="review-live" /></header></aside>;
  if (verify.status === 'error') return <aside className="verify-panel"><header><Icon name="verify" size={15} /><span>Source check</span></header><p className="review-wait">{verify.error || 'The check could not finish.'}</p></aside>;
  return <VerifyResult verify={verify} onCite={onCite} canCite={canCite} />;
}

/** Folded by default to one line with a dot per claim; the chevron at top left opens the details. */
function VerifyResult({ verify, onCite, canCite }: { verify: Verification; onCite: (c: Citation) => void; canCite: (c: Citation) => boolean }) {
  const [open, setOpen] = useState(false);
  const claims = verify.claims || [], supported = claims.filter(c => c.status === 'supported').length;
  return <aside className={`verify-panel ${open ? 'open' : 'folded'}`} aria-label="Source check">
    <header><button type="button" className="verify-toggle" aria-expanded={open} aria-label={open ? 'Collapse source check' : 'Expand source check'} onClick={() => setOpen(!open)}><Icon name="down" size={14} /></button><Icon name="verify" size={15} /><span>Source check</span>{!open && <span className="verify-dots" aria-hidden="true">{claims.map((c, i) => <span key={i} className={'verify-dot ' + c.status} />)}</span>}<small>{supported} of {claims.length} claims supported</small></header>
    {open && <ul>{claims.map((c, i) => {
      const cite = c.source ? { name: c.source, page: c.page ?? undefined } : null;
      return <li key={i} className={c.status}>
        <span className="verify-dot" aria-label={c.status} />
        <div><p>{c.claim}</p>{c.quote && <q>{c.quote}</q>}{cite && <button type="button" className={`cite ${canCite(cite) ? '' : 'unavailable'}`} onClick={() => canCite(cite) && onCite(cite)}><Icon name="files" size={12} /><span>{cite.name}{cite.page ? ` · p. ${cite.page}` : ''}</span></button>}</div>
        <small>{c.status === 'supported' ? 'Supported' : c.status === 'partial' ? 'Partly' : 'Not in sources'}</small>
      </li>;
    })}</ul>}
  </aside>;
}

export function parseClaims(raw: string) {
  const data = parseModelJson(raw, 'The source check returned no claims.');
  if (!Array.isArray(data.claims)) throw Error('The source check returned no claims.');
  return data.claims.slice(0, 12).filter((c: any) => typeof c?.claim === 'string').map((c: any) => ({
    claim: String(c.claim).slice(0, 300),
    status: ['supported', 'partial', 'unsupported'].includes(c.status) ? c.status : 'unsupported',
    source: typeof c.source === 'string' ? c.source.slice(0, 200) : '',
    page: Number.isInteger(c.page) && c.page > 0 ? c.page : null,
    quote: typeof c.quote === 'string' ? c.quote.slice(0, 240) : '',
  }));
}

/** When a message was sent or an answer finished: the time today, else the day and time; the full date on hover. */
export function MessageTime({ at }: { at?: number }) {
  if (!at) return null;
  const when = new Date(at), today = new Date().toDateString() === when.toDateString();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = when.toLocaleDateString([], { month: 'short', day: 'numeric', ...(when.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return <time className="message-time" dateTime={when.toISOString()} title={when.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}>{today ? time : `${day}, ${time}`}</time>;
}

/** Copy, retry and edit under a message the person sent. Retry and Edit answer it again, interrupting a running answer. */
export function UserMessageTools({ content, onRetry, onEdit, at }: { content: string; onRetry: () => void; onEdit: () => void; at?: number }) {
  const [copied, setCopied] = useState(false);
  return <div className="message-tools user-tools">
    <MessageTime at={at} />
    <button type="button" aria-label={copied ? 'Copied' : 'Copy message'} aria-description="Copy" onClick={() => void copyText(content).then(ok => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1400); })}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
    <button type="button" aria-label="Retry" aria-description="Answer this again" onClick={onRetry}><Icon name="refresh" size={16} /></button>
    <button type="button" aria-label="Edit" aria-description="Edit and send again" onClick={onEdit}><Icon name="rename" size={16} /></button>
  </div>;
}

/** A sent message opened for editing; sending replaces it and everything after it with a fresh answer. */
export function UserMessageEdit({ content, onCancel, onSend }: { content: string; onCancel: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState(content);
  const field = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const f = field.current; if (f) { f.style.height = 'auto'; f.style.height = Math.min(f.scrollHeight, 360) + 'px'; } };
  useEffect(() => { const f = field.current; if (!f) return; fit(); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, []);
  const ready = !!text.trim();
  return <div className="user-edit">
    <textarea ref={field} value={text} aria-label="Edit your message" rows={1}
      onChange={e => { setText(e.target.value); fit(); }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ready) onSend(text); } }} />
    <div className="user-edit-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="send" disabled={!ready} onClick={() => onSend(text)}>Send</button>
    </div>
  </div>;
}
