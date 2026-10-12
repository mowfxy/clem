import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {confirmDialog} from '../dialogs';
import {planStatus,planSections,daysBetween,addDays,dayLabel,localDay,workItems,type SpacePlan,type PlanTask,type PlanStatus} from '../../core/plans';
import type {Space} from '../../core/types';
import './plan.css';

/** A plan Mowr proposed from the Plan tab's box, waiting for Save (create) or Replace. */
export type PlanDraftView={plan:SpacePlan;replaces?:string};
export type PlanActions={
  onToggle:(taskId:string)=>void;
  onDelete:()=>void;
  /** Sends the box's message to Mowr with the plan; resolves to Mowr's short reply. */
  onAsk:(text:string,history:{role:'user'|'assistant';content:string}[])=>Promise<string>;
  onSaveDraft:()=>void;
  onDiscardDraft:()=>void;
  /** Starts a chat in this space with the message ready to send. */
  onDraftChat:(text:string)=>void;
};

const STATE_LABEL=(s:PlanStatus,today:string)=>s.state==='done'?'Complete':s.state==='behind'?`Behind · ${s.overdue.length} overdue`:s.state==='ahead'?'Ahead of plan':s.state==='upcoming'?`Starts ${dayLabel(s.start,today)}`:'On track';
const plural=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`;
/** How far the work done is from the work planned by today, in words. */
function paceLine(s:PlanStatus){
  if(s.state==='done')return 'Every task is done.';
  const gap=s.done-s.expected;
  if(s.state==='upcoming')return `Nothing is due yet. ${plural(s.total,'task')} planned.`;
  if(gap<0)return `${plural(-gap,'task')} behind the plan${s.overdue.length?`, ${s.overdue.length} overdue`:''}.`;
  if(gap>0)return `${plural(gap,'task')} ahead of the plan.`;
  return 'Right on pace with the plan.';
}

/** The plan over time: the work planned by each day (dashed) against the work done (solid), today, and the milestones. */
export function PlanChart({plan,today=localDay(),compact=false}:{plan:SpacePlan;today?:string;compact?:boolean}){
  const s=planStatus(plan,today),work=workItems(plan);
  const span=Math.max(1,daysBetween(s.start,s.end));
  const step=span>140?7:span>60?2:1;
  const W=600,H=compact?92:150,top=compact?10:18,bottom=H-(compact?8:14);
  const x=(day:string)=>Math.max(0,Math.min(1,daysBetween(s.start,day)/span))*W;
  const max=Math.max(1,work.length);
  const y=(n:number)=>bottom-(n/max)*(bottom-top);
  const doneDay=(t:PlanTask)=>t.done?(()=>{const d=localDay(t.done);return d<s.start?s.start:d;})():undefined;
  const days:string[]=[];for(let i=0;i<=span;i+=step)days.push(addDays(s.start,i));if(days[days.length-1]!==s.end)days.push(s.end);
  const planned=days.map(d=>work.filter(t=>t.due&&t.due<=d).length);
  const plannedPath='M'+days.map((d,i)=>`${x(d).toFixed(1)},${y(planned[i]).toFixed(1)}`).join('L');
  const shown=today<s.start?[]:days.filter(d=>d<=today).concat(today<s.end&&today>s.start?[today]:[]);
  const done=shown.map(d=>work.filter(t=>{const dd=doneDay(t);return dd&&dd<=d;}).length);
  const donePath=shown.length?'M'+shown.map((d,i)=>`${x(d).toFixed(1)},${y(done[i]).toFixed(1)}`).join('L'):'';
  const area=shown.length?donePath+`L${x(shown[shown.length-1]).toFixed(1)},${bottom}L0,${bottom}Z`:'';
  const inRange=today>=s.start&&today<=s.end;
  const milestones=plan.tasks.filter(t=>t.kind==='milestone'&&t.due).sort((a,b)=>a.due!<b.due!?-1:1);
  // Labels for milestones only where they fit; the rest keep their marker and a tooltip.
  let last=-1;const labelled=new Set(milestones.filter(m=>{const p=x(m.due!)/W;if(p-last<.16)return false;last=p;return true;}).map(m=>m.id));
  return <div className={`pl-chart ${compact?'compact':''}`} role="img" aria-label={`${s.done} of ${s.total} done; ${s.expected} were planned by today. ${paceLine(s)}`}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {[.5,1].map(f=><line key={f} x1="0" x2={W} y1={y(max*f)} y2={y(max*f)} className="grid"/>)}
      <line x1="0" x2={W} y1={bottom} y2={bottom} className="axis"/>
      {milestones.map(m=><line key={m.id} x1={x(m.due!)} x2={x(m.due!)} y1={top-6} y2={bottom} className={`mile ${m.done?'past':''}`}/>)}
      {area&&<path d={area} className="done-area"/>}
      <path d={plannedPath} className="planned"/>
      {donePath&&<path d={donePath} className="done-line"/>}
      {inRange&&<line x1={x(today)} x2={x(today)} y1={top-6} y2={bottom} className="today"/>}
    </svg>
    {milestones.map(m=><span key={m.id} className={`pl-mile ${m.done?'past':''} ${x(m.due!)/W>.88?'end':x(m.due!)/W<.08?'start':''}`} style={{left:`${x(m.due!)/W*100}%`}} title={`${m.title} · ${dayLabel(m.due!,today)}${m.time?' '+m.time:''}`}><i/>{!compact&&labelled.has(m.id)&&<em>{m.title}</em>}</span>)}
    {inRange&&<span className="pl-today" style={{left:`${x(today)/W*100}%`}}>Today</span>}
    {shown.length>0&&<span className="pl-dot" style={{left:`${x(shown[shown.length-1])/W*100}%`,top:`${y(done[done.length-1])/H*100}%`}}/>}
    {/* The first and last days, unless "Today" stands where one of them would. */}
    {!compact&&<div className="pl-axis"><span>{inRange&&x(today)/W<.14?'':dayLabel(s.start,today)}</span><span>{inRange&&x(today)/W>.86?'':dayLabel(s.end,today)}</span></div>}
  </div>;
}

function Due({task,today}:{task:PlanTask;today:string}){
  if(!task.due)return null;
  const late=!task.done&&task.kind!=='milestone'&&task.due<today,d=daysBetween(task.due,today);
  return <span className={`pl-due ${late?'late':''} ${task.due===today&&!task.done?'now':''}`}>{late?(d===1?'1 day late':`${d} days late`):dayLabel(task.due,today)}{task.time&&!late?' · '+task.time:''}</span>;
}

function TaskRow({task,today,onToggle}:{task:PlanTask;today:string;onToggle?:(id:string)=>void}){
  const milestone=task.kind==='milestone';
  return <li className={`pl-task ${task.done?'done':''} ${milestone?'milestone':''}`}>
    {onToggle?<button type="button" className="pl-check" role="checkbox" aria-checked={!!task.done} aria-label={`${task.done?'Mark not done':'Mark done'}: ${task.title}`} onClick={()=>onToggle(task.id)}><Icon name="check" size={12}/></button>
      :<span className="pl-check" aria-hidden="true">{task.done&&<Icon name="check" size={12}/>}</span>}
    <span className="pl-task-text"><span>{task.title}</span>{task.notes&&<small>{task.notes}</small>}</span>
    <Due task={task} today={today}/>
  </li>;
}

/** Every task, in the plan's own sections (or by week). */
export function PlanTasks({plan,today=localDay(),onToggle}:{plan:SpacePlan;today?:string;onToggle?:(id:string)=>void}){
  return <div className="pl-sections">{planSections(plan).map(section=>{
    const done=section.tasks.filter(t=>t.done).length;
    return <section key={section.title} className="pl-section">
      <header><span className="sp-eyebrow">{section.title}</span><small>{done}/{section.tasks.length}</small></header>
      <ul>{section.tasks.map(t=><TaskRow key={t.id} task={t} today={today} onToggle={onToggle}/>)}</ul>
    </section>;})}
  </div>;
}

function Ring({value}:{value:number}){
  const r=19,c=2*Math.PI*r;
  return <svg className="pl-ring" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r={r} className="track"/><circle cx="23" cy="23" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c*(1-value)} transform="rotate(-90 23 23)"/></svg>;
}

/** The plan's headline: title, goal, where it stands, the chart and three numbers. */
export function PlanSummary({plan,today=localDay(),compact=false}:{plan:SpacePlan;today?:string;compact?:boolean}){
  const s=planStatus(plan,today);
  return <>
    <div className="pl-head">
      <div className="pl-head-text">
        <span className={`pl-state ${s.state}`}><i/>{STATE_LABEL(s,today)}</span>
        <h3>{plan.title}</h3>
        {plan.goal&&<p>{plan.goal}</p>}
      </div>
    </div>
    <PlanChart plan={plan} today={today} compact={compact}/>
    <div className="pl-figures">
      <div><Ring value={s.percent}/><span><b>{Math.round(s.percent*100)}% done</b><small>{s.done} of {plural(s.total,'task')}</small></span></div>
      <div><span><b>{s.nextMilestone?s.nextMilestone.title:s.next?s.next.title:'Nothing left'}</b><small>{s.nextMilestone?`Next milestone · ${dayLabel(s.nextMilestone.due!,today)}${s.nextMilestone.time?' '+s.nextMilestone.time:''}`:s.next?`Next up${s.next.due?' · '+dayLabel(s.next.due,today):''}`:'All caught up'}</small></span></div>
      <div><span><b>{dayLabel(s.end,today)}</b><small>{s.state==='done'?'Finished':s.daysLeft>0?`Finish · ${plural(s.daysLeft,'day')} left`:s.daysLeft===0?'Finishes today':`Ended ${plural(-s.daysLeft,'day')} ago`}</small></span></div>
    </div>
  </>;
}

/** The small box under the plan: tell Mowr what changed, or ask for a plan. */
function PlanBox({placeholder,onAsk,disabled}:{placeholder:string;onAsk:PlanActions['onAsk'];disabled?:string}){
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[reply,setReply]=useState<{text:string;error?:boolean}|null>(null);
  const history=useRef<{role:'user'|'assistant';content:string}[]>([]);
  const live=useRef(true);useEffect(()=>()=>{live.current=false;},[]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();const message=text.trim();if(!message||busy)return;
    setBusy(true);setReply(null);setText('');
    try{
      const answer=await onAsk(message,history.current.slice(-6));
      history.current=[...history.current,{role:'user' as const,content:message},{role:'assistant' as const,content:answer}].slice(-8);
      if(live.current)setReply({text:answer||'Done.'});
    }catch(err){if(live.current){setReply({text:(err as Error).message||'That didn’t go through. Try again.',error:true});setText(message);}}
    finally{if(live.current)setBusy(false);}
  };
  return <div className="pl-box-wrap">
    <form className={`pl-box ${busy?'busy':''}`} onSubmit={submit}>
      <Icon name="chat" size={16}/>
      <input value={text} onChange={e=>setText(e.target.value)} placeholder={disabled||placeholder} aria-label="Tell Mowr about your plan" disabled={busy||!!disabled} maxLength={2000}/>
      <button type="submit" className="pl-box-send" disabled={!text.trim()||busy||!!disabled} aria-label="Send">{busy?<span className="pl-spin" aria-hidden="true"/>:<Icon name="arrow" size={15}/>}</button>
    </form>
    {busy&&<p className="pl-reply working" role="status">Mowr is updating the plan…</p>}
    {reply&&<p className={`pl-reply ${reply.error?'error':''}`} role="status">{reply.text}<button type="button" aria-label="Dismiss" onClick={()=>setReply(null)}><Icon name="close" size={12}/></button></p>}
  </div>;
}

/** The Plan tab of a subject or project. */
export function PlanView({space,plan,draft,actions,canAsk}:{space:Space;plan?:SpacePlan;draft?:PlanDraftView|null;actions:PlanActions;canAsk:boolean}){
  const today=localDay();
  const s=useMemo(()=>plan?planStatus(plan,today):null,[plan,today]);
  const disabled=canAsk?undefined:'Connect an AI in Settings → Models to plan with Mowr';
  const remove=async()=>{if(await confirmDialog({title:`Delete “${plan!.title}”?`,message:`The plan and its progress are removed from ${space.name}. This can’t be undone.`,confirm:'Delete plan',danger:true}))actions.onDelete();};
  if(draft)return <div className="pl-view">
    <section className="pl-card pl-draft">
      <div className="pl-draft-bar"><span className="sp-eyebrow">{draft.replaces?`Draft · replaces “${draft.replaces}”`:'Draft plan'}</span>
        <div><button type="button" className="pl-btn" onClick={actions.onDiscardDraft}>Discard</button><button type="button" className="pl-btn solid" onClick={actions.onSaveDraft}>{draft.replaces?'Replace plan':'Save plan'}</button></div></div>
      <PlanSummary plan={draft.plan} today={today}/>
    </section>
    <PlanBox placeholder="Ask for changes before you save…" onAsk={actions.onAsk} disabled={disabled}/>
    <PlanTasks plan={draft.plan} today={today}/>
  </div>;
  if(!plan||!s)return <div className="pl-view">
    <section className="pl-empty">
      <Illustration scene="route" viewBox="100 70 290 260" className="pl-empty-art"/>
      <div className="pl-empty-copy">
        <h3>No plan yet</h3>
        <p>Tell Mowr what you’re working toward: the deadline, the quizzes or milestones on the way, how much time you have. It lays out dated tasks, tracks what’s done and keeps the plan up to date as things change.</p>
        <PlanBox placeholder={space.kind==='subject'?'e.g. Midterm on Oct 28, quizzes every Thursday, 2 hours a day':'e.g. Launch on Nov 15: design, build, test and a beta week'} onAsk={actions.onAsk} disabled={disabled}/>
        <button type="button" className="pl-link" onClick={()=>actions.onDraftChat('/plan ')}>Or plan it in a full chat<Icon name="arrow" size={13}/></button>
      </div>
    </section>
  </div>;
  return <div className="pl-view">
    <section className="pl-card">
      <span className="pl-art" aria-hidden="true"><Illustration scene={s.state==='behind'?'alarm':s.state==='done'?'checklist':'route'} viewBox="100 70 290 260"/></span>
      <button type="button" className="icon-button pl-delete" aria-label="Delete plan" title="Delete plan" onClick={()=>void remove()}><Icon name="trash" size={16}/></button>
      <PlanSummary plan={plan} today={today}/>
      <p className="pl-pace">{paceLine(s)}</p>
    </section>
    <PlanBox placeholder="Tell Mowr what changed: “finished lecture 3”, “quiz moved to Friday”…" onAsk={actions.onAsk} disabled={disabled}/>
    {(s.overdue.length>0||s.today.length>0)&&<section className="pl-card pl-focus">
      <span className="sp-eyebrow">{s.overdue.length?'Needs attention':'Today'}</span>
      <ul>{[...s.overdue,...s.today].map(t=><TaskRow key={t.id} task={t} today={today} onToggle={actions.onToggle}/>)}</ul>
    </section>}
    <PlanTasks plan={plan} today={today} onToggle={actions.onToggle}/>
  </div>;
}

/** The plan on a space's Overview: where it stands and what is next, one click from the Plan tab. */
export function PlanOverviewCard({plan,onOpen}:{plan:SpacePlan;onOpen:()=>void}){
  const today=localDay(),s=planStatus(plan,today);
  const focus=[...s.overdue,...s.today].slice(0,3);
  return <section className="sp-card pl-overview">
    <div className="sp-card-head"><span className="sp-eyebrow">Plan</span><button onClick={onOpen}>Open plan</button></div>
    <div className="pl-overview-row">
      <Ring value={s.percent}/>
      <div><b>{plan.title}</b><small><span className={`pl-state inline ${s.state}`}><i/>{STATE_LABEL(s,today)}</span> · {s.done}/{s.total} done</small></div>
    </div>
    {focus.length>0?<ul className="pl-overview-list">{focus.map(t=><li key={t.id}><span>{t.title}</span><Due task={t} today={today}/></li>)}</ul>
      :s.next&&<p className="pl-overview-next">Next: {s.next.title}{s.next.due?` · ${dayLabel(s.next.due,today)}`:''}</p>}
  </section>;
}
