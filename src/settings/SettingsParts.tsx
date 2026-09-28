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
  {name:'Usage',icon:'analysis',scene:'telescope',still:true,line:'Your threads, tokens and habits.'},
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

/** Each header drawing cropped to where it sits on the 480×390 stage, so every one is centred at the same size. */
const crops:Partial<Record<Scene,string>>={folder:'79 82 318 265',hourglass:'91 45 360 300',house:'45 24 387 323',jar:'45 37 386 321',lifebuoy:'33 29 415 346',link:'92 100 295 246',plane:'217 89 293 244',plug:'-27 -37 537 447',profile:'-6 -58 499 416',safe:'57 60 363 302'};

/** The illustrated header at the top of each settings tab. */
export function SettingsHead({name}:{name:string}){
 const t=settingsTab(name);
 return <header className="settings-head" key={t.name}>
  <Illustration scene={t.scene} ambient still={t.still} viewBox={crops[t.scene]} className="settings-feature-art"/>
  <div><h2>{t.name}</h2><p>{t.line}</p></div>
 </header>;
}

/** A card of settings. Its note is a short caption set just under the card, not a row inside it. */
export function SettingsCard({title,children,note}:{title?:string;children:ReactNode;note?:ReactNode}){
 return <div className="settings-card-wrap"><section className="settings-card">{title&&<h3 className="settings-card-title">{title}</h3>}<div className="settings-card-body">{children}</div></section>{note&&<p className="settings-card-note">{note}</p>}</div>;
}

export function SettingRow({title,description,children,lead}:{title:ReactNode;description?:ReactNode;children?:ReactNode;lead?:ReactNode}){
 return <div className="setting-row v2">{lead}<div className="setting-row-text"><h3>{title}</h3>{description&&<p>{description}</p>}</div>{children&&<div className="setting-row-control">{children}</div>}</div>;
}

export function Switch({checked,onChange,label}:{checked:boolean;onChange:(value:boolean)=>void;label:string}){
 return <label className="mw-switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e=>onChange(e.target.checked)}/><span aria-hidden="true"/></label>;
}

export function Keys({keys}:{keys:string[]}){return <span className="mw-keys">{keys.map(k=><kbd key={k}>{k}</kbd>)}</span>;}
