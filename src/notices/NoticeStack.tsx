import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Icon} from '../Icons';
import './notices.css';

export type NoticeKind='switch'|'reset'|'handoff'|'announcement'|'support'|'success'|'warning'|'info'|'reminder';
/** `icon`: a mark that suits this one notice better than its kind's. `also`: a second, quieter action. */
export type Notice={id:string;kind:NoticeKind;title:string;detail:string;action?:{label:string;run:()=>void};also?:{label:string;run:()=>void};sticky?:boolean;icon?:string};

const LIFETIME=9000;
const MARK:Record<NoticeKind,string>={switch:'refresh',reset:'clock',handoff:'send',announcement:'megaphone',support:'mail',success:'check',warning:'alert',info:'spark',reminder:'clock'};

/** Each notice opens with one small mark on a bead of glass: sky by default, ember when it wants attention. */
export function NoticeMark({kind,icon}:{kind:NoticeKind;icon?:string}){
  return <span className={`notice-mark ${kind==='warning'||kind==='reminder'?'hot':''}`}><Icon name={icon||MARK[kind]} size={15}/></span>;
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
    <NoticeMark kind={notice.kind} icon={notice.icon}/>
    <div className="notice-copy">
      <strong>{notice.title}</strong>
      {notice.detail&&<p>{notice.detail}</p>}
      {(notice.action||notice.also)&&<div className="notice-actions">
        {notice.action&&<button type="button" className="notice-action" tabIndex={depth?-1:0} onClick={()=>{notice.action!.run();close.current();}}>{notice.action.label}</button>}
        {notice.also&&<button type="button" className="notice-also" tabIndex={depth?-1:0} onClick={()=>{notice.also!.run();close.current();}}>{notice.also.label}</button>}
      </div>}
    </div>
    <button type="button" className="notice-close" tabIndex={depth?-1:0} aria-label={`Dismiss: ${notice.title}`} onClick={()=>close.current()}><Icon name="close" size={13}/></button>
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
