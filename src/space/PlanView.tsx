import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {confirmDialog} from '../dialogs';
import {planStatus,daysBetween,dayLabel,localDay,workItems,type SpacePlan,type PlanTask,type PlanStatus} from '../../core/plans';
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
const byDue=(a:PlanTask,b:PlanTask)=>((a.due||'9999')+(a.time||'99')).localeCompare((b.due||'9999')+(b.time||'99'));

/** Counts a number up from zero the first time it shows, then follows changes directly. */
function useCountUp(value:number,ms=900){
  const [shown,setShown]=useState(()=>reduceMotion()?value:0);
  const first=useRef(true);
  useEffect(()=>{
    if(!first.current||reduceMotion()){setShown(value);return;}
    first.current=false;let raf=0;const t0=performance.now();
    const step=(t:number)=>{const k=Math.min(1,(t-t0)/ms);setShown(Math.round(value*(1-Math.pow(1-k,4))));if(k<1)raf=requestAnimationFrame(step);};
    raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf);
  },[value,ms]);
  return shown;
}
const reduceMotion=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The plan as one strip: a short segment per task in date order (done, late or still to do), a sand diamond for
    each milestone, and a thin mark where today falls. Nothing to label, so nothing can overlap. */
export function PlanStrip({plan,today=localDay()}:{plan:SpacePlan;today?:string}){
  const s=planStatus(plan,today);
  const work=new Set(workItems(plan).map(t=>t.id));
  const items=[...plan.tasks].sort(byDue);
  const nowAt=items.filter(t=>t.due&&t.due<=today).length;
  const showNow=nowAt>0&&nowAt<items.length&&today>=s.start&&today<=s.end;
  let n=0;
  return <div className="pl-strip" role="img" aria-label={`${s.done} of ${s.total} done${s.overdue.length?`, ${s.overdue.length} overdue`:''}.`}>
    {items.map((t,i)=>{
      const now=showNow&&i===nowAt?<i key="now" className="pl-strip-now" title="Today"/>:null;
      if(!work.has(t.id))return [now,<b key={t.id} className={`pl-strip-mile ${t.done||(t.due&&t.due<today)?'past':''}`} title={`${t.title}${t.due?' · '+dayLabel(t.due,today):''}`} style={{['--i' as string]:Math.min(n,48)}}/>];
      const late=!t.done&&!!t.due&&t.due<today;
      return [now,<span key={t.id} className={`pl-seg ${t.done?'done':late?'late':t.due===today?'today':''}`} title={t.title} style={{['--i' as string]:Math.min(n++,48)}}/>];
    })}
  </div>;
}

function Due({task,today}:{task:PlanTask;today:string}){
  if(!task.due)return null;
  const late=!task.done&&task.kind!=='milestone'&&task.due<today,d=daysBetween(task.due,today);
  return <span className={`pl-due ${late?'late':''} ${task.due===today&&!task.done?'now':''}`}>{late?(d===1?'1 day late':`${d} days late`):dayLabel(task.due,today)}{task.time&&!late?' · '+task.time:''}</span>;
}

function TaskRow({task,today,group,onToggle}:{task:PlanTask;today:string;group?:boolean;onToggle?:(id:string)=>void}){
  const milestone=task.kind==='milestone';
  const meta=[group?task.group:'',task.notes].filter(Boolean).join(' · ');
  return <li className={`pl-task ${task.done?'done':''} ${milestone?'milestone':''}`}>
    {onToggle?<button type="button" className="pl-check" role="checkbox" aria-checked={!!task.done} aria-label={`${task.done?'Mark not done':'Mark done'}: ${task.title}`} onClick={()=>onToggle(task.id)}><Icon name="check" size={12}/></button>
      :<span className="pl-check" aria-hidden="true">{task.done&&<Icon name="check" size={12}/>}</span>}
    <span className="pl-task-text"><span>{task.title}</span>{meta&&<small>{meta}</small>}</span>
    <Due task={task} today={today}/>
  </li>;
}

type Bucket='late'|'today'|'tomorrow'|'week'|'later'|'any'|'done';
const BUCKETS:[Bucket,string][]=[['late','Overdue'],['today','Today'],['tomorrow','Tomorrow'],['week','This week'],['later','Later'],['any','Any time'],['done','Done']];
function bucketOf(t:PlanTask,today:string,held:boolean):Bucket{
  if(t.done&&!held)return 'done';
  if(!t.due)return 'any';
  const d=daysBetween(today,t.due);
  if(d<0)return t.kind==='milestone'?'done':'late';
  return d===0?'today':d===1?'tomorrow':d<7?'week':'later';
}

/** Every task, by when it is due: overdue, today, tomorrow, this week, later. A task just ticked stays where it was for a
    moment, struck through, before it joins Done, which stays folded away. */
export function PlanTasks({plan,today=localDay(),onToggle}:{plan:SpacePlan;today?:string;onToggle?:(id:string)=>void}){
  const [held,setHeld]=useState<Set<string>>(()=>new Set());
  const [showDone,setShowDone]=useState(false);
  const timers=useRef<number[]>([]);useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
  const toggle=onToggle&&((id:string)=>{
    const t=plan.tasks.find(x=>x.id===id);
    if(t&&!t.done){setHeld(h=>new Set(h).add(id));timers.current.push(window.setTimeout(()=>setHeld(h=>{const n=new Set(h);n.delete(id);return n;}),1300));}
    onToggle(id);
  });
  const groups=new Set(plan.tasks.map(t=>t.group).filter(Boolean)).size>1;
  const sorted=[...plan.tasks].sort(byDue);
  const lists=BUCKETS.map(([key,title])=>({key,title,tasks:sorted.filter(t=>bucketOf(t,today,held.has(t.id))===key)})).filter(b=>b.tasks.length);
  const onlyDone=lists.length===1&&lists[0].key==='done';
  return <div className="pl-sections">{lists.map(b=>{
    const fold=b.key==='done'&&!onlyDone&&!!onToggle;
    return <section key={b.key} className={`pl-section is-${b.key}`}>
      <header>{fold?<button type="button" className="pl-fold" aria-expanded={showDone} onClick={()=>setShowDone(v=>!v)}>{b.title}<small>{b.tasks.length}</small><Icon name="chevron" size={13}/></button>:<><h4>{b.title}</h4><small>{b.tasks.length}</small></>}</header>
      {(!fold||showDone)&&<ul>{b.tasks.map(t=><TaskRow key={t.id} task={t} today={today} group={groups} onToggle={toggle||undefined}/>)}</ul>}
    </section>;})}
  </div>;
}

const StateMark=({s,today}:{s:PlanStatus;today:string})=><span className={`pl-state ${s.state}`}><Icon name={`plan-${s.state}`} size={16}/>{STATE_LABEL(s,today)}</span>;

/** One quiet line under the strip: where it stands, the next milestone and the finish. */
function Facts({s,today}:{s:PlanStatus;today:string}){
  const m=s.nextMilestone;
  return <p className="pl-facts">
    <StateMark s={s} today={today}/>
    {m&&<span>{m.title} <em>{dayLabel(m.due!,today)}{m.time?' · '+m.time:''}</em></span>}
    <span>{s.state==='done'?'Finished':s.daysLeft>0?`${plural(s.daysLeft,'day')} left`:s.daysLeft===0?'Finishes today':`Ended ${plural(-s.daysLeft,'day')} ago`}</span>
  </p>;
}

/** The plan's headline: title and goal with the share done beside them, then the strip and one line of facts. */
export function PlanSummary({plan,today=localDay(),compact=false}:{plan:SpacePlan;today?:string;compact?:boolean;state?:boolean}){
  const s=planStatus(plan,today);
  const pct=useCountUp(Math.round(s.percent*100));
  return <>
    {!compact&&<div className="pl-head">
      <div className="pl-head-text">
        <h3>{plan.title}</h3>
        {plan.goal&&<p>{plan.goal}</p>}
      </div>
      <div className="pl-score" aria-label={`${Math.round(s.percent*100)}% done`}><b>{pct}<small>%</small></b><span>{s.done} of {plural(s.total,'task')}</span></div>
    </div>}
    <PlanStrip plan={plan} today={today}/>
    <Facts s={s} today={today}/>
  </>;
}

/** The small box under the plan: tell Mowr what changed, or ask for a plan. */
function PlanBox({placeholder,onAsk,disabled}:{placeholder:string;onAsk:PlanActions['onAsk'];disabled?:string}){
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[reply,setReply]=useState<{text:string;error?:boolean}|null>(null);
  const history=useRef<{role:'user'|'assistant';content:string}[]>([]);
  const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
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
    <section className="pl-card pl-hero pl-draft">
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
    <section className="pl-card pl-hero">
      <PlanSummary plan={plan} today={today}/>
    </section>
    <PlanBox placeholder="Tell Mowr what changed: “finished lecture 3”, “quiz moved to Friday”…" onAsk={actions.onAsk} disabled={disabled}/>
    <PlanTasks plan={plan} today={today} onToggle={actions.onToggle}/>
    <button type="button" className="pl-delete" onClick={()=>void remove()}>Delete plan</button>
  </div>;
}

/** The plan on a space's Overview: where it stands and what is next, one click from the Plan tab. */
export function PlanOverviewCard({plan,onOpen}:{plan:SpacePlan;onOpen:()=>void}){
  const today=localDay(),s=planStatus(plan,today);
  const pct=useCountUp(Math.round(s.percent*100));
  const focus=[...s.overdue,...s.today].slice(0,3);
  return <section className="sp-card pl-overview">
    <div className="pl-overview-top">
      <div className="pl-overview-title"><b>{plan.title}</b><StateMark s={s} today={today}/></div>
      <span className="pl-overview-score">{pct}<small>%</small></span>
      <button type="button" className="pl-overview-open" onClick={onOpen}>Open plan<Icon name="arrow" size={14}/></button>
    </div>
    <PlanStrip plan={plan} today={today}/>
    {focus.length>0?<ul className="pl-overview-list">{focus.map(t=><li key={t.id}><span>{t.title}</span><Due task={t} today={today}/></li>)}</ul>
      :s.next&&<p className="pl-overview-next">Next: {s.next.title}{s.next.due?` · ${dayLabel(s.next.due,today)}`:''}</p>}
  </section>;
}
