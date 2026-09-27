import { useState } from 'react';
import { desktop } from '../desktop/bridge';
import type { EditOutcome } from '../../core/types';
import { describeSchedule, type AutomationBlock } from '../LocalAutomations';
import { Icon } from '../Icons';

/** A routine proposed in a chat. Nothing is scheduled until the person presses Schedule. */
export function AutomationProposal({ block, streaming, outcome, onDecide }: { block: AutomationBlock; streaming: boolean; outcome?: EditOutcome; onDecide: (approve: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => { setBusy(true); try { await onDecide(approve); } finally { setBusy(false); } };
  return <div className={`edit-proposal automation-proposal ${outcome?.status || ''}`}>
    <header>
      <Icon name="clock" size={16} />
      <div><strong>{block.name}</strong><small>{describeSchedule(block)}</small></div>
      {outcome?.status === 'applied' && <span className="edit-state">Scheduled</span>}
      {outcome?.status === 'dismissed' && <span className="edit-state">Dismissed</span>}
    </header>
    {!outcome && <p className="automation-prompt">{block.prompt}</p>}
    {!desktop && !outcome && <p className="edit-problem">Routines run in the desktop app.</p>}
    {!streaming && desktop && !outcome && <footer>
      <button type="button" onClick={() => void decide(false)} disabled={busy}>Dismiss</button>
      <button type="button" className="primary" onClick={() => void decide(true)} disabled={busy}>Schedule</button>
    </footer>}
  </div>;
}
