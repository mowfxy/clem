import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../Icons';
import {ModelSelector} from '../ModelSelector';
import {teamOf} from '../../core/coordinator';
import type {Model,ProjectTeam,Space} from '../../core/types';
import '../dialogs.css';

/** Project settings: the model and thinking level of the coordinator, and of the subagents it opens threads with. */
export function ProjectSettingsDialog({space,models,fallbackModel,onSave,onClose,onConnect}:{space:Space;models:Model[];fallbackModel:string;onSave:(team:ProjectTeam)=>void;onClose:()=>void;onConnect:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const start=teamOf(space);
  const [team,setTeam]=useState<ProjectTeam>(()=>({...start}));
  const dirty=JSON.stringify(team)!==JSON.stringify(start);
  useEffect(()=>{ref.current?.showModal();},[]);
  const casualClose=()=>{if(!dirty)onClose();};
  const coordinator=team.coordinatorModel||fallbackModel;
  // Subagents follow the coordinator's model until another is picked; picking the same one goes back to following.
  const agent=team.agentModel||coordinator;
  const save=()=>{const clean=Object.fromEntries(Object.entries(team).filter(([,v])=>v)) as ProjectTeam;onSave(clean);onClose();};
  return createPortal(
    <dialog ref={ref} className="pj-dialog" aria-labelledby="pj-settings-title" onCancel={e=>{e.preventDefault();casualClose();}} onClick={e=>{if(e.target===e.currentTarget)casualClose();}}>
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <header className="pj-dialog-head">
          <h2 id="pj-settings-title">Project settings</h2>
          <button type="button" className="pj-dialog-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button>
        </header>
        <div className="pj-setting">
          <div><strong>Coordinator</strong><small>Talks to you, keeps the memory and opens threads.</small></div>
          <ModelSelector models={models} value={coordinator} onChange={id=>setTeam(t=>({...t,coordinatorModel:id,coordinatorEffort:undefined}))} effort={team.coordinatorEffort} onEffort={e=>setTeam(t=>({...t,coordinatorEffort:e}))} onConnect={onConnect} label="Coordinator model"/>
        </div>
        <div className="pj-setting">
          <div><strong>Subagents</strong><small>{team.agentModel?'Each thread runs on this model.':'Same model as the coordinator unless you pick another.'}</small></div>
          <ModelSelector models={models} value={agent} onChange={id=>setTeam(t=>({...t,agentModel:id===coordinator?undefined:id,agentEffort:undefined}))} effort={team.agentEffort??(team.agentModel?undefined:team.coordinatorEffort)} onEffort={e=>setTeam(t=>({...t,agentEffort:e}))} onConnect={onConnect} label="Subagent model"/>
        </div>
        <footer className="pj-dialog-foot">
          <button type="button" className="pj-dialog-secondary" onClick={onClose}>Cancel</button>
          <button className="pj-dialog-primary" disabled={!dirty}>Save</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
