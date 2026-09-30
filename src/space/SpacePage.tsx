import {useEffect,useMemo,useRef,useState,type DragEvent,type ReactNode} from 'react';
import {Icon} from '../Icons';
import {SpaceMark} from './SpaceMark';
import {RenameField,PencilIcon} from '../files/RenameField';
import {FileGlyph} from '../files/FileGlyph';
import {SubjectStudy,weakConcepts} from '../SubjectStudy';
import {isDue} from '../../core/srs';
import {chatPreview} from '../../core/chat-title';
import {sizeLabel} from '../store';
import {confirmDialog} from '../dialogs';
import {desktop} from '../desktop/bridge';
import {MemoryConversation,warmMemory} from '../MemoryConversation';
import {InstructionsDialog,InstructionsGlyph,DescriptionDialog} from './InstructionsDialog';
import type {Chat,Space,SpaceFolder,StoredFile,StudySet} from '../../core/types';
import {DriveFolderView} from '../drive/DriveFolderView';
import type {DriveItem} from '../drive/drive';
import './space.css';

export type SpaceTab='overview'|'chats'|'flashcards'|'quizzes'|'files'|'memory';
type Linked={id:string;scope:string;path:string};
export type SpaceActions={
  onAsk:(prompt:string)=>void;
  /** Opens a chat in this space with the message ready to review and send. */
  onDraft:(prompt:string)=>void;
  onOpenChat:(chat:Chat)=>void;
  onOpenFile:(file:StoredFile)=>void;
  /** Opens the file beside a new chat in this space, where messages edit it. */
  onEditFile:(file:StoredFile)=>void;
  onRenameFile:(file:StoredFile,name:string)=>void;
  /** A Google Drive folder linked to this space, read live (never downloaded). */
  onLinkDrive:()=>void; onUnlinkDrive:()=>void; onDriveSaveBack:(on:boolean)=>void; onDriveSeen:()=>void;
  onOpenDrive:(file:DriveItem)=>void; onAskDrive:(files:DriveItem[])=>void; onDriveItems:(items:DriveItem[])=>void;
  onStudyNew:(kind:'flashcards'|'summary')=>void;
  onUpload:(files:FileList,folderId:string|null)=>void;
  onMake:(kind:'flashcards'|'quiz'|'worksheet'|'summary',folderId?:string|null)=>void;
  onShare:(folderId?:string)=>void;
  onUpdateSpace:(next:Space)=>void;
  onUpdateFiles:(fn:(files:StoredFile[])=>StoredFile[])=>void;
  onDeleteFile:(file:StoredFile)=>Promise<void>;
  onUpdateSet:(set:StudySet)=>void;
  onDeleteSet:(id:string)=>void;
  onExport:()=>void;
  onDelete:()=>void;
  onBrowseLinked:(folderId?:string)=>void;
  onBack:()=>void;
};

const DAY=86_400_000;
const dayKey=(t:number)=>new Date(t).toDateString();
/** Days in a row, ending today or yesterday, on which at least one card was reviewed. */
function streak(sets:StudySet[],now:number){
  const days=new Set(sets.flatMap(s=>(s.cards||[]).flatMap(c=>c?.reps?[dayKey(c.last)]:[])).concat(sets.flatMap(s=>s.attempts.map(a=>dayKey(a.at)))));
  let n=0,t=days.has(dayKey(now))?now:now-DAY;
  while(days.has(dayKey(t))){n++;t-=DAY;}
  return n;
}
const ago=(t:number)=>{const d=Math.floor((Date.now()-t)/DAY);return d<=0?'today':d===1?'yesterday':d<7?`${d} days ago`:new Date(t).toLocaleDateString([], {month:'short',day:'numeric'});};

function Ring({value,size=58}:{value:number;size?:number}){
  const r=size/2-5,c=2*Math.PI*r;
  return <svg className="sp-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={size/2} cy={size/2} r={r} className="track"/><circle cx={size/2} cy={size/2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c*(1-value)} transform={`rotate(-90 ${size/2} ${size/2})`}/></svg>;
}

function Menu({label,items,trigger}:{label:string;items:{label:string;icon?:string;danger?:boolean;run:()=>void}[];trigger?:ReactNode}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
  return <div className="sp-menu" ref={root}><button type="button" className={trigger?'sp-menu-trigger':'icon-button'} aria-label={label} aria-expanded={open} onClick={e=>{e.stopPropagation();setOpen(!open);}}>{trigger||<Icon name="menu" size={16}/>}</button>
    {open&&<div className="sp-menu-list" role="menu">{items.map(i=><button type="button" role="menuitem" key={i.label} className={i.danger?'danger':''} onClick={e=>{e.stopPropagation();setOpen(false);i.run();}}>{i.icon&&<Icon name={i.icon} size={15}/>}{i.label}</button>)}</div>}</div>;
}

export function SpacePage({space,chats,files,sets,tab,onTab,actions}:{space:Space;chats:Chat[];files:StoredFile[];sets:StudySet[];tab:SpaceTab;onTab:(tab:SpaceTab)=>void;actions:SpaceActions}){
  const subject=space.kind==='subject';
  const now=Date.now();
  const cards=sets.flatMap(s=>s.items.map((_,i)=>s.cards?.[i]||undefined));
  const due=cards.filter(c=>c?.reps&&isDue(c,now)).length,fresh=cards.filter(c=>!c?.reps).length;
  const mastery=cards.length?cards.filter(c=>c&&c.stability>=21).length/cards.length:0;
  const seen=cards.length?cards.filter(c=>c?.reps).length/cards.length:0;
  const days=streak(sets,now);
  const weak=weakConcepts(sets);
  const [ask,setAsk]=useState('');
  const [review,setReview]=useState(0);
  const [instructions,setInstructions]=useState(false),[describing,setDescribing]=useState(false);
  const tabs:[SpaceTab,string,number?][]=subject?[['overview','Overview'],['chats','Chats',chats.length],['flashcards','Flashcards',sets.filter(s=>s.kind==='flashcards').reduce((n,s)=>n+s.items.length,0)],['quizzes','Quizzes',sets.filter(s=>s.kind==='quiz').length],['files','Files',files.length]]:[['overview','Overview'],['chats','Chats',chats.length],['files','Files',files.length]];
  if(desktop)tabs.push(['memory','Memory']);
  const recentChats=[...chats].sort((a,b)=>b.updated-a.updated);
  const recentFiles=[...files].sort((a,b)=>(b.updated||b.created)-(a.updated||a.created));
  const startReview=()=>{onTab('flashcards');setReview(n=>n+1);};
  useEffect(()=>warmMemory(),[]);

  return <div className={`space-page ${subject?'is-subject':'is-project'}`}>
    <div className="sp-top">
    <header className="sp-hero">
      <button className="sp-crumb" onClick={actions.onBack}><Icon name="arrow" size={13}/>{subject?'Subjects':'Projects'}</button>
      <div className="sp-title-row">
        <div className="sp-title">
          <Editable className="sp-name" value={space.name} max={100} label="Name" onSave={name=>actions.onUpdateSpace({...space,name})}/>
          {space.description&&<p className="sp-desc">{space.description}</p>}
        <div className="sp-actions">
          <button className={`sp-instructions ${space.memory.trim()?'set':''}`} onClick={()=>setInstructions(true)} aria-description={space.memory.trim()?'Edit the instructions Mowr follows here':'Tell Mowr how to work here'}><InstructionsGlyph/>Instructions</button>
          <button className="sp-share" onClick={()=>actions.onShare()}><Icon name="import" size={16}/>Share</button>
          <Menu label="More" items={[{label:space.description?'Edit description':'Add a description',icon:'cmd-notes',run:()=>setDescribing(true)},...(subject?[{label:'Export subject ZIP',icon:'download',run:actions.onExport}]:[]),{label:`Delete ${space.kind}`,icon:'trash',danger:true,run:actions.onDelete}]}/>
        </div>
        </div>
        <span className="sp-art" aria-hidden="true"><SpaceMark space={space} size={92} bare/></span>
      </div>
      {subject&&<div className="sp-stats">
        <button className={`sp-stat due ${due?'hot':''}`} onClick={startReview} disabled={!due&&!fresh}>
          <span className="sp-stat-icon"><Icon name="subjects" size={16}/></span>
          <span><b>{due?`${due} due`:fresh?`${fresh} new`:'All caught up'}</b><small>{due||fresh?'Review now':'Nothing to review'}</small></span>
        </button>
        <div className="sp-stat mastery"><Ring value={mastery} size={40}/><span><b>{Math.round(mastery*100)}% mastered</b><small>{Math.round(seen*100)}% seen · {cards.length} cards</small></span></div>
        <div className="sp-stat streak"><span className={`sp-stat-icon flame ${days?'lit':''}`}><Icon name="flame" size={16}/></span><span><b>{days} day streak</b><small>{days?'Keep it going today':'Review to start one'}</small></span></div>
      </div>}
      <form className="sp-ask" onSubmit={e=>{e.preventDefault();if(ask.trim()){actions.onAsk(ask.trim());setAsk('');}}}>
        <Icon name="chat" size={18}/>
        <input value={ask} onChange={e=>setAsk(e.target.value)} placeholder={subject?`Ask anything about ${space.name}…`:`Work on ${space.name}…`} aria-label={`Ask about ${space.name}`}/>
        <button className="primary" disabled={!ask.trim()} aria-label="Start chat"><Icon name="arrow" size={16}/></button>
      </form>
      <nav className="sp-tabs" role="tablist" aria-label={`${space.name} sections`}>
        {tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>{setReview(0);onTab(id);}}>{label}{count!==undefined&&count>0&&<span>{count}</span>}</button>)}
      </nav>
    </header>
    </div>

    <div className="sp-body" key={tab}>
      {tab==='overview'&&!!space.drive?.fresh?.length&&<div className="sp-drive-news" role="status">
        <DriveGlyph/>
        <div><b>{space.drive.fresh.length} new in Drive · {space.drive.folderName}</b><small>{space.drive.fresh.slice(0,3).map(f=>f.name).join(' · ')}</small></div>
        {subject&&<button onClick={()=>actions.onStudyNew('flashcards')}>Make flashcards</button>}
        <button onClick={()=>actions.onStudyNew('summary')}>Update summary</button>
        <button className="sp-drive-dismiss" aria-label="Dismiss" onClick={actions.onDriveSeen}><Icon name="close" size={14}/></button>
      </div>}
      {tab==='overview'&&<div className="sp-overview">
        {subject&&<section className="sp-card today">
          <div><span className="sp-eyebrow">Today</span><h3>{due?`${due} card${due===1?'':'s'} ready for review`:fresh?`${Math.min(fresh,20)} new card${Math.min(fresh,20)===1?'':'s'} to learn`:'You are all caught up'}</h3>
            <p>Mowr brings each card back just before you would forget it.</p></div>
          <button className="primary" disabled={!due&&!fresh} onClick={startReview}>Start review<Icon name="arrow" size={16}/></button>
        </section>}
        <section className="sp-card make">
          <span className="sp-eyebrow">Make something</span>
          <div className="sp-make">
            {subject&&<button onClick={()=>actions.onMake('flashcards')}><span className="mk mk-cards"><Icon name="subjects" size={20}/></span><b>Flashcards</b><small>From your files and chats</small></button>}
            {subject&&<button onClick={()=>actions.onMake('quiz')}><span className="mk mk-quiz"><Icon name="check" size={20}/></span><b>Quiz</b><small>Checked, then scheduled</small></button>}
            <button onClick={()=>actions.onMake('worksheet')}><span className="mk mk-sheet"><Icon name="files" size={20}/></span><b>Worksheet</b><small>A PDF, saved to Worksheets</small></button>
            <button onClick={()=>actions.onMake('summary')}><span className="mk mk-sum"><Icon name="long" size={20}/></span><b>Summary</b><small>Every topic, complete and accurate</small></button>
          </div>
        </section>
        {subject&&weak.length>0&&<section className="sp-card weak">
          <span className="sp-eyebrow">Keeps slipping</span>
          <ul>{weak.slice(0,4).map(q=><li key={q}><span>{q}</span><button onClick={()=>actions.onAsk(`Explain this again in a different way, then check me with one question: ${q}`)}>Explain again</button></li>)}</ul>
        </section>}
        <section className="sp-card recent">
          <div className="sp-card-head"><span className="sp-eyebrow">Recent chats</span><button onClick={()=>onTab('chats')}>All chats</button></div>
          {recentChats.slice(0,4).map(c=><button className="sp-row" key={c.id} onClick={()=>actions.onOpenChat(c)}><Icon name="chat" size={16}/><span>{c.title}</span><small>{ago(c.updated)}</small></button>)}
          {!chats.length&&<p className="sp-empty-line">Ask your first question above.</p>}
        </section>
        <section className="sp-card recent">
          <div className="sp-card-head"><span className="sp-eyebrow">Recent files</span><button onClick={()=>onTab('files')}>All files</button></div>
          {recentFiles.slice(0,4).map(f=><button className="sp-row" key={f.id} onClick={()=>actions.onOpenFile(f)}><FileGlyph file={f} size={26}/><span>{f.name}</span><small>{ago(f.updated||f.created)}</small></button>)}
          {!files.length&&<p className="sp-empty-line">Add notes, slides or worksheets in Files.</p>}
        </section>
      </div>}

      {tab==='chats'&&<ChatList chats={recentChats} onOpen={actions.onOpenChat} onNew={()=>actions.onAsk('')}/>}
      {tab==='flashcards'&&<SubjectStudy key="cards" kind="flashcards" autoStart={review} sets={sets.filter(s=>s.kind==='flashcards')} onGenerate={k=>actions.onDraft(`/${k} Create a study set from this subject’s sources.`)} onUpdate={actions.onUpdateSet} onDelete={actions.onDeleteSet}/>}
      {tab==='quizzes'&&<SubjectStudy key="quiz" kind="quiz" sets={sets.filter(s=>s.kind==='quiz')} onGenerate={k=>actions.onDraft(`/${k} Create a study set from this subject’s sources.`)} onUpdate={actions.onUpdateSet} onDelete={actions.onDeleteSet}/>}
      {tab==='files'&&<FilesView space={space} files={files} actions={actions}/>}
      {tab==='memory'&&desktop&&<section className="sp-memory"><span className="sp-eyebrow">What Mowr remembers here</span><MemoryConversation home={`${space.kind}:${space.id}`} only labelFor={()=>space.name} empty={`Details you share in this ${space.kind}'s chats, like deadlines or goals, appear here.`}/></section>}
    </div>
    {instructions&&<InstructionsDialog space={space} onSave={memory=>actions.onUpdateSpace({...space,memory})} onClose={()=>setInstructions(false)}/>}
    {describing&&<DescriptionDialog space={space} onSave={description=>actions.onUpdateSpace({...space,description})} onClose={()=>setDescribing(false)}/>}
  </div>;
}

function Editable({value,onSave,className,max,label,placeholder}:{value:string;onSave:(v:string)=>void;className:string;max:number;label:string;placeholder?:string}){
  const [editing,setEditing]=useState(false),[text,setText]=useState(value);
  useEffect(()=>setText(value),[value]);
  const commit=()=>{setEditing(false);const next=text.trim();if(next!==value&&(next||label!=='Name'))onSave(next);else setText(value);};
  return editing?<input className={className+' editing'} autoFocus value={text} maxLength={max} aria-label={label} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape'){setText(value);setEditing(false);}}}/>
    :<button className={className} aria-description={`Edit ${label.toLowerCase()}`} onClick={()=>setEditing(true)}>{value||<span className="placeholder">{placeholder}</span>}</button>;
}


function ChatList({chats,onOpen,onNew}:{chats:Chat[];onOpen:(c:Chat)=>void;onNew:()=>void}){
  const [q,setQ]=useState('');
  const shown=chats.filter(c=>!q||(c.title+' '+(c.summary||'')+' '+c.messages.map(m=>m.content).join(' ')).toLowerCase().includes(q.toLowerCase()));
  return <section className="sp-list">
    <div className="sp-toolbar"><div className="sp-search"><Icon name="research" size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search these chats" aria-label="Search chats"/></div><button className="primary" onClick={onNew}><Icon name="plus" size={15}/>New chat</button></div>
    {shown.map(c=>{const last=chatPreview(c);return <button key={c.id} className="sp-chat" onClick={()=>onOpen(c)}><strong>{c.title}</strong>{last&&<span>{last}</span>}<small>{ago(c.updated)} · {c.messages.length} messages</small></button>;})}
    {!shown.length&&<p className="sp-empty-line">{q?'No chat matches.':'No chats yet.'}</p>}
  </section>;
}

function FilesView({space,files,actions}:{space:Space;files:StoredFile[];actions:SpaceActions}){
  const folders=space.folders||[];
  const [at,setAt]=useState<string|null>(null);
  const [naming,setNaming]=useState<{id?:string;name:string}|null>(null);
  const [over,setOver]=useState<string|null>(null);
  const [linked,setLinked]=useState<Linked[]>([]);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!desktop)return;void desktop.invoke({action:'folders',scope:`${space.kind}:${space.id}`}).then(setLinked).catch(()=>{});},[space.id]);
  useEffect(()=>{if(at&&!folders.some(f=>f.id===at))setAt(null);},[folders,at]);
  const path=useMemo(()=>{const out:SpaceFolder[]=[];let id=at;while(id){const f=folders.find(x=>x.id===id);if(!f)break;out.unshift(f);id=f.parentId;}return out;},[at,folders]);
  const here=folders.filter(f=>(f.parentId||null)===at).sort((a,b)=>a.name.localeCompare(b.name));
  const inHere=files.filter(f=>(f.folderId||null)===at).sort((a,b)=>(b.updated||b.created)-(a.updated||a.created));
  const countIn=(id:string):number=>files.filter(f=>f.folderId===id).length+folders.filter(f=>f.parentId===id).reduce((n,f)=>n+countIn(f.id),0);
  const setFolders=(next:SpaceFolder[])=>actions.onUpdateSpace({...space,folders:next});
  const saveName=()=>{if(!naming)return;const name=naming.name.trim().slice(0,80);if(!name){setNaming(null);return;}
    if(folders.some(f=>f.id!==naming.id&&(f.parentId||null)===at&&f.name.toLowerCase()===name.toLowerCase())){setNaming(null);return;}
    setFolders(naming.id?folders.map(f=>f.id===naming.id?{...f,name}:f):[...folders,{id:crypto.randomUUID(),name,parentId:at,created:Date.now()}]);setNaming(null);};
  const move=(fileId:string,folderId:string|null)=>actions.onUpdateFiles(all=>all.map(f=>f.id===fileId?{...f,folderId}:f));
  const removeFolder=async(folder:SpaceFolder)=>{
    if(!await confirmDialog({title:`Remove “${folder.name}”?`,message:'Its files and folders move up one level. Nothing is deleted.',confirm:'Remove folder'}))return;
    actions.onUpdateFiles(all=>all.map(f=>f.folderId===folder.id?{...f,folderId:folder.parentId}:f));
    setFolders(folders.filter(f=>f.id!==folder.id).map(f=>f.parentId===folder.id?{...f,parentId:folder.parentId}:f));
  };
  const drop=(folderId:string|null)=>(e:DragEvent)=>{e.preventDefault();e.stopPropagation();setOver(null);const id=e.dataTransfer.getData('application/x-mowr-file');if(id)move(id,folderId);else if(e.dataTransfer.files.length)actions.onUpload(e.dataTransfer.files,folderId);};
  const dragTarget=(id:string)=>({onDragOver:(e:DragEvent)=>{e.preventDefault();setOver(id);},onDragLeave:()=>setOver(o=>o===id?null:o)});
  const destinations=(file:StoredFile)=>[{label:space.name+' (top level)',id:null as string|null},...folders.map(f=>({label:folderPath(folders,f.id),id:f.id as string|null}))].filter(d=>d.id!==(file.folderId||null));
  const [moving,setMoving]=useState<StoredFile|null>(null);
  const [renaming,setRenaming]=useState<string|null>(null);
  return <section className={`sp-files ${over==='root-area'?'drop':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setOver('root-area');}}} onDragLeave={e=>{if(e.currentTarget===e.target)setOver(null);}} onDrop={drop(at)}>
    <div className="sp-toolbar">
      <nav className="sp-path" aria-label="Folder path">
        <button className={over==='crumb-root'?'over':''} onClick={()=>setAt(null)} onDrop={drop(null)} {...dragTarget('crumb-root')}><Icon name="files" size={15}/>Files</button>
        {path.map(f=><span key={f.id}><i>/</i><button className={over==='crumb-'+f.id?'over':''} onClick={()=>setAt(f.id)} onDrop={drop(f.id)} {...dragTarget('crumb-'+f.id)}>{f.name}</button></span>)}
      </nav>
      <div className="sp-tool-actions">
        {space.drive
          ? <Menu label="Google Drive folder" trigger={<span className="sp-drive-chip"><DriveGlyph/>{space.drive.folderName}<small>live</small></span>}
              items={[{label:space.drive.saveBack?'Stop saving Mowr’s files to Drive':'Save Mowr’s files to this Drive folder',run:()=>actions.onDriveSaveBack(!space.drive!.saveBack)},{label:'Link another folder',run:actions.onLinkDrive},{label:'Unlink folder',danger:true,run:actions.onUnlinkDrive}]}/>
          : <button onClick={actions.onLinkDrive}><DriveGlyph/>Link a Drive folder</button>}
        <button onClick={()=>setNaming({name:''})}><Icon name="plus" size={15}/>New folder</button>
        <button onClick={()=>input.current?.click()}><Icon name="attach" size={15}/>Upload</button>
        {at&&<button onClick={()=>actions.onShare(at)}><Icon name="import" size={15}/>Share folder</button>}
        <input ref={input} type="file" multiple hidden onChange={e=>{if(e.target.files?.length)actions.onUpload(e.target.files,at);e.target.value='';}}/>
      </div>
    </div>
    {space.drive&&!at&&<DriveFolderView folderId={space.drive.folderId} folderName={space.drive.folderName} onOpen={actions.onOpenDrive} onAsk={actions.onAskDrive} onChangeFolder={actions.onLinkDrive} onUnlink={actions.onUnlinkDrive} onItems={actions.onDriveItems}/>}
    {space.drive&&!at&&(inHere.length>0||here.length>0)&&<div className="sp-local-label"><span className="sp-eyebrow">On this PC</span></div>}
    {(here.length>0||naming&&!naming.id)&&<div className="sp-folders">
      {here.map(f=>naming?.id===f.id?<div key={f.id} className="sp-folder naming"><FolderIcon/><input autoFocus value={naming.name} maxLength={80} aria-label="Folder name" onChange={e=>setNaming({...naming,name:e.target.value})} onBlur={saveName} onKeyDown={e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')setNaming(null);}}/></div>
        :<div key={f.id} className={`sp-folder ${over===f.id?'over':''}`} role="button" tabIndex={0} onClick={()=>setAt(f.id)} onKeyDown={e=>{if(e.key==='Enter')setAt(f.id);}} onDrop={drop(f.id)} {...dragTarget(f.id)}>
          <FolderIcon/><div><strong>{f.name}</strong><small>{countIn(f.id)} item{countIn(f.id)===1?'':'s'}</small></div>
          <Menu label={`${f.name} options`} items={[{label:'Rename',run:()=>setNaming({id:f.id,name:f.name})},{label:'Share folder',icon:'import',run:()=>actions.onShare(f.id)},{label:'Remove folder',icon:'trash',danger:true,run:()=>void removeFolder(f)}]}/>
        </div>)}
      {naming&&!naming.id&&<div className="sp-folder naming"><FolderIcon/><input autoFocus value={naming.name} maxLength={80} placeholder="Folder name" aria-label="New folder name" onChange={e=>setNaming({...naming,name:e.target.value})} onBlur={saveName} onKeyDown={e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')setNaming(null);}}/></div>}
    </div>}
    <div className="sp-file-list">
      {inHere.map(f=><div key={f.id} className="sp-file" draggable onDragStart={e=>{e.dataTransfer.setData('application/x-mowr-file',f.id);e.dataTransfer.effectAllowed='move';}}>
        {renaming===f.id?<div className="sp-file-open"><FileGlyph file={f}/><RenameField name={f.name} onSave={name=>{actions.onRenameFile(f,name);setRenaming(null);}} onCancel={()=>setRenaming(null)}/></div>:<button className="sp-file-open" onClick={()=>actions.onOpenFile(f)}><FileGlyph file={f} size={36}/><span><strong>{f.name}</strong><small>{sizeLabel(f.size)} · {f.updated?'edited '+ago(f.updated):ago(f.created)}{f.made?' · made by Mowr':''}{f.versions?.length?` · ${f.versions.length} earlier version${f.versions.length===1?'':'s'}`:''}</small></span></button>}
        <button className="icon-button sp-rename" aria-label={`Rename ${f.name}`} aria-description="Rename" onClick={()=>setRenaming(f.id)}><PencilIcon size={15}/></button>
        <label className="sp-source" aria-description="Use this file when answering questions in this space"><input type="checkbox" checked={space.sources.includes(f.id)} onChange={e=>actions.onUpdateSpace({...space,sources:e.target.checked?[...new Set([...space.sources,f.id])]:space.sources.filter(id=>id!==f.id)})}/>Source</label>
        <Menu label={`${f.name} options`} items={[{label:'Open',run:()=>actions.onOpenFile(f)},...(/\.(pdf|docx|pptx|xlsx|txt|md|csv|json|tex)$/i.test(f.name)?[{label:'Edit with Mowr',run:()=>actions.onEditFile(f)}]:[]),{label:'Move to…',run:()=>setMoving(f)},{label:'Delete',icon:'trash',danger:true,run:()=>void actions.onDeleteFile(f)}]}/>
      </div>)}
      {!inHere.length&&!here.length&&!(space.drive&&!at)&&<div className="sp-drop-empty"><FolderIcon/><strong>{at?'This folder is empty':'Nothing here yet'}</strong><p>Drop files here, upload them, or ask Mowr to make a worksheet.{at?'':' Make folders like “Worksheets” or “Past papers” to keep things tidy.'}</p>
        <div><button onClick={()=>input.current?.click()}>Upload files</button><button onClick={()=>actions.onMake('worksheet',at)}>Make a worksheet here</button></div></div>}
    </div>
    {moving&&<div className="sp-move" role="dialog" aria-label={`Move ${moving.name}`}><strong>Move “{moving.name}” to</strong>{destinations(moving).map(d=><button key={d.id||'root'} onClick={()=>{move(moving.id,d.id);setMoving(null);}}><FolderIcon/>{d.label}</button>)}<button className="cancel" onClick={()=>setMoving(null)}>Cancel</button></div>}
    {desktop&&<div className="sp-linked"><div className="sp-card-head"><span className="sp-eyebrow">On this PC</span><button onClick={()=>void desktop!.invoke({action:'linkFolder',scope:`${space.kind}:${space.id}`}).then(()=>desktop!.invoke({action:'folders',scope:`${space.kind}:${space.id}`})).then(setLinked).catch(()=>{})}>Link a folder</button></div>
      {linked.map(l=><button key={l.id} className="sp-row" onClick={()=>actions.onBrowseLinked(l.id)}><Icon name="projects" size={16}/><span>{l.path.split(/[\\/]/).pop()}</span><small>{l.path}</small></button>)}
      {!linked.length&&<p className="sp-empty-line">Link a folder on your PC and Mowr can read and change its files, with your approval.</p>}</div>}
  </section>;
}

export const folderPath=(folders:SpaceFolder[],id:string)=>{const names:string[]=[];let cur:string|null=id;while(cur){const f=folders.find(x=>x.id===cur);if(!f)break;names.unshift(f.name);cur=f.parentId;}return names.join(' / ');};
function FolderIcon(){return <span className="sp-folder-icon"><Icon name="folder" size={30}/></span>;}

function DriveGlyph(){return <svg className="drive-glyph" width="15" height="14" viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>;}
