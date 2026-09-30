import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Icon} from '../Icons';
import {desktop} from '../desktop/bridge';
import {queryTerms,fold} from '../../core/search';
import type {OpenFolderFile} from './SearchEverything';
import './local.css';

type Folder={id:string;scope:string;path:string};
type Tree={id:string;scope:string;path:string;files:{path:string;size:number;mtime:number}[]};
const clean=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const baseName=(p:string)=>p.split(/[\\/]/).filter(Boolean).pop()||p;

/**
 * Linked folders, browsed and read inside Mowr. Files open read-only; changes are asked for in
 * words and come back as a diff to approve, exactly like any other proposed edit.
 */
export function FolderBrowser({initial,folderId:startFolder,scopeLabel,onAsk,onClose}:{initial?:OpenFolderFile;folderId?:string;scopeLabel:(scope:string)=>string;onAsk:(file:OpenFolderFile,instruction:string)=>void;onClose:()=>void}){
  const [folders,setFolders]=useState<Folder[]|null>(null);
  const [folderId,setFolderId]=useState(initial?.folderId||startFolder||'');
  const [tree,setTree]=useState<Tree|null>(null);
  const [filter,setFilter]=useState('');
  const [open,setOpen]=useState<OpenFolderFile|null>(initial||null);
  const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{void desktop!.invoke({action:'foldersAll'}).then((list:Folder[])=>{setFolders(list);setFolderId(id=>id||list[0]?.id||'');}).catch(e=>setError(clean(e)));},[]);
  useEffect(()=>{
    if(!folderId)return;
    let live=true;setTree(null);setError('');
    void desktop!.invoke({action:'folderTree',id:folderId}).then(t=>{if(live)setTree(t);}).catch(e=>{if(live)setError(clean(e));});
    return()=>{live=false;};
  },[folderId]);
  const visible=useMemo(()=>{const q=fold(filter.trim());return (tree?.files||[]).filter(f=>!q||fold(f.path).includes(q));},[tree,filter]);
  const folder=folders?.find(f=>f.id===folderId);
  return <dialog ref={dialog} className="folder-browser" aria-label="Folders on this PC" onClose={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <header className="fb-head">
      <div><span className="eyebrow">On this PC</span><h2>{open?baseName(open.path):folder?baseName(folder.path):'Linked folders'}</h2>{folder&&<p aria-description={folder.path}>{folder.path} · {scopeLabel(folder.scope)}</p>}</div>
      <button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button>
    </header>
    <div className="fb-layout">
      <aside className="fb-side">
        {folders&&folders.length>1&&<label className="fb-select">Folder<select value={folderId} onChange={e=>{setFolderId(e.target.value);setOpen(null);}}>{folders.map(f=><option key={f.id} value={f.id}>{baseName(f.path)} — {scopeLabel(f.scope)}</option>)}</select></label>}
        <div className="fb-filter"><Icon name="research" size={15}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files"/></div>
        <div className="fb-files" role="list">
          {folders&&!folders.length&&<p className="fb-note">No folders linked yet. Link one from a chat, project or subject in Settings → Linked folders.</p>}
          {folderId&&!tree&&!error&&<p className="fb-note">Reading folder…</p>}
          {visible.map(f=>{const parts=f.path.split(/[\\/]/);return <button role="listitem" key={f.path} className={open?.path===f.path&&open.folderId===folderId?'active':''} onClick={()=>tree&&setOpen({folderId:tree.id,scope:tree.scope,folder:baseName(tree.path),path:f.path})} aria-description={f.path}>
            <Icon name="files" size={15}/><span>{parts.length>1&&<i>{parts.slice(0,-1).join('/')}/</i>}{parts.at(-1)}</span></button>;})}
          {tree&&!visible.length&&<p className="fb-note">{tree.files.length?'No file matches that filter.':'No text or code files in this folder.'}</p>}
        </div>
        {tree&&<p className="fb-count">{tree.files.length} readable file{tree.files.length===1?'':'s'} · secrets and hidden files are skipped</p>}
      </aside>
      <section className="fb-main">
        {open?<FileViewer key={open.folderId+open.path} file={open} onAsk={instruction=>{onAsk(open,instruction);onClose();}}/>
          :<div className="fb-empty"><Icon name="files" size={34}/><strong>Choose a file to read it here.</strong><p>Files stay where they are. Mowr only writes a change after you approve its diff, and every change can be undone.</p></div>}
        {error&&<p className="fb-error" role="alert">{error}</p>}
      </section>
    </div>
  </dialog>;
}

const suggestions=['Fix typos and grammar','Add a short summary at the top','Turn this into a checklist'];

export function FileViewer({file,onAsk}:{file:OpenFolderFile;onAsk:(instruction:string)=>void}){
  const [text,setText]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [instruction,setInstruction]=useState('');
  const body=useRef<HTMLDivElement>(null);
  useEffect(()=>{let live=true;void desktop!.invoke({action:'folderFileRead',scope:file.scope,path:file.path}).then(r=>{if(live)setText(r.text);}).catch(e=>{if(live)setError(clean(e));});return()=>{live=false;};},[file.scope,file.path]);
  const terms=useMemo(()=>queryTerms(file.query||''),[file.query]);
  const lines=useMemo(()=>(text??'').split(/\r?\n/),[text]);
  useEffect(()=>{if(text!==null&&file.line)body.current?.querySelector<HTMLElement>(`[data-line="${file.line}"]`)?.scrollIntoView({block:'center'});},[text,file.line]);
  const highlight=(line:string)=>{
    if(!terms.length)return line||' ';
    const f=fold(line),out:ReactNode[]=[];let at=0,k=0;
    while(at<line.length){let next=-1,len=0;for(const t of terms){const i=f.indexOf(t,at);if(i>=0&&(next<0||i<next)){next=i;len=t.length;}}
      if(next<0){out.push(line.slice(at));break;}out.push(line.slice(at,next),<mark key={k++}>{line.slice(next,next+len)}</mark>);at=next+len;}
    return out.length?out:' ';
  };
  const submit=(value=instruction)=>{if(value.trim())onAsk(value.trim());};
  return <div className="file-viewer">
    <div className="fv-meta"><span aria-description={file.path}>{file.path}</span>{text!==null&&<small>{lines.length} lines · read-only</small>}</div>
    <div className="fv-body" ref={body} tabIndex={0} aria-label={`Contents of ${file.path}`}>
      {error?<p className="fb-error">{error}</p>:text===null?<p className="fb-note">Opening…</p>:
        <table><tbody>{lines.map((l,i)=><tr key={i} data-line={i+1} className={file.line===i+1?'target':''}><td>{i+1}</td><td><code>{highlight(l)}</code></td></tr>)}</tbody></table>}
    </div>
    <form className="fv-ask" onSubmit={e=>{e.preventDefault();submit();}}>
      <div className="fv-suggest">{suggestions.map(s=><button type="button" key={s} onClick={()=>setInstruction(s)}>{s}</button>)}</div>
      <div className="fv-input"><Icon name="chat" size={17}/><input value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder={`Tell Mowr what to change in ${baseName(file.path)}…`} aria-label="Describe the change"/>
        <button type="button" className="secondary" onClick={()=>onAsk('')} aria-description="Ask a question about this file">Ask about it</button>
        <button className="primary" disabled={!instruction.trim()||text===null}>Propose change<Icon name="arrow" size={15}/></button></div>
      <p className="fine">Mowr drafts a diff in the chat. Nothing is written until you press Apply.</p>
    </form>
  </div>;
}

/** The Files page's view of linked folders: what Mowr can read, and whether it is watching. */
export function PcFolders({scopeLabel,onBrowse}:{scopeLabel:(scope:string)=>string;onBrowse:(folderId?:string)=>void}){
  const [folders,setFolders]=useState<Folder[]|null>(null);
  const [watch,setWatch]=useState(true);
  useEffect(()=>{void desktop!.invoke({action:'foldersAll'}).then(setFolders).catch(()=>setFolders([]));void desktop!.invoke({action:'folderWatch'}).then(r=>setWatch(r.enabled)).catch(()=>{});},[]);
  if(!folders)return null;
  return <section className="pc-folders">
    <h2>Folders on this PC</h2>
    <p>{folders.length?'Read any file here, then tell Mowr what to change. Files stay in place.':'Link a folder from a chat, project or subject (Settings → Linked folders) to read and change its files here.'}</p>
    {folders.map(f=><div className="pc-folder-row" key={f.id}><Icon name="projects" size={22}/><div><strong>{baseName(f.path)}</strong><small aria-description={f.path}>{f.path} · {scopeLabel(f.scope)}</small></div>{watch&&<span className="watch-badge">Watching for changes</span>}<button className="secondary" onClick={()=>onBrowse(f.id)}>Browse</button></div>)}
  </section>;
}

export function FolderWatchSetting({onBrowse}:{onBrowse:()=>void}){
  const [state,setState]=useState<{enabled:boolean;watching:number}|null>(null);
  useEffect(()=>{void desktop!.invoke({action:'folderWatch'}).then(setState).catch(()=>{});},[]);
  const toggle=(enabled:boolean)=>void desktop!.invoke({action:'folderWatch',enabled}).then(setState).catch(()=>{});
  return <>
    <div className="setting-row v2"><div className="setting-row-text"><h3>Watch for changes</h3><p>When a file in a linked folder changes outside Mowr, offer to update flashcards or summarize what changed.{state?.enabled&&state.watching?` Watching ${state.watching} folder${state.watching===1?'':'s'}.`:''}</p></div><div className="setting-row-control"><label className="mw-switch"><input type="checkbox" role="switch" aria-label="Watch linked folders" checked={!!state?.enabled} disabled={!state} onChange={e=>toggle(e.target.checked)}/><span aria-hidden="true"/></label></div></div>
    <div className="setting-row v2"><div className="setting-row-text"><h3>Read your files in Mowr</h3><p>Browse linked folders, open any text or code file and ask for a change.</p></div><div className="setting-row-control"><button className="secondary" onClick={onBrowse}>Browse files</button></div></div>
  </>;
}
