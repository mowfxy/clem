import { Icon } from '../Icons';

/** What a reply stopped by the plan's usage limit keeps: when the plan resets, and whether Mowr carries on by itself then. */
export type LimitState = { at: number; resetsAt?: number; auto?: boolean; done?: boolean };

/** When to continue: the provider's reset time, or an hour after the limit when it does not say. */
export const resumeTime = (limit: LimitState) => limit.resetsAt ?? limit.at + 60 * 60_000;

function when(ms: number) {
  const date = new Date(ms), today = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return 'at ' + time;
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (date.toDateString() === tomorrow.toDateString()) return 'tomorrow at ' + time;
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + ' at ' + time;
}

/**
 * Shown instead of files when the AI's plan ran out mid-task: the unfinished files are held back, and the person
 * can have the task continue on its own once the limit resets.
 */
export function LimitNotice({ limit, model, latest, onAuto, onContinue }: { limit: LimitState; model: string; /** The chat's last message: only then can the task continue from it. */ latest: boolean; onAuto: (on: boolean) => void; onContinue: () => void }) {
  const resets = limit.resetsAt ? `It resets ${when(limit.resetsAt)}.` : 'The reset time was not shared; Mowr will try again in about an hour.';
  return <div className="limit-notice" role="note">
    <p className="limit-head"><Icon name="clock" size={15} />{model} usage limit reached</p>
    <p className="limit-body">The task stopped before it finished, so the files it was working on were not sent. {resets}</p>
    {limit.done
      ? <p className="limit-foot">Continued below.</p>
      : latest && <div className="limit-actions">
          <label className="limit-auto">
            <input type="checkbox" checked={!!limit.auto} onChange={(e) => onAuto(e.target.checked)} />
            <span>Continue this task automatically when the limit resets</span>
          </label>
          {limit.auto && <span className="limit-foot">Mowr will continue {when(resumeTime(limit))}.</span>}
          <button type="button" className="limit-now" onClick={onContinue}>Continue now</button>
        </div>}
  </div>;
}
