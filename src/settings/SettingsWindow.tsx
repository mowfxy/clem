import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../Icons';
import {ProfileAvatar} from '../ProfileAvatar';
import {settingsGroups, settingsTab} from './SettingsParts';

/** Settings, as a window over the workspace that looks like the app: a rail like its sidebar (a finder, the
 *  sections, you) and the section under a serif title, like the app's other pages. */
export function SettingsWindow({tab,onTab,onClose,me,unread=0,children}:{tab:string;onTab:(name:string)=>void;onClose:()=>void;me:{name:string;email?:string;avatar?:string};unread?:number;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLElement>(null),[find,setFind]=useState('');
 const t=settingsTab(tab);
 useEffect(()=>{const d=dialog.current;if(d&&!d.open)d.showModal();return()=>d?.close();},[]);
 useEffect(()=>{body.current?.scrollTo({top:0});},[tab]);
 const groups=useMemo(()=>{const q=find.trim().toLowerCase();if(!q)return settingsGroups;
  return settingsGroups.map(g=>({...g,tabs:g.tabs.filter(x=>(x.name+' '+x.line+' '+x.keywords+' '+g.label).toLowerCase().includes(q))})).filter(g=>g.tabs.length);},[find]);
 const first=groups[0]?.tabs[0];
 return createPortal(<dialog ref={dialog} className="st-dialog" aria-labelledby="st-title"
  onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();onClose();}}
  onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="st">
   <aside className="st-rail">
    <div className="st-top"><h2>Settings</h2></div>
    <label className="st-find"><Icon name="research" size={17}/><input className="st-find-input" autoFocus value={find} placeholder="Search" aria-label="Search settings"
     onChange={e=>setFind(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&first){onTab(first.name);}if(e.key==='Escape'&&find){e.preventDefault();e.stopPropagation();setFind('');}}}/></label>
    <nav className="st-nav" aria-label="Settings sections">
     {groups.map(g=><div className="st-group" key={g.label}>
      <span className="st-group-label">{g.label}</span>
      {g.tabs.map(x=><button type="button" key={x.name} className={tab===x.name?'active':''} aria-current={tab===x.name?'page':undefined} onClick={()=>onTab(x.name)}>
       <Icon name={x.icon} size={18}/><span>{x.name}</span>{x.name==='Help & support'&&unread>0&&<b className="st-count" aria-label={`${unread} new`}>{unread}</b>}
      </button>)}
     </div>)}
     {!groups.length&&<p className="st-none">Nothing matches “{find.trim()}”.</p>}
    </nav>
    <button type="button" className={'st-me st-rail-foot'+(t.name==='Profile'?' active':'')} onClick={()=>onTab('Profile')}>
     <span className="avatar"><ProfileAvatar value={me.avatar} size={30}/></span>
     <span className="st-me-text"><strong>{me.name}</strong>{me.email&&<small>{me.email}</small>}</span>
    </button>
   </aside>
   <section className="st-main" ref={body}>
    <button type="button" className="st-close" aria-label="Close settings" onClick={onClose}><Icon name="close" size={17}/></button>
    <header className="st-head" key={t.name}><h1 id="st-title">{t.name}</h1></header>
    <div className="st-body" key={'b'+t.name}>{children}</div>
   </section>
  </div>
 </dialog>,document.body);
}
