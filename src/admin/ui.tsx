import {createContext,useCallback,useContext,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {Person} from './api';
import type {Scene} from '../vectorFilm';
import {Illustration} from '../Illustrations';
import {copyText} from '../clipboard';

const paths:Record<string,string>={
  overview:'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  users:'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20 19v-1.4a3.3 3.3 0 0 0-2.4-3.2M15.5 4.2a3.25 3.25 0 0 1 0 6.1',
  card:'M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM3 10h18M7 15h3',
  inbox:'M3 13h5l1.5 2.5h5L16 13h5M5.5 5h13l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-5z',
  megaphone:'M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1M17 8.5a5 5 0 0 1 0 7',
  shield:'M12 3 5 6v5.5c0 4.3 3 7.8 7 9.5 4-1.7 7-5.2 7-9.5V6zM9 12l2 2 4-4',
  log:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-3.5-3.5',
  close:'M6 6l12 12M18 6 6 18',
  arrow:'M5 12h14M13 6l6 6-6 6',
  refresh:'M20 11a8 8 0 0 0-14.7-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.3L20 15.5M20 20v-4.5h-4.5',
  logout:'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3',
  send:'M4 12 20 4l-4 16-4-7zM12 13l8-9',
  note:'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  download:'M12 4v11M7 10l5 5 5-5M5 20h14',
  gift:'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7c2 0 5 .5 5-1.5S13.5 4 12 7',
  ban:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M5.6 5.6l12.8 12.8',
  check:'M5 12.5 10 17 19 7',
  spark:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  external:'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  copy:'M9 9h11v11H9zM5 15H4V4h11v1',
};
export function I({name,size=17}:{name:keyof typeof paths|string;size?:number}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||''}/></svg>;
}

/** Mowr is free, so a person's standing is about access and progress, never billing. */
export function PersonStatus({person}:{person:Pick<Person,'plan'|'suspended'|'setup_step'>}){
  if(person.suspended)return <Badge tone="danger">Suspended</Badge>;
  if(person.plan==='owner')return <Badge tone="ink">Owner</Badge>;
  if((person.setup_step??0)<4)return <Badge tone="quiet">Setup {person.setup_step??0}/4</Badge>;
  return <Badge tone="ok">Active</Badge>;
}
export function Badge({tone='neutral',children}:{tone?:string;children:ReactNode}){return <span className={`adm-badge tone-${tone}`}>{children}</span>;}

const rtf=new Intl.RelativeTimeFormat('en',{numeric:'auto'});
export function ago(value?:string|null){
  if(!value)return '—';
  const diff=(Date.parse(value)-Date.now())/1000;
  const units:[Intl.RelativeTimeFormatUnit,number][]=[['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60]];
  for(const [unit,seconds] of units)if(Math.abs(diff)>=seconds)return rtf.format(Math.round(diff/seconds),unit);
  return 'just now';
}
export const date=(value?:string|null)=>value?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—';
export const who=(p:{email?:string|null;username?:string|null;display_name?:string|null;id?:string})=>p.display_name||p.username||p.email||p.id?.slice(0,8)||'Unknown';
export function initials(p:{email?:string|null;username?:string|null;display_name?:string|null}){const s=(p.display_name||p.username||p.email||'?').replace(/[^\p{L}\p{N} ]/gu,' ').trim();const parts=s.split(/\s+/);return ((parts[0]?.[0]||'?')+(parts[1]?.[0]||'')).toUpperCase();}
export function Avatar({person,size=32}:{person:{id?:string;email?:string|null;username?:string|null;display_name?:string|null};size?:number}){
  const seed=[...(person.id||person.email||'x')].reduce((a,c)=>a+c.charCodeAt(0),0);
  return <span className="adm-avatar" style={{width:size,height:size,fontSize:size*.38,'--hue':String(seed*47%360)} as CSSProperties}>{initials(person)}</span>;
}

export function Empty({icon='spark',scene,title,children}:{icon?:string;scene?:Scene;title:string;children?:ReactNode}){
  return <div className="adm-empty">{scene?<div className="adm-empty-art"><Illustration scene={scene} ambient/></div>:<span className="adm-empty-mark"><I name={icon} size={20}/></span>}<h3>{title}</h3>{children&&<p>{children}</p>}</div>;
}

/** The illustrated page header, matching the one at the top of each settings tab in the app. */
export function PageHead({scene,title,line,children}:{scene:Scene;title:string;line:ReactNode;children?:ReactNode}){
  return <header className="adm-page-head"><Illustration scene={scene} ambient className="adm-head-art"/><div className="adm-head-text"><h1>{title}</h1><p>{line}</p></div>{children&&<div className="adm-head-actions">{children}</div>}</header>;
}
export function Skeleton({rows=5}:{rows?:number}){return <div className="adm-skeleton" aria-busy="true" aria-label="Loading">{Array.from({length:rows},(_,i)=><span key={i} style={{animationDelay:i*80+'ms'}}/>)}</div>;}

type Toast={id:number;text:string;tone:'ok'|'error'};
const ToastContext=createContext<(text:string,tone?:'ok'|'error')=>void>(()=>{});
export const useToast=()=>useContext(ToastContext);
export function ToastHost({children}:{children:ReactNode}){
  const [items,setItems]=useState<Toast[]>([]);
  const push=useCallback((text:string,tone:'ok'|'error'='ok')=>{const id=Date.now()+Math.random();setItems(list=>[...list,{id,text,tone}]);setTimeout(()=>setItems(list=>list.filter(t=>t.id!==id)),4200);},[]);
  return <ToastContext.Provider value={push}>{children}<div className="adm-toasts" role="status" aria-live="polite">{items.map(t=><div key={t.id} className={`adm-toast ${t.tone}`}><I name={t.tone==='ok'?'check':'close'} size={15}/>{t.text}</div>)}</div></ToastContext.Provider>;
}

/** Modal built on <dialog> so focus trapping and Escape come from the browser. */
export function Modal({title,children,onClose,wide}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className={`adm-modal ${wide?'wide':''}`} onClose={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><header><h2>{title}</h2><button className="adm-icon" aria-label="Close" onClick={onClose}><I name="close"/></button></header>{children}</dialog>;
}

export function useLoad<T>(load:()=>Promise<T>,deps:unknown[]){
  const [data,setData]=useState<T|undefined>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const version=useRef(0);
  const reload=useCallback(async()=>{const v=++version.current;setLoading(true);setError('');try{const value=await load();if(v===version.current)setData(value);}catch(e){if(v===version.current)setError((e as Error).message);}finally{if(v===version.current)setLoading(false);}},deps);
  useEffect(()=>{void reload();},[reload]);
  return {data,error,loading,reload};
}

export function ErrorNote({error,onRetry}:{error:string;onRetry?:()=>void}){return <div className="adm-error" role="alert"><span>{error}</span>{onRetry&&<button onClick={onRetry}>Try again</button>}</div>;}

export function Sparkbars({values,label}:{values:{date:string;count:number}[];label:string}){
  const max=Math.max(1,...values.map(v=>v.count));
  return <div className="adm-sparkbars" role="img" aria-label={label}>{values.map((v,i)=><span key={v.date} title={`${date(v.date)}: ${v.count}`} style={{height:`${Math.max(4,v.count/max*100)}%`,animationDelay:i*28+'ms'}} className={v.count?'':'zero'}/>)}</div>;
}

export function copy(text:string,toast:(t:string)=>void){void copyText(text).then(ok=>ok&&toast('Copied'));}
