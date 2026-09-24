import {useEffect,useRef,useState,type CSSProperties} from 'react';
import './notices.css';

export type NoticeKind='switch'|'reset'|'handoff'|'announcement'|'support'|'success'|'warning'|'info';
export type Notice={id:string;kind:NoticeKind;title:string;detail:string;action?:{label:string;run:()=>void};sticky?:boolean};

const LIFETIME=9000;

/** Small drawn scenes; each kind has its own motion so a glance tells you what happened. */
export function NoticeArt({kind}:{kind:NoticeKind}){
  if(kind==='switch')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-draw" d="M11 16h15l-4-4M29 24H14l4 4"/></svg>;
  if(kind==='reset')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-sweep" d="M20 5a15 15 0 0 1 15 15"/><path className="n-draw" d="m13 20 5 5 9-10"/></svg>;
  if(kind==='handoff')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><circle className="n-orbit" cx="20" cy="5" r="2.4"/><path className="n-draw" d="M13 20h14m-5-5 5 5-5 5"/></svg>;
  if(kind==='announcement')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-draw" d="M12 18v5h3l8 5V13l-8 5z"/><path className="n-wave" d="M27 16.5a5 5 0 0 1 0 8"/></svg>;
  if(kind==='support')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-draw" d="M12 14h16v10h-8l-5 4v-4h-3z"/><circle className="n-dot d1" cx="16.5" cy="19" r="1.2"/><circle className="n-dot d2" cx="20" cy="19" r="1.2"/><circle className="n-dot d3" cx="23.5" cy="19" r="1.2"/></svg>;
  if(kind==='warning')return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-draw" d="M20 12v10M20 27v.5"/></svg>;
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle className="n-ring" cx="20" cy="20" r="15"/><path className="n-draw" d="m13 20 5 5 9-10"/><circle className="n-spark" cx="33" cy="8" r="1.8"/></svg>;
}

function NoticeCard({notice,depth,onDismiss,paused}:{notice:Notice;depth:number;onDismiss:()=>void;paused:boolean}){
  const [leaving,setLeaving]=useState(false);
  const remaining=useRef(LIFETIME),started=useRef(Date.now());
  const close=useRef(()=>{});
  close.current=()=>{setLeaving(true);setTimeout(onDismiss,220);};
  // Only the front card counts down, and hovering the stack pauses it.
  const running=depth===0&&!paused&&!notice.sticky&&!leaving;
  useEffect(()=>{
    if(!running)return;
    started.current=Date.now();
    const timer=setTimeout(()=>close.current(),remaining.current);
    return()=>{clearTimeout(timer);remaining.current=Math.max(0,remaining.current-(Date.now()-started.current));};
  },[running]);
  return <aside className={`notice-card kind-${notice.kind} ${depth?'behind':''} ${leaving?'leaving':''}`} style={{'--depth':depth} as CSSProperties} role={depth===0?'status':undefined} aria-live={depth===0?'polite':undefined} aria-hidden={depth>0||undefined}>
    <span className="notice-sheen" aria-hidden="true"/>
    <span className="notice-art"><NoticeArt kind={notice.kind}/></span>
    <div className="notice-copy">
      <strong>{notice.title}</strong>
      <p>{notice.detail}</p>
      {notice.action&&<button type="button" className="notice-action" tabIndex={depth?-1:0} onClick={()=>{notice.action!.run();close.current();}}>{notice.action.label}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8h9m-3.5-3.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>}
    </div>
    <button type="button" className="notice-close" tabIndex={depth?-1:0} aria-label={`Dismiss: ${notice.title}`} onClick={()=>close.current()}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></button>
    {!notice.sticky&&depth===0&&<span className={`notice-timer ${running?'':'paused'}`} style={{animationDuration:LIFETIME+'ms'}} aria-hidden="true"/>}
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
