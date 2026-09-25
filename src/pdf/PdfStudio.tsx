import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {Icon} from '../Icons';
import {getBlob,download} from '../store';
import {confirmDialog} from '../dialogs';
import type {StoredFile} from '../../core/types';
import {openPdf,changedLines,proposePdfEdit,commitPdfEdit,restorePrevious,type PdfProposal} from './pdf-edit';
import './pdf-studio.css';

type Box={page:number;x:number;y:number;w:number;h:number};
const clean=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');

/** Continuous pages, rendered sharp for the screen, with optional highlight boxes. */
export function Pages({pdf,highlights,onSelect}:{pdf:PDFDocumentProxy;highlights:Box[];onSelect?:(text:string)=>void}){
  const host=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(0);
  useEffect(()=>{const el=host.current;if(!el)return;const ro=new ResizeObserver(()=>setWidth(Math.min(920,el.clientWidth-48)));ro.observe(el);return()=>ro.disconnect();},[]);
  const [pages,setPages]=useState<{n:number;w:number;h:number;scale:number}[]>([]);
  useEffect(()=>{
    if(!width)return;let cancelled=false;
    void (async()=>{const out=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const base=p.getViewport({scale:1});const scale=width/base.width;out.push({n,w:width,h:base.height*scale,scale});}if(!cancelled)setPages(out);})();
    return()=>{cancelled=true;};
  },[pdf,width]);
  return <div className="ps-pages" ref={host} onMouseUp={()=>{const s=window.getSelection()?.toString();if(s&&onSelect)onSelect(s.slice(0,8000));}}>
    {pages.map(p=><Page key={p.n} pdf={pdf} n={p.n} w={p.w} h={p.h} scale={p.scale} boxes={highlights.filter(b=>b.page===p.n)}/>)}
  </div>;
}

function Page({pdf,n,w,h,scale,boxes}:{pdf:PDFDocumentProxy;n:number;w:number;h:number;scale:number;boxes:Box[]}){
  const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const [viewportH,setViewportH]=useState(h);
  useEffect(()=>{
    let cancelled=false,task:{cancel:()=>void}|undefined;
    void (async()=>{
      const page=await pdf.getPage(n);const viewport=page.getViewport({scale});const ratio=Math.min(window.devicePixelRatio||1,2);
      const c=canvas.current!;c.width=Math.floor(viewport.width*ratio);c.height=Math.floor(viewport.height*ratio);setViewportH(viewport.height);
      task=page.render({canvas:c,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]}) as unknown as {cancel:()=>void};
      await (task as unknown as {promise:Promise<void>}).promise;
      if(cancelled||!text.current)return;
      const {TextLayer}=await import('pdfjs-dist');text.current.replaceChildren();text.current.style.setProperty('--total-scale-factor',String(scale));
      await new TextLayer({textContentSource:await page.getTextContent(),container:text.current,viewport}).render();
    })().catch(()=>{});
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,n,scale]);
  return <div className="ps-page" style={{width:w,height:viewportH}}>
    <canvas ref={canvas} style={{width:w,height:viewportH}} aria-label={`Page ${n}`}/>
    <div className="ps-text textLayer" ref={text}/>
    {boxes.map((b,i)=><span key={i} className="ps-mark" style={{left:b.x*scale,top:viewportH-(b.y+b.h)*scale,width:b.w*scale,height:b.h*scale,animationDelay:`${i*70}ms`}}/>)}
    <span className="ps-num">{n}</span>
  </div>;
}

const ideas=(made:boolean)=>made?['Make it harder','Add an answer key','Add two more questions','Simplify the wording']:['Fix typos','Change the date to next Friday','Update the numbers in question 1','Make the title clearer'];

/** A PDF, opened to be read and changed. Edits are real: the file itself changes, with undo. */
export default function PdfStudio({file,scope,selection,onClose,onAsk,onChange}:{file:StoredFile;scope:string;selection?:{model?:string;reasoning?:string};onClose:()=>void;onAsk:(text:string)=>void;onChange:(file:StoredFile)=>void}){
  const [bytes,setBytes]=useState<Uint8Array>();
  const [pdf,setPdf]=useState<PDFDocumentProxy>();
  const [error,setError]=useState('');
  const [instruction,setInstruction]=useState('');
  const [working,setWorking]=useState<string|null>(null);
  const [proposal,setProposal]=useState<{p:PdfProposal;pdf:PDFDocumentProxy;boxes:Box[]}|null>(null);
  const [view,setView]=useState<'after'|'before'>('after');
  const [picked,setPicked]=useState('');
  const [flash,setFlash]=useState('');
  const abort=useRef<AbortController|null>(null);
  const [current,setCurrent]=useState(file);
  useEffect(()=>{setCurrent(file);},[file.id]);
  async function load(){const blob=await getBlob(file.id);if(!blob)throw Error('This file is missing from this PC.');const data=new Uint8Array(await blob.arrayBuffer());setBytes(data);setPdf(await openPdf(data));}
  useEffect(()=>{void load().catch(e=>setError(clean(e)));return()=>abort.current?.abort();},[file.id]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(working)abort.current?.abort();else if(!proposal)onClose();}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[working,proposal]);

  async function edit(text=instruction){
    if(!bytes||!text.trim()||working)return;
    const controller=new AbortController();abort.current=controller;
    setWorking('Reading the document…');setError('');setProposal(null);
    try{
      const p=await proposePdfEdit({file:current,bytes,instruction:text.trim(),scope,selection,signal:controller.signal,onProgress:t=>setWorking(t.length<40?'Reading the document…':'Rewriting the page…')});
      setWorking('Setting the new page…');
      const next=await openPdf(p.bytes);
      setProposal({p,pdf:next,boxes:await changedLines(pdf||null,next)});setView('after');
    }catch(e){if(!controller.signal.aborted)setError(clean(e));}
    finally{setWorking(null);}
  }
  async function keep(){
    if(!proposal||!bytes)return;
    try{const saved=await commitPdfEdit(current,bytes,proposal.p);setCurrent(saved);onChange(saved);setBytes(proposal.p.bytes);setPdf(proposal.pdf);setProposal(null);setInstruction('');setFlash('Saved to '+file.name+'. Undo anytime.');setTimeout(()=>setFlash(''),4000);}
    catch(e){setError(clean(e));}
  }
  async function undo(){
    if(!await confirmDialog({title:'Undo the last edit?',message:`“${current.versions?.[0]?.summary}” is removed and the previous version comes back.`,confirm:'Undo edit'}))return;
    try{const restored=await restorePrevious(current);setCurrent(restored);onChange(restored);await load();setFlash('Previous version restored.');setTimeout(()=>setFlash(''),3000);}catch(e){setError(clean(e));}
  }
  const shown=proposal&&view==='after'?proposal.pdf:pdf;
  return <aside className="pdf-studio" role="dialog" aria-label={'PDF: '+file.name}>
    <header className="ps-head">
      <span className="ps-file"><Icon name="files" size={18}/></span>
      <div><strong>{file.name}</strong><small>{current.made?'Made by Mowr':'PDF'}{shown?` · ${shown.numPages} page${shown.numPages===1?'':'s'}`:''}{current.versions?.length?` · edited ${current.versions.length}×`:''}</small></div>
      {!!current.versions?.length&&!proposal&&<button className="ps-ghost" onClick={()=>void undo()}><Icon name="undo" size={15}/>Undo last edit</button>}
      <button className="icon-button" aria-label="Download PDF" disabled={!bytes} onClick={()=>bytes&&download(new Blob([bytes.slice()],{type:'application/pdf'}),file.name)}><Icon name="download" size={18}/></button>
      <button className="icon-button" aria-label="Close PDF" onClick={()=>{abort.current?.abort();onClose();}}><Icon name="close" size={18}/></button>
    </header>
    {proposal&&<div className="ps-proposal" role="status">
      <span className="ps-spark" aria-hidden="true"/>
      <div><strong>{proposal.p.summary}</strong><small>{proposal.boxes.length} line{proposal.boxes.length===1?'':'s'} changed · not saved yet</small></div>
      <div className="ps-toggle" role="group" aria-label="Compare"><button aria-pressed={view==='before'} onClick={()=>setView('before')}>Before</button><button aria-pressed={view==='after'} onClick={()=>setView('after')}>After</button></div>
      <button className="ps-ghost" onClick={()=>{setProposal(null);}}>Discard</button>
      <button className="primary" onClick={()=>void keep()}>Keep changes</button>
    </div>}
    <div className={`ps-body ${working?'working':''}`}>
      {error&&<p className="ps-error" role="alert">{error}</p>}
      {shown?<Pages pdf={shown} highlights={proposal&&view==='after'?proposal.boxes:[]} onSelect={setPicked}/>:!error&&<p className="ps-note">Opening…</p>}
      {working&&<div className="ps-working"><span className="ps-scan" aria-hidden="true"/><strong>{working}</strong><small>Mowr is editing {file.name}</small><button className="ps-ghost" onClick={()=>abort.current?.abort()}>Stop</button></div>}
    </div>
    {flash&&<div className="ps-flash" role="status"><Icon name="check" size={15}/>{flash}</div>}
    {!proposal&&<form className="ps-ask" onSubmit={e=>{e.preventDefault();void edit();}}>
      {picked?<div className="ps-picked"><span>“{picked.slice(0,90)}{picked.length>90?'…':''}”</span><button type="button" onClick={()=>onAsk(`File: ${file.name}\nSelected text:\n${picked}`)}>Ask in chat</button><button type="button" onClick={()=>setInstruction(`Change “${picked.slice(0,160)}” to `)}>Change this</button><button type="button" aria-label="Clear selection" onClick={()=>setPicked('')}><Icon name="close" size={13}/></button></div>
        :<div className="ps-ideas">{ideas(!!current.made).map(i=><button type="button" key={i} onClick={()=>setInstruction(i)}>{i}</button>)}</div>}
      <div className="ps-input"><Icon name="chat" size={17}/><input value={instruction} disabled={!!working} onChange={e=>setInstruction(e.target.value)} placeholder="Tell Mowr what to change in this PDF…" aria-label="Describe the change to this PDF"/><button className="primary" disabled={!instruction.trim()||!!working||!bytes}>Edit PDF<Icon name="arrow" size={15}/></button></div>
      <p className="fine">{current.made?'Mowr re-typesets the pages it made, keeping the design.':'Mowr re-sets the changed lines in place and leaves the rest of each page untouched.'} You review every change before it is saved.</p>
    </form>}
  </aside>;
}
