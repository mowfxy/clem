import {useId,useMemo,useRef,useState} from 'react';
import {Icon} from '../Icons';
import {money,threadUsage} from '../../core/thread-usage';
import type {Chat,Model,StoredFile,StudySet,VisualRecord} from '../../core/types';
import './thread-info.css';

const compact=(n:number)=>n<1000?String(n):n<1_000_000?`${+(n/1000).toFixed(n<10_000?1:0)}K`:`${+(n/1_000_000).toFixed(1)}M`;
const duration=(ms:number)=>ms<60_000?`${Math.max(1,Math.round(ms/1000))}s`:ms<3_600_000?`${Math.round(ms/60_000)} min`:`${(ms/3_600_000).toFixed(1)} h`;

/** A card of the panel; the ones with a list open and close, as in Claude's side panel. */
function Card({title,value,children,open:start=true}:{title:string;value?:string;children?:React.ReactNode;open?:boolean}){
  const [open,setOpen]=useState(start);
  if(!children)return <section className="ti-card ti-flat"><h3>{title}</h3>{value&&<span className="ti-value">{value}</span>}</section>;
  return <section className="ti-card">
    <button type="button" className="ti-head" aria-expanded={open} onClick={()=>setOpen(!open)}><h3>{title}</h3><svg className="ti-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>{value&&<span className="ti-value">{value}</span>}</button>
    {open&&<div className="ti-body">{children}</div>}
  </section>;
}
function Row({icon,label,value,quiet}:{icon:string;label:string;value:string|number;quiet?:boolean}){
  return <div className={`ti-row${quiet?' quiet':''}`}><Icon name={icon} size={17}/><span>{label}</span><b>{value}</b></div>;
}
/** The names under a count, the first few, so "Read by Clem · 3" says which three. */
function Names({names,onOpen}:{names:{name:string;id?:string}[];onOpen?:(id:string)=>void}){
  const [all,setAll]=useState(false);
  if(!names.length)return null;
  const shown=all?names:names.slice(0,4);
  return <ul className="ti-names">{shown.map((n,i)=><li key={n.id||n.name+i}>{n.id&&onOpen?<button type="button" onClick={()=>onOpen(n.id!)}>{n.name}</button>:<span>{n.name}</span>}</li>)}
    {names.length>4&&<li><button type="button" className="ti-more" onClick={()=>setAll(!all)}>{all?'Show fewer':`${names.length-4} more`}</button></li>}</ul>;
}

/**
 * What a thread used and produced, beside its title: tokens and their rough API price, the time Clem worked, and the
 * files sent, read and made, with the visuals, flashcards and quizzes from it. Tokens are counted from desktop
 * answers since this panel was added; older replies have none, which the panel says.
 */
export function ThreadInfo({chat,files,visuals,studySets,models,onOpenFile}:{chat:Chat;files:StoredFile[];visuals:VisualRecord[];studySets:StudySet[];models:Model[];onOpenFile:(id:string)=>void}){
  const id=useId(),panel=useRef<HTMLDivElement>(null);
  const u=useMemo(()=>threadUsage(chat,{files,visuals,studySets}),[chat,files,visuals,studySets]);
  const modelNames=u.models.map(m=>models.find(x=>x.id===m)?.name||m.replace(/^[a-z]+:/,''));
  const open=(fileId:string)=>{panel.current?.hidePopover();onOpenFile(fileId);};
  const t=u.tokens,parts=[t.input+t.cacheWrite,t.cacheRead,t.output];
  return <>
    <button className="icon-button ti-toggle" popoverTarget={id} aria-label="About this thread" title="About this thread"
      onClick={e=>{const r=e.currentTarget.getBoundingClientRect();if(panel.current){panel.current.style.top=`${r.bottom+8}px`;panel.current.style.right=`${Math.max(12,innerWidth-r.right)}px`;}}}>
      <Icon name="analysis" size={18}/>
    </button>
    <div ref={panel} id={id} popover="auto" className="ti-panel" role="dialog" aria-label="About this thread">
      <Card title="Thread">
        <Row icon="newchat" label="Messages" value={`${u.messages} sent · ${u.replies} replies`}/>
        {u.ms>0&&<Row icon="clock" label="Clem worked" value={duration(u.ms)}/>}
        {u.calls>0&&<Row icon="spark" label="Tool steps" value={u.calls.toLocaleString()}/>}
        {modelNames.length>0&&<Row icon="models" label={modelNames.length>1?'Models':'Model'} value={modelNames.join(', ')}/>}
      </Card>
      <Card title="Tokens" value={u.counted?compact(u.total):'—'}>
        {u.counted?<>
          <div className="ti-bar" role="img" aria-label={`${compact(parts[0])} new input, ${compact(parts[1])} from cache, ${compact(parts[2])} output`}>
            {parts.map((p,i)=><i key={i} className={`p${i}`} style={{flexGrow:p}}/>)}
          </div>
          <div className="ti-legend"><span><i className="p0"/>Input {compact(parts[0])}</span><span><i className="p1"/>Cached {compact(parts[1])}</span><span><i className="p2"/>Output {compact(parts[2])}</span></div>
          <div className="ti-cost"><b>≈ {money(u.cost)}</b><span>at API prices. Your plans aren’t billed per token; this is what the same tokens would cost on the API.</span></div>
          {u.counted<u.replies&&<p className="ti-note">{u.replies-u.counted} earlier {u.replies-u.counted===1?'reply has':'replies have'} no count.</p>}
        </>:<p className="ti-note">Counted from the next reply on.</p>}
      </Card>
      <Card title="Files" value={String(u.sent.length+u.made.length+u.read.length+u.drive)}>
        <Row icon="attach" label="Sent by you" value={u.sent.length} quiet={!u.sent.length}/>
        <Names names={u.sent} onOpen={open}/>
        {u.drive>0&&<Row icon="drive" label="From Google Drive" value={u.drive}/>}
        <Row icon="search" label="Opened by Clem" value={u.read.length} quiet={!u.read.length}/>
        <Names names={u.read.map(name=>({name}))}/>
        <Row icon="download" label="Made by Clem" value={u.made.length} quiet={!u.made.length}/>
        <Names names={u.made} onOpen={open}/>
      </Card>
      <Card title="Made here">
        <Row icon="visuals" label="Visuals" value={u.visuals} quiet={!u.visuals}/>
        <Row icon="cmd-flashcards" label="Flashcards" value={u.flashcards} quiet={!u.flashcards}/>
        <Row icon="cmd-quiz" label="Quizzes" value={u.quizzes} quiet={!u.quizzes}/>
        <Row icon="globe" label="Web pages and searches" value={u.web} quiet={!u.web}/>
      </Card>
    </div>
  </>;
}
