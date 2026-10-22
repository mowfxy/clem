import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type CSSProperties,type KeyboardEvent as ReactKeyboardEvent,type ReactNode} from 'react';
import type {Person} from './api';
import type {Scene} from '../vectorFilm';
import {Icon} from '../Icons';
import {copyText} from '../clipboard';

/** The portal draws from Clem's drawn icon set, the lab's first and shared set. */
export function I({name,size=17}:{name:string;size?:number}){return <Icon name={name} size={size}/>;}

/** The lab's products are free, so an account's standing is about access and progress, never billing. */
export function PersonStatus({person}:{person:Pick<Person,'plan'|'suspended'|'setup_step'|'products'>}){
  if(person.suspended)return <Badge tone="danger">Suspended</Badge>;
  if(person.plan==='owner')return <Badge tone="ink">Owner</Badge>;
  if(person.products&&!person.products.length)return <Badge tone="quiet">Account only</Badge>;
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

// `scene` is accepted for older callers and ignored: the lab's admin has no illustrations.
export function Empty({icon='spark',title,children}:{icon?:string;scene?:Scene;title:string;children?:ReactNode}){
  return <div className="adm-empty"><span className="adm-empty-mark"><I name={icon} size={20}/></span><h3>{title}</h3>{children&&<p>{children}</p>}</div>;
}

/** A page header: title, one line on what the page is for, and the page's actions. `back` adds a link up a level. */
export function PageHead({title,line,back,children}:{scene?:Scene;title:string;line?:ReactNode;product?:string;back?:{onClick:()=>void;label:string};children?:ReactNode}){
  return <header className="adm-page-head"><div className="adm-head-text">{back&&<button type="button" className="adm-back" onClick={back.onClick}><I name="arrow" size={15}/>{back.label}</button>}<h1>{title}</h1>{line&&<p>{line}</p>}</div>{children&&<div className="adm-head-actions">{children}</div>}</header>;
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
export function Modal({title,line,children,onClose,wide,className}:{title:string;line?:ReactNode;children:ReactNode;onClose:()=>void;wide?:boolean;className?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className={`adm-modal ${wide?'wide':''} ${className||''}`} onClose={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><header><div><h2>{title}</h2>{line&&<p className="adm-modal-line">{line}</p>}</div><button className="adm-icon" aria-label="Close" onClick={onClose}><I name="close"/></button></header>{children}</dialog>;
}

const SYNC_MS=30_000;
export function useLoad<T>(load:()=>Promise<T>,deps:unknown[]){
  const [data,setData]=useState<T|undefined>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const version=useRef(0);
  const reload=useCallback(async()=>{const v=++version.current;setLoading(true);setError('');try{const value=await load();if(v===version.current)setData(value);}catch(e){if(v===version.current)setError((e as Error).message);}finally{if(v===version.current)setLoading(false);}},deps);
  useEffect(()=>{void reload();},[reload]);
  // Background sync: refresh quietly on a timer (browsers slow it to about once a minute in hidden tabs)
  // and catch up at once when the tab is shown, focused or back online. Failures keep the last good data.
  const sync=useCallback(async()=>{const v=version.current;try{const value=await load();if(v===version.current){setData(value);setError('');}}catch{/* Keep what is on screen. */}},deps);
  useEffect(()=>{
    let last=Date.now();
    const run=()=>{last=Date.now();void sync();};
    const timer=setInterval(run,SYNC_MS);
    const wake=()=>{if(document.visibilityState==='visible'&&Date.now()-last>3000)run();};
    document.addEventListener('visibilitychange',wake);addEventListener('focus',wake);addEventListener('online',wake);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);removeEventListener('focus',wake);removeEventListener('online',wake);};
  },[sync]);
  return {data,error,loading,reload};
}

type Option={value:string;label:ReactNode};
/** The app's dropdown: a field-style trigger with a menu in the top layer, so it works inside dialogs and
 *  scrolling panes. Controlled with value/onChange, or uncontrolled with defaultValue plus name for forms. */
export function Select({options,value,defaultValue,onChange,name,disabled,placeholder,className,'aria-label':ariaLabel}:{options:Option[];value?:string;defaultValue?:string;onChange?:(value:string)=>void;name?:string;disabled?:boolean;placeholder?:string;className?:string;'aria-label'?:string}){
  const [inner,setInner]=useState(defaultValue??options[0]?.value??'');
  const current=value??inner;
  const [open,setOpen]=useState(false);const [active,setActive]=useState(0);
  const id=useId(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const selected=options.find(o=>o.value===current);
  const place=()=>{const t=trigger.current,m=menu.current;if(!t||!m)return;const r=t.getBoundingClientRect();m.style.minWidth=`${r.width}px`;const h=m.offsetHeight,w=m.offsetWidth;const below=r.bottom+6+h<=innerHeight-8;m.style.top=`${below?r.bottom+6:Math.max(8,r.top-6-h)}px`;m.style.left=`${Math.max(8,Math.min(r.left,innerWidth-w-8))}px`;};
  const show=()=>{if(disabled)return;setActive(Math.max(0,options.findIndex(o=>o.value===current)));menu.current?.showPopover();place();};
  const hide=()=>menu.current?.hidePopover();
  const pick=(v:string)=>{hide();trigger.current?.focus();if(v===current&&value!==undefined)return;if(value===undefined)setInner(v);onChange?.(v);};
  useEffect(()=>{if(!open)return;const move=()=>place();addEventListener('resize',move);addEventListener('scroll',move,true);menu.current?.querySelectorAll('button')[active]?.scrollIntoView({block:'nearest'});return()=>{removeEventListener('resize',move);removeEventListener('scroll',move,true);};},[open,active]);
  const key=(e:ReactKeyboardEvent)=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open)return show();setActive(a=>(a+(e.key==='ArrowDown'?1:-1)+options.length)%options.length);}
    else if(e.key==='Home'||e.key==='End'){if(open){e.preventDefault();setActive(e.key==='Home'?0:options.length-1);}}
    else if((e.key==='Enter'||e.key===' ')&&open){e.preventDefault();const o=options[active];if(o)pick(o.value);}
    else if(e.key==='Tab'&&open)hide();
  };
  return <>
    {name&&<input type="hidden" name={name} value={current}/>}
    <button ref={trigger} type="button" className={`adm-select ${className||''}`} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={()=>open?hide():show()} onKeyDown={key}>
      <span className={selected?'':'placeholder'}>{selected?.label??placeholder??''}</span><I name="chevron" size={15}/>
    </button>
    <div ref={menu} id={id} popover="auto" role="listbox" className="adm-select-menu" onToggle={e=>setOpen((e as unknown as ToggleEvent).newState==='open')}>
      {options.map((o,i)=><button key={o.value} type="button" role="option" tabIndex={-1} aria-selected={o.value===current} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>pick(o.value)}><span>{o.label}</span>{o.value===current&&<I name="check" size={14}/>}</button>)}
    </div>
  </>;
}

export function ErrorNote({error,onRetry}:{error:string;onRetry?:()=>void}){return <div className="adm-error" role="alert"><span>{error}</span>{onRetry&&<button onClick={onRetry}>Try again</button>}</div>;}

export function Sparkbars({values,label}:{values:{date:string;count:number}[];label:string}){
  const max=Math.max(1,...values.map(v=>v.count));
  return <div className="adm-sparkbars" role="img" aria-label={label}>{values.map((v,i)=><span key={v.date} title={`${date(v.date)}: ${v.count}`} style={{height:`${Math.max(4,v.count/max*100)}%`,animationDelay:i*28+'ms'}} className={v.count?'':'zero'}/>)}</div>;
}

export function copy(text:string,toast:(t:string)=>void){void copyText(text).then(ok=>ok&&toast('Copied'));}
