import {useState} from 'react';
import type {Skill} from '../../core/types';
import {Icon} from '../Icons';
import {SettingsCard} from './SettingsParts';

const kinds=['All','Learning','Research','Writing','Work'];

/** Your ways of working: filter, make or import one, and open any to read or change its steps. */
export function SkillsSettings({skills,onOpen,onCreate,onImport}:{skills:Skill[];onOpen:(skill:Skill)=>void;onCreate:()=>void;onImport:()=>void}){
 const [kind,setKind]=useState('All'),shown=skills.filter(s=>kind==='All'||s.category===kind);
 return <>
  <div className="st-skills-bar">
   <div className="st-chips" role="tablist" aria-label="Skill kinds">{kinds.map(k=><button type="button" role="tab" key={k} aria-selected={kind===k} className={kind===k?'on':''} onClick={()=>setKind(k)}>{k}</button>)}</div>
   <div className="st-skills-actions">
    <button type="button" className="secondary" onClick={onImport}><Icon name="attach" size={15}/>Import</button>
    <button type="button" className="secondary st-strong" onClick={onCreate}><Icon name="plus" size={15}/>New skill</button>
   </div>
  </div>
  <SettingsCard>
   {shown.map(s=><button type="button" className="st-skill" key={s.id} onClick={()=>onOpen(s)}>
    <span className="st-skill-icon"><Icon name={s.icon} size={20}/></span>
    <span className="st-skill-text"><strong>{s.name}</strong><small>{s.description}</small></span>
    <span className="st-skill-meta">{s.category||'Your skill'} · {s.steps.length} {s.steps.length===1?'step':'steps'}</span>
    <Icon name="arrow" size={16}/>
   </button>)}
   {!shown.length&&<p>{skills.length?`No ${kind.toLowerCase()} skills yet.`:'No skills yet.'}</p>}
  </SettingsCard>
 </>;
}
