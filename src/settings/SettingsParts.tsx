import type {ReactNode} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import type {Scene} from '../vectorFilm';
import './settings-v2.css';

/** Settings tabs, grouped. Names are stable: other screens open a tab by name. */
export const settingsGroups:{label:string;tabs:{name:string;icon:string;scene:Scene;line:string;still?:boolean}[]}[]=[
 {label:'You',tabs:[
  {name:'General',icon:'account',scene:'profile',line:'Your profile and how Mowr feels.'},
  {name:'Security',icon:'lock',scene:'safe',line:'Sign-in, password and verification.'},
 ]},
 {label:'Intelligence',tabs:[
  {name:'Models',icon:'models',scene:'plug',still:true,line:'Connected accounts and usage.'},
  {name:'Memory',icon:'subjects',scene:'jar',still:true,line:'What Mowr keeps in mind for you.'},
  {name:'Automations',icon:'clock',scene:'hourglass',still:true,line:'Routines you set up in a chat.'},
 ]},
 {label:'Connections',tabs:[
  {name:'Connectors',icon:'connectors',scene:'link',still:true,line:'Apps Mowr can read from.'},
  {name:'Linked folders',icon:'projects',scene:'folder',still:true,line:'Folders on this PC that Mowr can read.'},
  {name:'Telegram',icon:'chat',scene:'plane',still:true,line:'Message Mowr from your phone.'},
 ]},
 {label:'Data',tabs:[
  {name:'Data & privacy',icon:'files',scene:'house',line:'Your work stays on this device.'},
  {name:'Help & support',icon:'research',scene:'lifebuoy',line:'Questions, bugs and ideas.'},
 ]},
];
export const settingsTab=(name:string)=>settingsGroups.flatMap(g=>g.tabs).find(t=>t.name===name)||settingsGroups[0].tabs[0];

export function SettingsNav({active,onSelect}:{active:string;onSelect:(name:string)=>void}){
 return <nav className="settings-tabs" aria-label="Settings sections">{settingsGroups.map(g=><div className="settings-group" key={g.label}>
  <span className="settings-group-label">{g.label}</span>
  {g.tabs.map(t=><button key={t.name} className={active===t.name?'active':''} aria-current={active===t.name?'page':undefined} onClick={()=>onSelect(t.name)}><Icon name={t.icon} size={17}/>{t.name}</button>)}
 </div>)}</nav>;
}

/** The illustrated header at the top of each settings tab. */
export function SettingsHead({name}:{name:string}){
 const t=settingsTab(name);
 return <header className="settings-head" key={t.name}>
  <Illustration scene={t.scene} ambient still={t.still} className="settings-feature-art"/>
  <div><h2>{t.name}</h2><p>{t.line}</p></div>
 </header>;
}

export function SettingsCard({title,children,note}:{title?:string;children:ReactNode;note?:ReactNode}){
 return <section className="settings-card">{title&&<h3 className="settings-card-title">{title}</h3>}<div className="settings-card-body">{children}</div>{note&&<p className="settings-card-note">{note}</p>}</section>;
}

export function SettingRow({title,description,children,lead}:{title:ReactNode;description?:ReactNode;children?:ReactNode;lead?:ReactNode}){
 return <div className="setting-row v2">{lead}<div className="setting-row-text"><h3>{title}</h3>{description&&<p>{description}</p>}</div>{children&&<div className="setting-row-control">{children}</div>}</div>;
}

export function Switch({checked,onChange,label}:{checked:boolean;onChange:(value:boolean)=>void;label:string}){
 return <label className="mw-switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e=>onChange(e.target.checked)}/><span aria-hidden="true"/></label>;
}

export function Keys({keys}:{keys:string[]}){return <span className="mw-keys">{keys.map(k=><kbd key={k}>{k}</kbd>)}</span>;}
