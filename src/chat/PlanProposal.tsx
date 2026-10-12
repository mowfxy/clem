import {useMemo,useState} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {PlanSummary,PlanTasks} from '../space/PlanView';
import {newPlan,type PlanBlock,type SpacePlan} from '../../core/plans';
import type {EditOutcome} from '../../core/types';
import '../space/plan.css';

/** What the chat knows about the subject or project a plan block points at. */
export type PlanCardInfo={
  /** Its name, or the name of the subject or project saving will create. */
  spaceName?:string;spaceKind?:'subject'|'project';
  /** Saving makes a new subject or project first. */
  creates?:boolean;
  /** The plan it has now. */
  existing?:SpacePlan;
  /** A later draft for the same place came after this one. */
  superseded?:boolean;
  /** This update was the last change to the plan, so it can still be undone. */
  canUndo?:boolean;
};

const count=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`;
function changeLine(block:Extract<PlanBlock,{action:'update'}>){
  const n=(op:string)=>block.changes.filter(c=>c.op===op).length;
  return [n('done')&&count(n('done'),'done','done'),n('undo')&&count(n('undo'),'reopened','reopened'),n('edit')&&count(n('edit'),'change'),n('add')&&count(n('add'),'new task'),n('remove')&&count(n('remove'),'removed','removed'),block.title&&'renamed'].filter(Boolean).join(' · ');
}

/**
 * A plan Mowr made or changed in a chat. New, replacing and deleting plans wait for the person (Save / Replace /
 * Delete); updates were applied when the reply finished and offer Undo while nothing has changed since.
 */
export function PlanProposal({block,streaming,outcome,info,onDecide,onUndo,onOpen}:{block:PlanBlock;streaming:boolean;outcome?:EditOutcome;info:PlanCardInfo;onDecide:(approve:boolean)=>Promise<void>;onUndo:()=>Promise<void>;onOpen:()=>void}){
  const [busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}finally{setBusy(false);}};
  const where=info.spaceName?`${info.creates?'New '+(info.spaceKind||'subject')+' · ':''}${info.spaceName}`:'';
  const lost=!info.spaceName;
  const preview=useMemo(()=>block.action==='create'||block.action==='replace'?newPlan('preview',block,Date.now(),'preview'):null,[block]);

  if(block.action==='update'){
    const applied=outcome?.status==='applied',undone=outcome?.status==='undone',failed=outcome?.status==='failed';
    return <div className={`pl-proposal update ${outcome?.status||''}`}>
      <span className="pl-proposal-icon"><Icon name={undone?'undo':failed?'close':'check'} size={14}/></span>
      <div className="pl-proposal-line">
        <strong>{undone?'Plan change undone':failed?'Plan not updated':applied?'Plan updated':'Plan change'}{where&&<span> · {where}</span>}</strong>
        <small>{failed?outcome?.error:block.summary}{!failed&&changeLine(block)?` — ${changeLine(block)}`:''}{applied&&outcome?.error?` · ${outcome.error}`:''}</small>
      </div>
      {!streaming&&<div className="pl-proposal-actions">
        {!outcome&&!lost&&<button type="button" className="pl-btn solid" disabled={busy} onClick={()=>void run(()=>onDecide(true))}>Apply</button>}
        {applied&&info.canUndo&&<button type="button" className="pl-btn" disabled={busy} onClick={()=>void run(onUndo)}>Undo</button>}
        {!lost&&<button type="button" className="pl-btn" onClick={onOpen}>Open</button>}
      </div>}
    </div>;
  }

  if(block.action==='delete'){
    const title=info.existing?.title;
    const done=outcome?.status==='applied',kept=outcome?.status==='dismissed';
    return <div className={`pl-proposal delete ${outcome?.status||''}`}>
      <div className="pl-proposal-top">
        <span className="pl-proposal-art" aria-hidden="true"><Illustration scene="checklist" viewBox="100 70 290 260"/></span>
        <div className="pl-proposal-title">
          <span className="sp-eyebrow">{where||'Plan'}</span>
          <strong>{done?'Plan deleted':kept?'Plan kept':title?`Delete “${title}”?`:'There is no plan to delete here'}</strong>
          {!outcome&&title&&<small>{block.reason||'Its tasks and progress are removed. This can’t be undone.'}</small>}
        </div>
      </div>
      {!streaming&&!outcome&&title&&<footer><span/><div><button type="button" className="pl-btn" disabled={busy} onClick={()=>void run(()=>onDecide(false))}>Keep plan</button><button type="button" className="pl-btn danger" disabled={busy} onClick={()=>void run(()=>onDecide(true))}>Delete plan</button></div></footer>}
    </div>;
  }

  const saved=outcome?.status==='applied',dismissed=outcome?.status==='dismissed',replacing=block.action==='replace'||!!info.existing;
  return <div className={`pl-proposal draft ${outcome?.status||''} ${info.superseded&&!outcome?'superseded':''}`}>
    <div className="pl-proposal-top">
      <span className="pl-proposal-art" aria-hidden="true"><Illustration scene="route" viewBox="100 70 290 260"/></span>
      <div className="pl-proposal-title">
        <span className="sp-eyebrow">{saved?'Plan saved':dismissed?'Draft discarded':replacing&&info.existing?`Replaces “${info.existing.title}”`:'New plan'}{where&&` · ${where}`}</span>
        <strong>{block.title}</strong>
        <small>{count(block.tasks.filter(t=>t.kind!=='milestone').length,'task')}{block.tasks.some(t=>t.kind==='milestone')?` · ${count(block.tasks.filter(t=>t.kind==='milestone').length,'milestone')}`:''}</small>
      </div>
    </div>
    {preview&&!dismissed&&<div className="pl-preview">
      <PlanSummary plan={preview} compact/>
      {open&&<div className="pl-preview-tasks"><PlanTasks plan={preview}/></div>}
    </div>}
    {lost&&<p className="pl-proposal-note">Mowr couldn’t tell which subject or project this plan is for. Ask it to name one.</p>}
    {!streaming&&!lost&&<footer>
      {!dismissed&&<button type="button" className="pl-btn pl-toggle" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{open?'Hide tasks':'Open plan'}<Icon name="chevron" size={13}/></button>}
      <div>
        {saved&&<button type="button" className="pl-btn solid" onClick={onOpen}>Open in {info.spaceName}<Icon name="arrow" size={13}/></button>}
        {!outcome&&info.superseded&&<small className="pl-proposal-hint">A newer draft is below.</small>}
        {!outcome&&!info.superseded&&<><small className="pl-proposal-hint">Keep chatting to change it.</small>
          <button type="button" className="pl-btn" disabled={busy} onClick={()=>void run(()=>onDecide(false))}>Discard</button>
          <button type="button" className="pl-btn solid" disabled={busy} onClick={()=>void run(()=>onDecide(true))}>{replacing&&info.existing?'Replace plan':'Save plan'}</button></>}
      </div>
    </footer>}
  </div>;
}
