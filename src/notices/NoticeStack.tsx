import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Illustration} from '../Illustrations';
import {Icon} from '../Icons';
import type {Scene} from '../vectorFilm';
import './notices.css';

export type NoticeKind='switch'|'reset'|'handoff'|'announcement'|'support'|'success'|'warning'|'info'|'reminder';
/** `art`: a drawing that suits this one notice better than its kind's (a memory gets the jar, changed files the folder). */
export type Notice={id:string;kind:NoticeKind;title:string;detail:string;action?:{label:string;run:()=>void};sticky?:boolean;art?:Scene};

const LIFETIME=9000;
/** Each kind of notice has its own small ink drawing, playing its loop; the card itself stays plain. */
const ART:Record<NoticeKind,Scene>={switch:'swap',reset:'key',handoff:'plane',announcement:'bell',support:'conversation',success:'checklist',warning:'expired',info:'bell',reminder:'alarm'};

export function NoticeArt({kind,art}:{kind:NoticeKind;art?:Scene}){
  return <Illustration scene={art||ART[kind]} viewBox="92 40 296 296" className="notice-drawing"/>;
}

function NoticeCard({notice,depth,onDismiss,paused}:{notice:Notice;depth:number;onDismiss:()=>void;paused:boolean}){
  const [leaving,setLeaving]=useState(false);
  const remaining=useRef(LIFETIME),started=useRef(Date.now());
  const close=useRef(()=>{});
  close.current=()=>{setLeaving(true);setTimeout(onDismiss,260);};
  // Only the front card counts down, and hovering the stack pauses it.
  const running=depth===0&&!paused&&!notice.sticky&&!leaving;
  useEffect(()=>{
    if(!running)return;
    started.current=Date.now();
    const timer=setTimeout(()=>close.current(),remaining.current);
    return()=>{clearTimeout(timer);remaining.current=Math.max(0,remaining.current-(Date.now()-started.current));};
  },[running]);
  return <aside className={`notice-card kind-${notice.kind} ${depth?'behind':''} ${leaving?'leaving':''}`} style={{'--depth':depth} as CSSProperties} role={depth===0?'status':undefined} aria-live={depth===0?'polite':undefined} aria-hidden={depth>0||undefined}>
    <span className="notice-art"><NoticeArt kind={notice.kind} art={notice.art}/></span>
    <div className="notice-copy">
      <strong>{notice.title}</strong>
      <p>{notice.detail}</p>
      {notice.action&&<button type="button" className="notice-action" tabIndex={depth?-1:0} onClick={()=>{notice.action!.run();close.current();}}>{notice.action.label}<Icon name="arrow" size={14}/></button>}
    </div>
    <button type="button" className="notice-close" tabIndex={depth?-1:0} aria-label={`Dismiss: ${notice.title}`} onClick={()=>close.current()}><Icon name="close" size={15}/></button>
  </aside>;
}

/** Notices that rise above the account button: newest in front, older ones tucked behind. */
export function NoticeStack({notices,onDismiss}:{notices:Notice[];onDismiss:(id:string)=>void}){
  const [open,setOpen]=useState(false);
  const shown=notices.slice(0,3);
  if(!shown.length)return null;
  return <div className={`notice-stack ${open?'expanded':''}`} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)} onFocus={()=>setOpen(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    {notices.length>1&&<span className="notice-count" aria-label={`${notices.length} notifications`}>{notices.length}</span>}
    {shown.map((notice,i)=><NoticeCard key={notice.id} notice={notice} depth={open?0:i} paused={open} onDismiss={()=>onDismiss(notice.id)}/>).reverse()}
  </div>;
}
