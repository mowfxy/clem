import { useEffect, useMemo, useState } from 'react';
import { desktop } from '../desktop/bridge';
import { lineDiff, hunks, diffStats, applyEdit } from '../../core/diff';
import type { EditOutcome } from '../../core/types';
import { Icon } from '../Icons';

export type EditBlock = { path: string; find?: string; replace?: string; content?: string; summary?: string };
/** Sent on the window when Clem changes a linked file (an approved change or an Undo), so open proposals read it again. */
export const FOLDER_FILE_CHANGED = 'clem:folder-file-changed';

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

/** A proposed change to a file in a linked folder. Nothing is written until the person approves, and only to the file
 *  as it was shown: if it changed in the meantime, the change is refused and shown again against the new file. */
export function EditProposal({ block, streaming, scope, outcome, onDecide, onUndo }: { block: EditBlock; streaming: boolean; scope?: string; outcome?: EditOutcome; onDecide: (approve: boolean, base?: string | null) => Promise<void>; onUndo: (outcome: EditOutcome) => Promise<void> }) {
  const [current, setCurrent] = useState<{ text: string; base: string | null } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (streaming || !desktop || !scope || outcome) return;
    const again = () => setReads(n => n + 1);
    window.addEventListener(FOLDER_FILE_CHANGED, again);
    window.addEventListener('focus', again);
    return () => { window.removeEventListener(FOLDER_FILE_CHANGED, again); window.removeEventListener('focus', again); };
  }, [streaming, scope, outcome]);
  useEffect(() => {
    if (streaming || !desktop || !scope || outcome) return;
    let live = true;
    void desktop.invoke({ action: 'folderFileRead', scope, path: block.path, create: block.content !== undefined })
      .then(async (r: { text: string; exists?: boolean }) => { const base = r.exists === false ? null : await sha256(r.text); if (live) setCurrent({ text: r.text, base }); })
      .catch(e => { if (live) setCurrent({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); });
    return () => { live = false; };
  }, [streaming, scope, block.path, block.content, outcome?.status, reads]);
  const diff = useMemo(() => {
    if (!current || 'error' in current) return null;
    try { return lineDiff(current.text, applyEdit(current.text, block)); } catch (e) { return { error: (e as Error).message }; }
  }, [current, block]);
  const lines = diff && !('error' in diff) ? diff : null, stats = lines ? diffStats(lines) : null;
  const problem = current && 'error' in current ? current.error : diff && 'error' in diff ? diff.error : '';
  const decide = async (approve: boolean) => { setBusy(true); try { await onDecide(approve, current && 'base' in current ? current.base : undefined); } finally { setBusy(false); setReads(n => n + 1); } };
  const name = block.path.split(/[\\/]/).pop();
  return <div className={`edit-proposal ${outcome?.status || ''}`}>
    <header>
      <Icon name="files" size={16} />
      <div><strong aria-description={block.path}>{name}</strong><small>{block.summary || block.path}</small></div>
      {stats && !outcome && <span className="edit-stats"><b>+{stats.added}</b> <i>−{stats.removed}</i></span>}
      {outcome?.status === 'applied' && <span className="edit-state">Applied</span>}
      {outcome?.status === 'undone' && <span className="edit-state">Undone</span>}
      {outcome?.status === 'dismissed' && <span className="edit-state">Dismissed</span>}
      {lines && !outcome && <button type="button" className="edit-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="down" size={13} /></button>}
    </header>
    {!outcome && open && lines && <div className="edit-diff" role="table" aria-label={`Changes to ${name}`}>
      {hunks(lines, 2).map((l, i) => l.kind === 'gap' ? <div key={i} className="gap">⋯ {l.count} unchanged {l.count === 1 ? 'line' : 'lines'}</div> : <div key={i} className={l.kind}><span>{l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}</span><code>{l.text || ' '}</code></div>)}
    </div>}
    {!outcome && problem && <p className="edit-problem">{problem}</p>}
    {!desktop && !outcome && <p className="edit-problem">File changes are available in the desktop app.</p>}
    {outcome?.status === 'failed' && <p className="edit-problem">{outcome.error}</p>}
    {!streaming && desktop && (!outcome || outcome.status === 'applied') && <footer>
      {!outcome && <><button type="button" onClick={() => void decide(false)} disabled={busy}>Dismiss</button><button type="button" className="primary" onClick={() => void decide(true)} disabled={busy || !lines}>{busy ? 'Applying…' : 'Apply change'}</button></>}
      {outcome?.status === 'applied' && <button type="button" onClick={() => { setBusy(true); void onUndo(outcome).finally(() => setBusy(false)); }} disabled={busy}><Icon name="undo" size={15} />Undo</button>}
    </footer>}
  </div>;
}
