import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {ProfileAvatar} from '../ProfileAvatar';
import {settingsGroups, settingsGroupOf, settingsTab} from './SettingsParts';

/** The drawings share one centred frame; the header shows the middle of the 480×390 stage. */
const crop='60 30 360 300';

/** Settings, as a large window over the workspace (the same frame as the file viewer). A rail on the left
 *  holds who you are, a finder and the sections; the section fills the rest. */
export function SettingsWindow({tab,onTab,onClose,me,unread=0,children}:{tab:string;onTab:(name:string)=>void;onClose:()=>void;me:{name:string;email?:string;avatar?:string};unread?:number;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLDivElement>(null),[find,setFind]=useState('');
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
    <label className="st-find"><Icon name="research" size={19}/><input className="st-find-input" autoFocus value={find} placeholder="Search" aria-label="Search settings"
     onChange={e=>setFind(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&first){onTab(first.name);}if(e.key==='Escape'&&find){e.preventDefault();e.stopPropagation();setFind('');}}}/></label>
    <nav className="st-nav" aria-label="Settings sections">
     {groups.map(g=><div className="st-group" key={g.label}>
      <span className="st-group-label">{g.label}</span>
      {g.tabs.map(x=><button type="button" key={x.name} className={tab===x.name?'active':''} aria-current={tab===x.name?'page':undefined} onClick={()=>onTab(x.name)}>
       <Icon name={x.icon} size={20}/><span>{x.name}</span>{x.name==='Help & support'&&unread>0&&<b className="st-count" aria-label={`${unread} new`}>{unread}</b>}
      </button>)}
     </div>)}
     {!groups.length&&<p className="st-none">Nothing matches “{find.trim()}”.</p>}
    </nav>
    <button type="button" className={'st-me st-rail-foot'+(t.name==='Profile'?' active':'')} onClick={()=>onTab('Profile')}>
     <span className="avatar"><ProfileAvatar value={me.avatar} size={38}/></span>
     <span className="st-me-text"><strong>{me.name}</strong><small>{me.email||'Your workspace'}</small></span>
    </button>
   </aside>
   <section className="st-main">
    <header className="st-head" key={t.name}>
     <div className="st-head-text">
      <span className="st-eyebrow">{settingsGroupOf(t.name)}</span>
      <h1 id="st-title">{t.name}</h1>
      <p>{t.line}</p>
     </div>
     <Illustration scene={t.scene} viewBox={crop} className="st-art"/>
    </header>
    <button type="button" className="st-close" aria-label="Close settings" onClick={onClose}><Icon name="close" size={17}/></button>
    <div className="st-body" ref={body} key={'b'+t.name}>{children}</div>
   </section>
  </div>
 </dialog>,document.body);
}
