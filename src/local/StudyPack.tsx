import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {Icon} from '../Icons';
import {getBlob,storeBlob,deleteBlob,download,sizeLabel} from '../store';
import {desktop} from '../desktop/bridge';
import {packStudy,unpackStudy,cardCount,packFileName,PACK_EXTENSION,type StudyPack} from '../../core/study-pack';
import type {Space,SpaceFolder,StoredFile,StudySet} from '../../core/types';
import './share.css';

const pathOf=(folders:SpaceFolder[],id:string|null|undefined)=>{const names:string[]=[];let cur=id||null;while(cur){const f=folders.find(x=>x.id===cur);if(!f)break;names.unshift(f.name);cur=f.parentId;}return names.join('/');};
/** Every folder under `id`, including itself. */
const within=(folders:SpaceFolder[],id:string)=>{const out=new Set([id]);let grew=true;while(grew){grew=false;for(const f of folders)if(f.parentId&&out.has(f.parentId)&&!out.has(f.id)){out.add(f.id);grew=true;}}return out;};

type Result={bytes:Uint8Array;name:string;path?:string;size:number;summary:string};

/**
 * Sharing in one step: pick what goes in (sensible choices are already ticked), press Share,
 * then drag the file straight into WhatsApp, Discord, Teams or an email. Nothing personal —
 * chats, memory, review history — can be included.
 */
export function ShareSheet({space,sets,files,author,folderId,onClose,onDone}:{space:Space;sets:StudySet[];files:StoredFile[];author:string;folderId?:string;onClose:()=>void;onDone:(message:string)=>void}){
  const folders=space.folders||[];
  const top=folders.filter(f=>!f.parentId);
  const cards=sets.filter(s=>s.kind==='flashcards'),quizzes=sets.filter(s=>s.kind==='quiz');
  const loose=files.filter(f=>!f.folderId||!folders.some(x=>x.id===f.folderId));
  const [pick,setPick]=useState(()=>new Set<string>(folderId?['folder:'+(folders.find(f=>f.id===folderId)?.id||'')]:[...(cards.length?['cards']:[]),...(quizzes.length?['quizzes']:[]),...(!sets.length&&loose.length?['loose']:[])]));
  const [showName,setShowName]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const toggle=(k:string)=>setPick(p=>{const n=new Set(p);if(n.has(k))n.delete(k);else n.add(k);return n;});
  const shareFolder=folderId?folders.find(f=>f.id===folderId):undefined;
  const title=shareFolder?`${space.name} — ${shareFolder.name}`:space.name;
  const chosen=useMemo(()=>{
    const chosenSets=[...(pick.has('cards')?cards:[]),...(pick.has('quizzes')?quizzes:[])];
    const ids=new Set<string>();
    for(const f of (shareFolder?[shareFolder]:top))if(pick.has('folder:'+f.id)){const all=within(folders,f.id);for(const file of files)if(file.folderId&&all.has(file.folderId))ids.add(file.id);}
    if(pick.has('loose'))for(const f of loose)ids.add(f.id);
    return {sets:chosenSets,files:files.filter(f=>ids.has(f.id))};
  },[pick,sets,files,folders]);
  const bytes=chosen.files.reduce((n,f)=>n+f.size,0),count=chosen.sets.reduce((n,s)=>n+s.items.length,0);
  const empty=!chosen.sets.length&&!chosen.files.length;
  async function create(){
    setBusy(true);setError('');
    try{
      const blobs:Record<string,Uint8Array>={};
      for(const f of chosen.files){const b=await getBlob(f.id);if(!b)throw Error(f.name+' is missing from this PC.');blobs[f.id]=new Uint8Array(await b.arrayBuffer());}
      const base=shareFolder?pathOf(folders,shareFolder.parentId):'';
      const pack:StudyPack={format:'mowr-study-pack',version:1,title,description:space.description,author:showName&&author.trim()?author.trim():undefined,created:Date.now(),
        sets:chosen.sets.map(s=>({kind:s.kind,title:s.title,items:s.items})),
        files:chosen.files.map(f=>{const p=pathOf(folders,f.folderId);return {id:f.id,name:f.name,type:f.type||'application/octet-stream',size:blobs[f.id].length,folder:(base&&p.startsWith(base+'/')?p.slice(base.length+1):p)||undefined};})};
      const data=await packStudy(pack,blobs);
      const name=packFileName(title);
      const summary=[count?`${count} card${count===1?'':'s'}`:'',chosen.files.length?`${chosen.files.length} file${chosen.files.length===1?'':'s'}`:''].filter(Boolean).join(' · ');
      if(desktop){const saved=await desktop.invoke({action:'shareSave',name,data});setResult({bytes:data,name:saved.name,path:saved.path,size:data.length,summary});}
      else setResult({bytes:data,name,size:data.length,summary});
    }catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}finally{setBusy(false);}
  }
  const close=()=>{if(result)onDone(`Shared ${result.name}`);onClose();};
  return <dialog ref={dialog} className="share-sheet" aria-label={`Share ${title}`} onClose={close} onClick={e=>{if(e.target===dialog.current)close();}}>
    {!result?<>
      <header className="sh-head"><div><span className="sh-eyebrow">Share</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close" onClick={close}><Icon name="close" size={18}/></button></header>
      <div className="sh-body">
        <p className="sh-lead">Choose what your friends get. They open it in Mowr and it becomes their own subject.</p>
        <div className="sh-options">
          {!shareFolder&&cards.length>0&&<Option on={pick.has('cards')} onToggle={()=>toggle('cards')} icon="subjects" tone="cards" title="Flashcards" detail={`${cards.reduce((n,s)=>n+s.items.length,0)} cards in ${cards.length} deck${cards.length===1?'':'s'}`}/>}
          {!shareFolder&&quizzes.length>0&&<Option on={pick.has('quizzes')} onToggle={()=>toggle('quizzes')} icon="check" tone="quiz" title="Quizzes" detail={`${quizzes.length} quiz${quizzes.length===1?'':'zes'}`}/>}
          {(shareFolder?[shareFolder]:top).map(f=>{const n=files.filter(x=>x.folderId&&within(folders,f.id).has(x.folderId)).length;return n?<Option key={f.id} on={pick.has('folder:'+f.id)} onToggle={()=>toggle('folder:'+f.id)} icon="projects" tone="folder" title={f.name} detail={`Folder · ${n} file${n===1?'':'s'}`}/>:null;})}
          {!shareFolder&&loose.length>0&&<Option on={pick.has('loose')} onToggle={()=>toggle('loose')} icon="files" tone="files" title="Other files" detail={`${loose.length} file${loose.length===1?'':'s'} · ${sizeLabel(loose.reduce((n,f)=>n+f.size,0))}`}/>}
        </div>
        <label className="sh-name"><input type="checkbox" checked={showName} onChange={e=>setShowName(e.target.checked)}/>Show “{author||'my name'}” as the sender</label>
        <p className="sh-private"><Icon name="check" size={14}/>Your chats, memory and review progress always stay on this PC.</p>
        {error&&<p className="sh-error" role="alert">{error}</p>}
      </div>
      <footer className="sh-foot"><span>{empty?'Nothing selected':[count?`${count} card${count===1?'':'s'}`:'',chosen.files.length?`${chosen.files.length} file${chosen.files.length===1?'':'s'} · ${sizeLabel(bytes)}`:''].filter(Boolean).join(' · ')}</span><button className="primary" disabled={empty||busy} onClick={()=>void create()}>{busy?'Packing…':'Share'}<Icon name="arrow" size={16}/></button></footer>
    </>:<div className="sh-done">
      <div className="sh-burst" aria-hidden="true">{Array.from({length:14},(_,i)=><i key={i} style={{'--a':`${i*360/14}deg`,'--d':`${i%3*40}ms`} as CSSProperties}/>)}</div>
      <span className="sh-eyebrow">Ready to send</span>
      <h2>Drag it into any chat.</h2>
      <p>WhatsApp, Discord, Teams, email — anywhere you can drop a file.</p>
      <div className="sh-file" draggable={!!result.path} onDragStart={e=>{if(result.path&&desktop?.startDrag){e.preventDefault();desktop.startDrag(result.path);}}} title={result.path?'Drag me':''}>
        <span className="sh-file-icon"><svg viewBox="0 0 144 144" width="26" height="26" fill="currentColor" aria-hidden="true">{[0,90,180,270].map(a=><path key={a} transform={`rotate(${a} 72 72)`} d="M64 11 C87 4 104 20 103 42 C103 57 94 70 84 72 C78 73 79 65 81 61 C85 48 75 43 65 48 C55 52 49 43 49 31 C49 22 54 15 64 11Z"/>)}</svg></span>
        <span><strong>{result.name}</strong><small>{result.summary} · {sizeLabel(result.size)}</small></span>
        {result.path&&<span className="sh-grip" aria-hidden="true">⠿</span>}
      </div>
      <div className="sh-done-actions">
        {result.path?<button onClick={()=>void desktop!.invoke({action:'shareReveal',path:result.path!})}><Icon name="files" size={15}/>Show in folder</button>:null}
        <button onClick={()=>download(new Blob([result.bytes.slice()],{type:'application/zip'}),result.name)}><Icon name="download" size={15}/>Save a copy</button>
        <button className="primary" onClick={close}>Done</button>
      </div>
      {result.path&&<p className="sh-where">Also saved in Downloads\Mowr</p>}
    </div>}
  </dialog>;
}

function Option({on,onToggle,icon,tone,title,detail}:{on:boolean;onToggle:()=>void;icon:string;tone:string;title:string;detail:string}){
  return <button type="button" role="checkbox" aria-checked={on} className={`sh-option t-${tone} ${on?'on':''}`} onClick={onToggle}>
    <span className="sh-option-icon"><Icon name={icon} size={18}/></span>
    <span><strong>{title}</strong><small>{detail}</small></span>
    <span className="sh-check" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
  </button>;
}

export type OpenedPack={name:string;pack:StudyPack;files:Record<string,Uint8Array>};
export async function readPack(bytes:Uint8Array,name:string):Promise<OpenedPack>{
  if(!name.toLowerCase().endsWith(PACK_EXTENSION))throw Error('Choose a '+PACK_EXTENSION+' file.');
  return {name,...await unpackStudy(bytes)};
}

/** Writes a checked pack into the workspace: a new subject, or new sets and folders in an existing one. */
export async function importPack(opened:OpenedPack,owner:string,target:Space|null){
  const spaceId=target?.id||crypto.randomUUID(),ids=new Map(opened.pack.files.map(f=>[f.id,crypto.randomUUID()]));
  const folders:SpaceFolder[]=[...(target?.folders||[])];
  const folderFor=(path?:string)=>{let parent:string|null=null;for(const name of (path||'').split('/').map(s=>s.trim()).filter(Boolean).slice(0,6)){let f=folders.find(x=>x.parentId===parent&&x.name.toLowerCase()===name.toLowerCase());if(!f){f={id:crypto.randomUUID(),name:name.slice(0,80),parentId:parent,created:Date.now()};folders.push(f);}parent=f.id;}return parent;};
  const written:string[]=[];
  try{for(const f of opened.pack.files){const id=ids.get(f.id)!;await storeBlob(id,new Blob([new Uint8Array(opened.files[f.id])],{type:f.type}),owner);written.push(id);}}
  catch(e){await Promise.allSettled(written.map(id=>deleteBlob(id,owner)));throw e;}
  const files:StoredFile[]=opened.pack.files.map(f=>({id:ids.get(f.id)!,name:f.name,size:f.size,type:f.type,created:Date.now(),spaceId,folderId:folderFor(f.folder)}));
  const studySets:StudySet[]=opened.pack.sets.map(s=>({id:crypto.randomUUID(),spaceId,kind:s.kind,title:s.title,items:s.items,created:Date.now(),attempts:[]}));
  const space:Space|null=target?null:{id:spaceId,name:opened.pack.title,kind:'subject',description:opened.pack.description,memory:'',sources:files.map(f=>f.id),folders};
  return {space,spaceId,files,studySets,folders};
}

export function PackPreview({opened,subjects,onImport,onCancel}:{opened:OpenedPack;subjects:Space[];onImport:(target:Space|null)=>Promise<void>;onCancel:()=>void}){
  const [target,setTarget]=useState('new');
  const [busy,setBusy]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const {pack}=opened;
  const folderNames=[...new Set(pack.files.map(f=>f.folder?.split('/')[0]).filter(Boolean))] as string[];
  const loose=pack.files.filter(f=>!f.folder).length;
  return <dialog ref={dialog} className="share-sheet pack-open" aria-label={`Open ${pack.title}`} onClose={onCancel} onClick={e=>{if(e.target===dialog.current)onCancel();}}>
    <div className="po-cover">
      <span className="sh-eyebrow">{pack.author?`${pack.author} shared a subject`:'A shared subject'}</span>
      <h2>{pack.title}</h2>
      {pack.description&&<p>{pack.description}</p>}
      <div className="po-chips">
        {cardCount(pack)>0&&<span><Icon name="subjects" size={14}/>{cardCount(pack)} cards</span>}
        {folderNames.map(n=><span key={n}><Icon name="projects" size={14}/>{n}</span>)}
        {loose>0&&<span><Icon name="files" size={14}/>{loose} file{loose===1?'':'s'}</span>}
      </div>
    </div>
    <div className="sh-body">
      {pack.sets.length>0&&<div className="po-sample">{pack.sets.flatMap(s=>s.items).slice(0,3).map((item,i)=><div key={i} style={{'--i':i} as CSSProperties}><b>{item.question}</b><span>{item.answer}</span></div>)}</div>}
      {subjects.length>0&&<details className="po-where"><summary>{target==='new'?'Adds a new subject':`Adds to ${subjects.find(s=>s.id===target)?.name}`} · change</summary><select value={target} onChange={e=>setTarget(e.target.value)} aria-label="Add to"><option value="new">A new subject: {pack.title}</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></details>}
      <p className="sh-private"><Icon name="check" size={14}/>Checked on this PC. New cards start fresh in your own review schedule.</p>
    </div>
    <footer className="sh-foot"><button className="sh-ghost" onClick={onCancel}>Not now</button><button className="primary" disabled={busy} onClick={()=>{setBusy(true);void onImport(target==='new'?null:subjects.find(s=>s.id===target)||null).finally(()=>setBusy(false));}}>{busy?'Adding…':'Add to Mowr'}<Icon name="arrow" size={16}/></button></footer>
  </dialog>;
}
