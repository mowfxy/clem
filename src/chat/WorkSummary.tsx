import { useState } from 'react';
import { Icon } from '../Icons';
import { workTime } from '../../core/chat-title';
import { MessageBody, type BodyHandlers } from './MessageBody';

/**
 * A finished reply that used tools: "Task completed in 2m 14s" above the answer. The notes the AI wrote while it
 * worked (shown live as it went) fold under it, one click away.
 */
export function WorkSummary({ work, handlers }: { work: { ms: number; notes?: string }; handlers?: BodyHandlers }) {
  const [open, setOpen] = useState(false);
  const label = `Task completed in ${workTime(work.ms)}`;
  if (!work.notes) return <p className="work-summary">{label}</p>;
  return <div className="work-summary-wrap">
    <button type="button" className="work-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
      {label}<Icon name="down" size={12} />
    </button>
    {open && <div className="work-notes"><MessageBody content={work.notes} streaming={false} handlers={handlers} /></div>}
  </div>;
}
