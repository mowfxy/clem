import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Icon,Logo} from '../Icons';
import {ModelSelector} from '../ModelSelector';
import {AGENT_KINDS,makeAgent,teamOf} from '../../core/coordinator';
import type {Model,ProjectAgent,ProjectTeam,Space} from '../../core/types';
import '../dialogs.css';

/** Each kind's colour: muted, so a row of them reads as people, not as alerts. */
const TINT:Record<string,string>={researcher:'#7fa7c9',writer:'#d9b36c',critic:'#d87968',planner:'#8fbf98',analyst:'#a99bd6',engineer:'#6fb7b0',designer:'#d68fb4',factchecker:'#c4b07a'};
export const MAX_AGENTS=8;

/** Each kind's drawn icon (src/Icons.tsx), so an agent reads as what it does, not as a letter. */
const GLYPH:Record<string,string>={researcher:'research',writer:'writing',critic:'cmd-feedback',planner:'cmd-plan',analyst:'analysis',engineer:'device',designer:'visuals',factchecker:'verify'};

/** An agent's mark: its kind's icon on its kind's colour. */
export function AgentMark({agent,size=24}:{agent:ProjectAgent;size?:number}){
  return <span className={`pj-agent-mark kind-${agent.kind}`} aria-hidden="true" style={{'--agent':TINT[agent.kind]||'#9a9890',width:size,height:size} as CSSProperties}><Icon name={GLYPH[agent.kind]||'spark'} size={Math.round(size*.62)}/></span>;
}

/** Project settings → Team: the coordinator's model, and which agents it can hand work to, each with its own model. */
export function TeamDialog({space,models,fallbackModel,onSave,onClose,onConnect}:{space:Space;models:Model[];fallbackModel:string;onSave:(team:ProjectTeam)=>void;onClose:()=>void;onConnect:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const start=teamOf(space);
  const [team,setTeam]=useState<ProjectTeam>(()=>structuredClone(start));
  const [open,setOpen]=useState<string|null>(null);
  const dirty=JSON.stringify(team)!==JSON.stringify(start);
  useEffect(()=>{ref.current?.showModal();},[]);
  const casualClose=()=>{if(!dirty)onClose();};
  const set=(id:string,patch:Partial<ProjectAgent>)=>setTeam(t=>({...t,agents:t.agents.map(a=>a.id===id?{...a,...patch}:a)}));
  const add=(kind:string)=>{if(team.agents.length>=MAX_AGENTS)return;const a=makeAgent(kind,team.agents.map(x=>x.id));setTeam(t=>({...t,agents:[...t.agents,a]}));if(kind==='custom')setOpen(a.id);};
  const remove=(id:string)=>setTeam(t=>({...t,agents:t.agents.filter(a=>a.id!==id)}));
  const valid=team.agents.every(a=>a.name.trim()&&(a.kind!=='custom'||a.instructions.trim()));
  const save=()=>{if(!valid)return;onSave({...team,agents:team.agents.map(a=>({...a,name:a.name.trim().slice(0,40),instructions:a.instructions.trim().slice(0,2000)}))});onClose();};
  const coordinator=team.coordinatorModel||fallbackModel;
  return createPortal(
    <dialog ref={ref} className="contact-dialog pj-team-dialog" aria-labelledby="pj-team-title" onCancel={e=>{e.preventDefault();casualClose();}} onClick={e=>{if(e.target===e.currentTarget)casualClose();}}>
      <header>
        <span className="contact-option-mark" aria-hidden="true"><Icon name="users" size={18}/></span>
        <div><h2 id="pj-team-title">Team</h2><p>You talk to the coordinator. It answers, and hands bigger pieces to these agents in threads.</p></div>
        <button type="button" className="contact-close" aria-label="Close" onClick={onClose}><Icon name="close" size={16}/></button>
      </header>
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div className="pj-team-body">
          <div className="pj-team-row coordinator">
            <span className="pj-coord-mark" aria-hidden="true"><Logo size={20} still/></span>
            <div className="pj-team-who"><strong>Coordinator</strong><small>Talks to you, keeps the project memory, delegates</small></div>
            <ModelSelector models={models} value={coordinator} onChange={id=>setTeam(t=>({...t,coordinatorModel:id}))} onConnect={onConnect} label="Coordinator model"/>
          </div>
          <h3 className="pj-team-label">Agents <small>{team.agents.length} of {MAX_AGENTS}</small></h3>
          {!team.agents.length&&<p className="pj-team-none">No agents: the coordinator does everything itself. Add one below.</p>}
          <ul className="pj-team-list">
            {team.agents.map(a=>{const kind=AGENT_KINDS.find(k=>k.kind===a.kind);const expanded=open===a.id;return <li key={a.id} className={`pj-team-row${expanded?' open':''}`}>
              <AgentMark agent={a} size={30}/>
              <div className="pj-team-who">
                <input value={a.name} maxLength={40} aria-label="Agent name" onChange={e=>set(a.id,{name:e.target.value})}/>
                <small>{kind?kind.line:'Custom agent'}</small>
              </div>
              <ModelSelector models={models} value={a.model||''} auto="Same as coordinator" onChange={id=>set(a.id,{model:id||undefined})} onConnect={onConnect} label={`${a.name} model`}/>
              <button type="button" className="pj-team-icon" aria-expanded={expanded} aria-label={`${a.name}: how it works`} onClick={()=>setOpen(expanded?null:a.id)}><Icon name="sliders" size={16}/></button>
              <button type="button" className="pj-team-icon" aria-label={`Remove ${a.name}`} onClick={()=>remove(a.id)}><Icon name="trash" size={16}/></button>
              {expanded&&<label className="pj-team-instructions"><span>How {a.name.trim()||'it'} works</span>
                <textarea rows={3} value={a.instructions} maxLength={2000} placeholder="What this agent does and how, e.g. “Checks every number against the source and shows the working.”" onChange={e=>set(a.id,{instructions:e.target.value})} autoFocus={a.kind==='custom'}/></label>}
            </li>;})}
          </ul>
          {team.agents.length<MAX_AGENTS&&<><h3 className="pj-team-label">Add an agent</h3>
          <div className="pj-team-kinds">
            {AGENT_KINDS.map(k=>{const n=team.agents.filter(a=>a.kind===k.kind).length;return <button type="button" key={k.kind} onClick={()=>add(k.kind)}>
              <AgentMark agent={{id:k.kind,kind:k.kind,name:k.name,instructions:''}} size={22}/><span className="pj-kind-text"><strong>{k.name}{n>0&&<em> · {n} added</em>}</strong><small>{k.line}</small></span><Icon name="plus" size={14}/></button>;})}
            <button type="button" onClick={()=>add('custom')}><AgentMark agent={{id:'custom',kind:'custom',name:'+',instructions:''}} size={22}/><span className="pj-kind-text"><strong>Custom</strong><small>Name it and say how it works</small></span><Icon name="plus" size={14}/></button>
          </div></>}
        </div>
        <footer>
          <small>{valid?'Agents without a model of their own use the coordinator’s.':'Give each custom agent a name and instructions.'}</small>
          <button type="button" className="contact-secondary" onClick={onClose}>Cancel</button>
          <button className="contact-primary" disabled={!dirty||!valid}>Save</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
