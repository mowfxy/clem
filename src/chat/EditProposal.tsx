import { useEffect, useMemo, useState } from 'react';
import { desktop } from '../desktop/bridge';
import { lineDiff, hunks, diffStats, applyEdit } from '../../core/diff';
import type { EditOutcome } from '../../core/types';
import { Icon } from '../Icons';

export type EditBlock = { path: string; find?: string; replace?: string; content?: string; summary?: string };

/** A proposed change to a file in a linked folder. Nothing is written until the person approves. */
export function EditProposal({ block, streaming, scope, outcome, onDecide, onUndo }: { block: EditBlock; streaming: boolean; scope?: string; outcome?: EditOutcome; onDecide: (approve: boolean) => Promise<void>; onUndo: (outcome: EditOutcome) => Promise<void> }) {
  const [current, setCurrent] = useState<{ text: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (streaming || !desktop || !scope || outcome) return;
    let live = true;
    void desktop.invoke({ action: 'folderFileRead', scope, path: block.path }).then(r => { if (live) setCurrent({ text: r.text }); }).catch(e => { if (live) setCurrent({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); });
    return () => { live = false; };
  }, [streaming, scope, block.path, outcome?.status]);
  const diff = useMemo(() => {
    if (!current || 'error' in current) return null;
    try { return lineDiff(current.text, applyEdit(current.text, block)); } catch (e) { return { error: (e as Error).message }; }
  }, [current, block]);
  const lines = diff && !('error' in diff) ? diff : null, stats = lines ? diffStats(lines) : null;
  const problem = current && 'error' in current ? current.error : diff && 'error' in diff ? diff.error : '';
  const decide = async (approve: boolean) => { setBusy(true); try { await onDecide(approve); } finally { setBusy(false); } };
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
