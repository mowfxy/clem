import {useEffect,useRef,useState} from 'react';
import type {Model} from '../../core/types';
import {NoticeArt} from './NoticeStack';

export function AccountHandoff({task,models,onChoose,onStay}:{task:string;models:Model[];onChoose:(model:string,reasoning?:string)=>void;onStay:()=>void}){
  const choices=models.filter(model=>(model.provider==='Anthropic'||model.provider==='xAI'||model.provider==='Google')&&model.connected);
  const [model,setModel]=useState(choices[0]?.id||'');
  const [effort,setEffort]=useState('');
  const first=useRef<HTMLSelectElement>(null);
  useEffect(()=>{first.current?.focus();},[]);
  const chosen=choices.find(item=>item.id===model);
  const service=chosen?.provider==='xAI'?'Grok':chosen?.provider==='Google'?'Antigravity':'Claude';
  return <aside className="account-handoff" role="dialog" aria-label="Choose an account for this task" onKeyDown={event=>{if(event.key==='Escape')onStay();}}>
    <div className="handoff-heading"><span className="notice-art"><NoticeArt kind="handoff"/></span><div><strong>Continue on {service}?</strong><p>ChatGPT usage is low. Choose how to run the remaining steps of “{task}”.</p></div></div>
    <label>Account<span>{service==='Grok'?'SuperGrok or X Premium+ plan':service==='Antigravity'?'Google AI plan':'Claude subscription'}</span></label>
    <label>Model<select ref={first} value={model} onChange={event=>{setModel(event.target.value);setEffort('');}}>{choices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Thinking<select value={effort} onChange={event=>setEffort(event.target.value)}><option value="">Model default</option>{chosen?.reasoningEfforts?.map(item=><option key={item.reasoningEffort} value={item.reasoningEffort}>{item.description||item.reasoningEffort}</option>)}</select></label>
    <p className="handoff-limit-note">{service} checks model access when the step starts. Remaining usage is unavailable here.</p>
    <div className="handoff-actions"><button type="button" onClick={onStay}>Stay on ChatGPT</button><button type="button" className="primary" disabled={!model} onClick={()=>onChoose(model,effort||undefined)}>Continue</button></div>
  </aside>;
}
