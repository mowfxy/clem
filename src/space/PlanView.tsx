import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {confirmDialog} from '../dialogs';
import {planStatus,planSections,daysBetween,addDays,dayLabel,localDay,workItems,type SpacePlan,type PlanTask,type PlanStatus} from '../../core/plans';
import type {Space} from '../../core/types';
import './plan.css';
import './plan-calm.css';

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

/** The plan as one calm line: time passing (faint), work done (bright), today, and the milestones under it. */
export function PlanChart({plan,today=localDay(),compact=false}:{plan:SpacePlan;today?:string;compact?:boolean}){
  const s=planStatus(plan,today);
  const span=Math.max(1,daysBetween(s.start,s.end));
  const at=(day:string)=>Math.max(0,Math.min(1,daysBetween(s.start,day)/span));
  const now=today<s.start?0:today>s.end?1:at(today);
  const milestones=plan.tasks.filter(t=>t.kind==='milestone'&&t.due).sort((a,b)=>a.due!<b.due!?-1:1);
  // Labels only where they fit; the rest keep their mark and a tooltip.
  let last=-1;const labelled=new Set(milestones.filter(m=>{const p=at(m.due!);if(p-last<.18)return false;last=p;return true;}).map(m=>m.id));
  const edge=(p:number)=>p>.86?'end':p<.1?'start':'';
  return <div className={`pl-track ${compact?'compact':''} ${s.state}`} role="img" aria-label={`${s.done} of ${s.total} done; ${s.expected} were planned by today. ${paceLine(s)}`}>
    <div className="pl-rail"><span className="pl-time" style={{transform:`scaleX(${now})`}}/><span className="pl-done" style={{transform:`scaleX(${s.percent})`}}/></div>
    {now>0&&now<1&&<span className={`pl-now ${edge(now)}`} style={{left:`${now*100}%`}}><i/>{!compact&&<em>Today</em>}</span>}
    {milestones.map(m=>{const p=at(m.due!);return <span key={m.id} className={`pl-mile ${m.done?'past':''} ${edge(p)}`} style={{left:`${p*100}%`}} title={`${m.title} · ${dayLabel(m.due!,today)}${m.time?' '+m.time:''}`}><i/>{!compact&&labelled.has(m.id)&&<em>{m.title}<small>{dayLabel(m.due!,today)}</small></em>}</span>;})}
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

function Ring({value,size=46}:{value:number;size?:number}){
  const r=size/2-4,c=2*Math.PI*r,m=size/2;
  return <svg className="pl-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={m} cy={m} r={r} className="track"/><circle cx={m} cy={m} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c*(1-value)} transform={`rotate(-90 ${m} ${m})`}/></svg>;
}

const StateMark=({s,today}:{s:PlanStatus;today:string})=><span className={`pl-state ${s.state}`}><Icon name={`plan-${s.state}`} size={16}/>{STATE_LABEL(s,today)}</span>;

/** Where the plan stands in one line: next milestone and the finish. */
function Facts({s,today}:{s:PlanStatus;today:string}){
  return <p className="pl-facts">
    <span><b>{s.done}/{s.total}</b> done</span>
    {s.nextMilestone?<span>{s.nextMilestone.title} · {dayLabel(s.nextMilestone.due!,today)}{s.nextMilestone.time?' '+s.nextMilestone.time:''}</span>:s.next?<span>Next: {s.next.title}</span>:null}
    <span>{s.state==='done'?'Finished':s.daysLeft>0?`${plural(s.daysLeft,'day')} left`:s.daysLeft===0?'Finishes today':`Ended ${plural(-s.daysLeft,'day')} ago`}</span>
  </p>;
}

/** The plan's headline: progress, title, goal, the timeline and a line of facts. */
export function PlanSummary({plan,today=localDay(),compact=false,state=true}:{plan:SpacePlan;today?:string;compact?:boolean;state?:boolean}){
  const s=planStatus(plan,today);
  return <>
    <div className="pl-head">
      <span className="pl-progress"><Ring value={s.percent} size={compact?44:56}/><b>{Math.round(s.percent*100)}<small>%</small></b></span>
      <div className="pl-head-text">
        <h3>{plan.title}</h3>
        {plan.goal&&<p>{plan.goal}</p>}
        {state&&<StateMark s={s} today={today}/>}
      </div>
    </div>
    <PlanChart plan={plan} today={today} compact={compact}/>
    <Facts s={s} today={today}/>
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
      <Illustration scene="steps" viewBox="100 70 290 260" className="pl-empty-art"/>
      <div className="pl-empty-copy">
        <h3>No plan yet</h3>
        <p>Say what you’re working toward and by when.</p>
        <PlanBox placeholder={space.kind==='subject'?'e.g. Midterm on Oct 28, quizzes every Thursday, 2 hours a day':'e.g. Launch on Nov 15: design, build, test and a beta week'} onAsk={actions.onAsk} disabled={disabled}/>
        <button type="button" className="pl-link" onClick={()=>actions.onDraftChat('/plan ')}>Or plan it in a full chat<Icon name="arrow" size={13}/></button>
      </div>
    </section>
  </div>;
  return <div className="pl-view">
    <section className="pl-card">
      <PlanSummary plan={plan} today={today}/>
    </section>
    <PlanBox placeholder="Tell Mowr what changed: “finished lecture 3”, “quiz moved to Friday”…" onAsk={actions.onAsk} disabled={disabled}/>
    {(s.overdue.length>0||s.today.length>0)&&<section className="pl-focus">
      <h4>{s.overdue.length?'Needs attention':'Today'}</h4>
      <ul>{[...s.overdue,...s.today].map(t=><TaskRow key={t.id} task={t} today={today} onToggle={actions.onToggle}/>)}</ul>
    </section>}
    <PlanTasks plan={plan} today={today} onToggle={actions.onToggle}/>
    <button type="button" className="pl-delete" onClick={()=>void remove()}>Delete plan</button>
  </div>;
}

/** The plan on a space's Overview: where it stands and what is next, one click from the Plan tab. */
export function PlanOverviewCard({plan,onOpen}:{plan:SpacePlan;onOpen:()=>void}){
  const today=localDay(),s=planStatus(plan,today);
  const focus=[...s.overdue,...s.today].slice(0,3);
  return <section className="sp-card pl-overview">
    <div className="pl-overview-top">
      <span className="pl-progress"><Ring value={s.percent} size={44}/><b>{Math.round(s.percent*100)}<small>%</small></b></span>
      <div className="pl-overview-title"><b>{plan.title}</b><StateMark s={s} today={today}/></div>
      <button type="button" className="pl-overview-open" onClick={onOpen}>Open plan<Icon name="arrow" size={14}/></button>
    </div>
    <PlanChart plan={plan} today={today} compact/>
    {focus.length>0?<ul className="pl-overview-list">{focus.map(t=><li key={t.id}><span>{t.title}</span><Due task={t} today={today}/></li>)}</ul>
      :s.next&&<p className="pl-overview-next">Next: {s.next.title}{s.next.due?` · ${dayLabel(s.next.due,today)}`:''}</p>}
  </section>;
}
