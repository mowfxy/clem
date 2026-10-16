import type {ReactNode} from 'react';
import type {Scene} from '../vectorFilm';
import './settings-window.css';

export type SettingsTab={name:string;icon:string;scene:Scene;line:string;keywords:string};
/** Settings sections, grouped. Names are stable: other screens open a section by name. */
export const settingsGroups:{label:string;tabs:SettingsTab[]}[]=[
 {label:'You',tabs:[
  {name:'Profile',icon:'account',scene:'profile',line:'Your name, your picture and your account.',keywords:'name picture avatar account email storage export'},
  {name:'General',icon:'settings',scene:'balance',line:'How Mowr looks, runs and responds to keys.',keywords:'appearance quiet motion background tray windows startup shortcuts keyboard'},
  {name:'Security',icon:'lock',scene:'safe',line:'Sign-in, password and verification.',keywords:'password email google two-factor authenticator sessions sign in'},
 ]},
 {label:'Intelligence',tabs:[
  {name:'Models',icon:'models',scene:'plug',line:'Connected accounts and how much is left.',keywords:'chatgpt claude codex usage limits accounts subscription'},
  {name:'Memory',icon:'subjects',scene:'jar',line:'What Mowr keeps in mind for you.',keywords:'remember notes'},
  {name:'Skills',icon:'skills',scene:'cards',line:'Ways of working Mowr brings to every chat.',keywords:'skills workflows steps playbook create import practice'},
  {name:'Automations',icon:'clock',scene:'hourglass',line:'Routines you set up in a chat.',keywords:'routines schedule recurring'},
 ]},
 {label:'Connections',tabs:[
  {name:'Connectors',icon:'connectors',scene:'link',line:'Apps Mowr can read from.',keywords:'google drive apps'},
  {name:'Linked folders',icon:'projects',scene:'folder',line:'Folders on this PC that Mowr can read.',keywords:'folders files changes undo watch'},
 ]},
 {label:'Data',tabs:[
  {name:'Usage',icon:'analysis',scene:'telescope',line:'Your threads, tokens and habits.',keywords:'usage stats statistics tokens activity graph habits streak threads messages'},
  {name:'Data & privacy',icon:'files',scene:'house',line:'Your work stays on this device.',keywords:'export delete chats privacy policy'},
  {name:'Help & support',icon:'research',scene:'lifebuoy',line:'Questions, bugs and ideas.',keywords:'help contact bug support github open source'},
 ]},
];
export const settingsTabs=settingsGroups.flatMap(g=>g.tabs);
export const settingsTab=(name:string)=>settingsTabs.find(t=>t.name===name)||settingsTabs[0];
export const settingsGroupOf=(name:string)=>settingsGroups.find(g=>g.tabs.some(t=>t.name===name))?.label||'';

/** A group of settings with a title set above it and an optional caption below. */
export function SettingsCard({title,children,note}:{title?:string;children:ReactNode;note?:ReactNode}){
 return <section className="st-card-wrap">{title&&<h3 className="st-card-title">{title}</h3>}<div className="st-card">{children}</div>{note&&<p className="st-card-note">{note}</p>}</section>;
}

export function SettingRow({title,description,children,lead}:{title:ReactNode;description?:ReactNode;children?:ReactNode;lead?:ReactNode}){
 return <div className="st-row">{lead}<div className="st-row-text"><h4>{title}</h4>{description&&<p>{description}</p>}</div>{children&&<div className="st-row-control">{children}</div>}</div>;
}

export function Switch({checked,onChange,label}:{checked:boolean;onChange:(value:boolean)=>void;label:string}){
 return <label className="mw-switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={e=>onChange(e.target.checked)}/><span aria-hidden="true"/></label>;
}

export function Keys({keys}:{keys:string[]}){return <span className="mw-keys">{keys.map(k=><kbd key={k}>{k}</kbd>)}</span>;}
