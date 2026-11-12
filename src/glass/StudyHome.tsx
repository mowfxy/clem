import { useMemo, useState } from 'react';
import type { Chat, Space, StudySet } from '../../core/types';
import { dayLabel, localDay, type SpacePlan } from '../../core/plans';
import { dueBySubject } from '../../core/study-due';
import { Icon } from '../Icons';
import { shortWhen } from '../ui/when';
import type { SpaceTab } from '../space/SpacePage';

/** The study widgets under the composer on the home screen. Everything here is counted from the person's own chats,
 *  subjects, cards and plans; a widget with nothing to show says what would fill it. */
const WEEKS = 26;
const dayKey = (t: number) => localDay(t);
const level = (n: number) => (n === 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 11 ? 3 : 4);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function Widget({ title, icon, className = '', children }: { title: string; icon: string; className?: string; children: React.ReactNode }) {
  return <section className={`sw ${className}`} aria-label={title}>
    <h2 className="sw-title"><Icon name={icon} size={15} />{title}</h2>
    {children}
  </section>;
}

function activity(chats: Chat[], now: number) {
  const days = new Map<string, number>();
  for (const chat of chats) {
    const asked = chat.messages.filter((m) => m.role === 'user');
    asked.forEach((m, i) => { const at = m.at ?? (i === 0 ? chat.updated : undefined); if (at) days.set(dayKey(at), (days.get(dayKey(at)) || 0) + 1); });
  }
  const today = new Date(now), end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // The grid ends on this week's Sunday; its columns are whole weeks, Monday at the top.
  end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1));
  const cells: { key: string; label: string; count: number; future: boolean }[] = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i), key = dayKey(d.getTime()), count = days.get(key) || 0;
    cells.push({ key, count, future: d.getTime() > now, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  let streak = 0;
  for (let i = 0; ; i++) { const n = days.get(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime())); if (n) streak++; else if (i) break; }
  const shown = cells.filter((c) => !c.future), total = shown.reduce((n, c) => n + c.count, 0), active = shown.filter((c) => c.count).length;
  const month = (key: string) => new Date(key + 'T12:00').toLocaleDateString(undefined, { month: 'short' });
  return { cells, total, active, streak, range: `${month(cells[0].key)} – ${month(cells[cells.length - 1].key)}` };
}

type Cell = ReturnType<typeof activity>['cells'][number];

/** The activity grid. Hovering a day shows its count in the app's own floating glass, not the system tooltip. */
function Heat({ cells, label }: { cells: Cell[]; label: string }) {
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number; side: 'start' | 'mid' | 'end' } | null>(null);
  const columns = Math.ceil(cells.length / 7);
  const show = (el: HTMLElement, i: number) => {
    const cell = cells[i];
    if (!cell || cell.future) return setTip(null);
    const col = Math.floor(i / 7);
    setTip({ cell, x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop, side: col < 3 ? 'start' : col > columns - 4 ? 'end' : 'mid' });
  };
  return <div className="sw-heat" role="img" aria-label={label} onPointerLeave={() => setTip(null)}>
    {cells.map((c, i) => <i key={c.key} data-level={level(c.count)} data-future={c.future || undefined} data-on={tip?.cell.key === c.key || undefined}
      onPointerEnter={(e) => show(e.currentTarget, i)} />)}
    {tip && <span key={tip.cell.key} className="sw-tip" data-side={tip.side} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <b>{tip.cell.label}</b>{plural(tip.cell.count, 'question')}
    </span>}
  </div>;
}

function Delta({ now, before }: { now: number; before: number }) {
  const d = now - before;
  return d ? <small className={d > 0 ? 'up' : 'down'}>{d > 0 ? '+' : '−'}{Math.abs(d)}</small> : null;
}

export function StudyHome({ chats, spaces, studySets, plans, onChat, onSpace, onSubjects, onSearch }: {
  chats: Chat[]; spaces: Space[]; studySets: StudySet[]; plans: SpacePlan[];
  onChat: (chat: Chat) => void; onSpace: (id: string, tab?: SpaceTab) => void; onSubjects: () => void; onSearch: () => void;
}) {
  const data = useMemo(() => {
    const now = Date.now(), today = localDay(now), date = new Date(now);
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime(), lastStart = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    const inMonth = (t: number) => t >= monthStart, inLast = (t: number) => t >= lastStart && t < monthStart;
    const started = (c: Chat) => c.messages[0]?.at ?? c.updated;
    const attempts = studySets.flatMap((s) => s.attempts || []);
    const answers = (test: (t: number) => boolean) => attempts.filter((a) => test(a.at)).reduce((n, a) => n + a.total, 0);
    const due = dueBySubject({ spaces, studySets }, now);
    const exam = spaces.filter((s) => s.kind === 'subject' && s.examDate && s.examDate >= today).sort((a, b) => a.examDate!.localeCompare(b.examDate!))[0];
    const tasks = plans.flatMap((plan) => {
      const space = spaces.find((s) => s.id === plan.spaceId);
      return space ? plan.tasks.filter((t) => !t.done && t.kind !== 'milestone').map((task) => ({ task, space })) : [];
    }).sort((a, b) => (a.task.due || '9999').localeCompare(b.task.due || '9999'));
    return {
      today, days: exam ? Math.round((new Date(exam.examDate + 'T12:00').getTime() - new Date(today + 'T12:00').getTime()) / 864e5) : 0, exam,
      examDue: exam ? due.find((d) => d.spaceId === exam.id)?.due || 0 : 0, totalDue: due.reduce((n, d) => n + d.due, 0), tasks,
      activity: activity(chats, now), recent: [...chats].sort((a, b) => b.updated - a.updated),
      chatsNow: chats.filter((c) => inMonth(started(c))).length, chatsBefore: chats.filter((c) => inLast(started(c))).length,
      answersNow: answers(inMonth), answersBefore: answers(inLast),
    };
  }, [chats, spaces, studySets, plans]);
  const a = data.activity;
  return <div className="study-home">
    <Widget title="Study activity" icon="analysis" className="sw-activity">
      <Heat cells={a.cells} label={`${plural(a.total, 'question')} on ${plural(a.active, 'day')} since ${a.range.split(' ')[0]}`} />
      <p className="sw-foot"><span>{plural(a.active, 'day')} · {plural(a.total, 'question')}{a.streak > 1 ? ` · ${a.streak} day streak` : ''}</span><span>{a.range}</span></p>
    </Widget>
    <Widget title="Recent chats" icon="chat" className="sw-recent">
      {data.recent.length ? <ul className="sw-list">
        {data.recent.slice(0, 3).map((chat) => <li key={chat.id}><button type="button" onClick={() => onChat(chat)}>
          <b>{chat.title || 'Conversation'}</b>
          <span>{shortWhen(chat.updated)}{chat.spaceId ? ` · ${spaces.find((s) => s.id === chat.spaceId)?.name || ''}` : ''}</span>
        </button></li>)}
      </ul> : <p className="sw-empty">Your conversations will gather here.</p>}
      {data.recent.length > 3 && <button type="button" className="sw-more" onClick={onSearch}>{data.recent.length - 3} more</button>}
    </Widget>
    <Widget title="Next exam" icon="clock" className="sw-exam">
      {data.exam ? <button type="button" className="sw-big" onClick={() => onSpace(data.exam!.id)}>
        <strong>{data.days === 0 ? 'Today' : data.days === 1 ? 'Tomorrow' : `${data.days} days`}</strong>
        <span>{data.exam.name}</span>
        <small>{data.examDue ? `${plural(data.examDue, 'card')} to review` : dayLabel(data.exam.examDate!, data.today)}</small>
      </button> : <p className="sw-empty">No exam dates yet. <button type="button" onClick={onSubjects}>Add one to a subject</button></p>}
    </Widget>
    <Widget title="Up next" icon="check" className="sw-next">
      {data.tasks.length ? <ul className="sw-list">
        {data.tasks.slice(0, 3).map(({ task, space }) => <li key={task.id}><button type="button" onClick={() => onSpace(space.id, 'plan')}>
          <b>{task.title}</b>
          <span><em data-late={task.due && task.due < data.today ? true : undefined}>{task.due ? dayLabel(task.due, data.today) : 'No date'}</em> · {space.name}</span>
        </button></li>)}
      </ul> : <p className="sw-empty">Nothing planned. <button type="button" onClick={onSubjects}>Plan a subject</button></p>}
      {data.tasks.length > 3 && <span className="sw-more">{data.tasks.length - 3} more</span>}
    </Widget>
    <Widget title="This month" icon="grid" className="sw-month">
      <dl>
        <div><dt>Chats</dt><dd><b>{data.chatsNow}</b><Delta now={data.chatsNow} before={data.chatsBefore} /></dd></div>
        <div><dt>Quiz answers</dt><dd><b>{data.answersNow}</b><Delta now={data.answersNow} before={data.answersBefore} /></dd></div>
        <div><dt>Cards due</dt><dd><b>{data.totalDue}</b></dd></div>
      </dl>
    </Widget>
  </div>;
}
