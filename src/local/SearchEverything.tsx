import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Icon} from '../Icons';
import {desktop} from '../desktop/bridge';
import {searchDocs,type SearchDoc,type SearchHit,type Snippet} from '../../core/search';
import type {Chat,Space,StoredFile,StudySet} from '../../core/types';
import './local.css';

export type FolderHit={folderId:string;scope:string;folder:string;path:string;score:number;snippet:Snippet;updated?:number};
export type OpenFolderFile={folderId:string;scope:string;folder:string;path:string;line?:number;query?:string};
type Filter='all'|'chat'|'file'|'folder'|'card'|'space';
const filters:{id:Filter;label:string;icon:string}[]=[
  {id:'all',label:'Everything',icon:'research'},
  {id:'chat',label:'Chats',icon:'chat'},
  {id:'file',label:'Files',icon:'files'},
  {id:'folder',label:'Folders',icon:'projects'},
  {id:'card',label:'Cards',icon:'subjects'},
  {id:'space',label:'Spaces',icon:'skills'},
];
const kindIcon:Record<string,string>={chat:'chat',file:'files',folder:'projects',card:'subjects',space:'skills'};
const TEXT_FILE=15_000_000;

/** Reads a stored file's text once, then reuses it until the file changes. */
async function fileText(file:StoredFile,owner:string,signal:AbortSignal){
  return (await import('../source-context')).cachedFileText(file,owner,signal);
}

export function Marked({snippet}:{snippet:Snippet}){
  const parts:ReactNode[]=[];let at=0;
  snippet.marks.forEach(([a,b],i)=>{if(a>at)parts.push(snippet.text.slice(at,a));parts.push(<mark key={i}>{snippet.text.slice(a,b)}</mark>);at=b;});
  parts.push(snippet.text.slice(at));
  return <>{parts}</>;
}

type Row={key:string;kind:Filter;title:string;where:string;snippet:Snippet;score:number;open:()=>void};

export function SearchEverything({chats,spaces,studySets,files,owner,initialQuery='',scopeLabel,onClose,onOpenChat,onOpenSpace,onOpenFile,onOpenFolderFile}:{
  chats:Chat[];spaces:Space[];studySets:StudySet[];files:StoredFile[];owner:string;initialQuery?:string;scopeLabel:(scope:string)=>string;onClose:()=>void;
  onOpenChat:(chat:Chat)=>void;onOpenSpace:(space:Space)=>void;onOpenFile:(file:StoredFile)=>void;onOpenFolderFile:(file:OpenFolderFile)=>void;
}){
  const [query,setQuery]=useState(initialQuery);
  const [filter,setFilter]=useState<Filter>('all');
  const [active,setActive]=useState(0);
  const [texts,setTexts]=useState<Record<string,string>>({});
  const [reading,setReading]=useState(0);
  const [folderHits,setFolderHits]=useState<FolderHit[]>([]);
  const [folderState,setFolderState]=useState<'idle'|'searching'|'error'>('idle');
  const dialog=useRef<HTMLDialogElement>(null),list=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);

  // File contents are read in the background, a few at a time, so typing never waits on a PDF.
  useEffect(()=>{
    const controller=new AbortController();
    const pending=files.filter(f=>f.size<=TEXT_FILE&&!f.remote);
    setReading(pending.length);
    void (async()=>{
      for(const file of pending){
        if(controller.signal.aborted)return;
        try{const text=await fileText(file,owner,controller.signal);if(!controller.signal.aborted)setTexts(t=>({...t,[file.id]:text}));}
        catch{/* Unreadable files are still found by name. */}
        if(!controller.signal.aborted)setReading(n=>n-1);
      }
    })();
    return()=>controller.abort();
  },[files,owner]);

  useEffect(()=>{
    if(!desktop||query.trim().length<2){setFolderHits([]);setFolderState('idle');return;}
    let live=true;setFolderState('searching');
    const timer=setTimeout(()=>{void desktop!.invoke({action:'folderSearch',query:query.trim()}).then(hits=>{if(live){setFolderHits(hits);setFolderState('idle');}}).catch(()=>{if(live){setFolderHits([]);setFolderState('error');}});},180);
    return()=>{live=false;clearTimeout(timer);};
  },[query]);

  const docs=useMemo(()=>{
    const out:(SearchDoc&{open:()=>void;where:string})[]=[];
    const spaceName=(id:string|null)=>spaces.find(s=>s.id===id)?.name;
    for(const chat of chats)out.push({id:'chat:'+chat.id,kind:'chat',title:chat.title,text:chat.messages.map(m=>m.content).join('\n\n'),updated:chat.updated,where:spaceName(chat.spaceId)||'Conversation',open:()=>onOpenChat(chat)});
    for(const space of spaces)out.push({id:'space:'+space.id,kind:'space',title:space.name,text:[space.description,space.memory].filter(Boolean).join('\n'),where:space.kind==='project'?'Project':'Subject',open:()=>onOpenSpace(space)});
    for(const set of studySets){const space=spaces.find(s=>s.id===set.spaceId);set.items.forEach((item,i)=>out.push({id:`card:${set.id}:${i}`,kind:'card',title:item.question,text:item.answer+(item.choices?'\n'+item.choices.join(' · '):''),meta:set.title,updated:set.created,where:`${set.title} · ${space?.name||'Subject'}`,open:()=>space&&onOpenSpace(space)}));}
    for(const file of files)out.push({id:'file:'+file.id,kind:'file',title:file.name,text:texts[file.id]||'',updated:file.created,where:spaceName(file.spaceId)||'Your files',open:()=>onOpenFile(file)});
    return out;
  },[chats,spaces,studySets,files,texts]);

  const rows=useMemo<Row[]>(()=>{
    if(!query.trim())return [];
    const local=searchDocs(docs,query,80).map((h:SearchHit)=>{const d=h.doc as typeof docs[number];return {key:d.id,kind:d.kind as Filter,title:d.title,where:d.where,snippet:h.snippet,score:h.score,open:d.open};});
    const folders=folderHits.map(h=>({key:'folder:'+h.folderId+':'+h.path,kind:'folder' as Filter,title:h.path,where:`${h.folder} · ${scopeLabel(h.scope)}`,snippet:h.snippet,score:h.score,open:()=>onOpenFolderFile({folderId:h.folderId,scope:h.scope,folder:h.folder,path:h.path,line:h.snippet.line,query})}));
    return [...local,...folders].sort((a,b)=>b.score-a.score);
  },[docs,folderHits,query]);
  const counts=useMemo(()=>{const c:Record<string,number>={all:rows.length};for(const r of rows)c[r.kind]=(c[r.kind]||0)+1;return c;},[rows]);
  const shown=filter==='all'?rows:rows.filter(r=>r.kind===filter);
  useEffect(()=>setActive(0),[query,filter]);
  useEffect(()=>{list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active]);
  const open=(row?:Row)=>{if(!row)return;onClose();setTimeout(row.open,0);};

  return <dialog ref={dialog} className="search-everything" aria-label="Search everything" onClose={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <div className="se-input"><Icon name="research" size={20}/>
      <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search chats, files, folders and cards on this PC…" aria-label="Search everything" role="combobox" aria-expanded="true" aria-controls="se-results"
        onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.max(0,Math.min(shown.length-1,a+1)));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(0,a-1));}else if(e.key==='Enter'){e.preventDefault();open(shown[active]);}else if(e.key==='Tab'&&!e.shiftKey&&query){e.preventDefault();const i=filters.findIndex(f=>f.id===filter);setFilter(filters[(i+1)%filters.length].id);}}}/>
      <kbd>Esc</kbd></div>
    <div className="se-filters" role="tablist" aria-label="Filter results">{filters.filter(f=>f.id!=='folder'||desktop).map(f=><button key={f.id} role="tab" aria-selected={filter===f.id} className={filter===f.id?'active':''} onClick={()=>setFilter(f.id)}><Icon name={f.icon} size={15}/>{f.label}{query&&<span className="se-count">{counts[f.id]||0}</span>}</button>)}</div>
    <div className="se-results" id="se-results" role="listbox" ref={list}>
      {!query.trim()?<div className="se-empty"><Icon name="research" size={34}/><strong>Everything on this PC, in one search.</strong><p>Conversations, uploaded files{desktop?', linked folders':''} and every flashcard. Nothing leaves your computer to search.</p></div>
      :shown.length?shown.map((r,i)=><button key={r.key} role="option" aria-selected={i===active} data-index={i} className={i===active?'active':''} onMouseMove={()=>setActive(i)} onClick={()=>open(r)}>
        <span className={`se-kind kind-${r.kind}`}><Icon name={kindIcon[r.kind]} size={17}/></span>
        <span className="se-body"><span className="se-title">{r.title}</span>{r.snippet.text&&<span className="se-snippet"><Marked snippet={r.snippet}/></span>}<small>{r.where}{r.kind==='folder'&&r.snippet.line?` · line ${r.snippet.line}`:''}</small></span>
      </button>)
      :<p className="se-none">{folderState==='searching'?'Searching your folders…':`Nothing matches “${query}”${filter!=='all'?' here. Try Everything.':'.'}`}</p>}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Tab</kbd> filter</span><span className="se-status">{reading>0?`Reading ${reading} file${reading===1?'':'s'}…`:folderState==='error'?'Folders unavailable':'Searched on this PC'}</span></footer>
  </dialog>;
}
