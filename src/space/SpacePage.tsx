import {SAMPLE_STARTER} from "../sample-subject";
import {shortWhen,dayBefore} from '../ui/when';
import {Fragment,useEffect,useMemo,useRef,useState,type DragEvent,type MouseEvent as ReactMouseEvent} from 'react';
import {Icon} from '../Icons';
import {SpaceMark} from './SpaceMark';
import {Menu,FolderIcon} from './SpaceMenu';
import {useReorder,arranged} from './reorder';
import {RenameField} from '../files/RenameField';
import {FileGlyph} from '../files/FileGlyph';
import {VideoThumb} from '../files/SaveVideo';
import {YouTubeLogo} from '../BrandLogos';
import {captionsLabel,durationLabel,shownName,watchUrl} from '../files/saved-video';
import {SubjectStudy,weakConcepts} from '../SubjectStudy';
import {isDue} from '../../core/srs';
import {chatPreview} from '../../core/chat-title';
import {sizeLabel} from '../store';
import {kinds as fileKinds,kindOf,type FileKind} from '../files/StorageSummary';
import {confirmDialog} from '../dialogs';
import {desktop} from '../desktop/bridge';
import {MemoryConversation,warmMemory,type MemoryPlace} from '../MemoryConversation';
import {InstructionsDialog,InstructionsGlyph,DescriptionDialog} from './InstructionsDialog';
import type {Chat,Space,SpaceFolder,StoredFile,StudySet,VisualRecord} from '../../core/types';
import {SavedVisuals} from '../visuals/SavedVisuals';
import {DriveFolderView,DriveExtras} from '../drive/DriveFolderView';
import {PlanView,PlanOverviewCard,type PlanActions,type PlanDraftView} from './PlanView';
import {planStatus,type SpacePlan} from '../../core/plans';
import type {DriveItem,DriveSyncState} from '../drive/drive';
import {driveFolder} from '../drive/drive';
import {menuKeys,useMenuKeys} from '../menuKeys';
import {Squiggle,Templates,EmptyState} from '../ui/Calm';
import './space.css';
import './space-calm.css';
import './space-files.css';
import './space-simple.css';

export type SpaceTab='overview'|'chats'|'plan'|'flashcards'|'quizzes'|'files'|'visuals'|'memory';
type Linked={id:string;scope:string;path:string};
export type SpaceActions={
  onAsk:(prompt:string)=>void;
  /** Opens a chat in this space with the message ready to review and send. */
  onDraft:(prompt:string)=>void;
  onOpenChat:(chat:Chat)=>void;
  /** Asks before deleting a chat of this space. */
  onDeleteChat:(chat:Chat)=>void;
  onOpenFile:(file:StoredFile)=>void;
  /** Opens "Save from YouTube" for this space, saving into the folder shown. */
  onSaveVideo:(folderId:string|null)=>void;
  /** A new chat here with the file attached. */
  onAskFile:(file:StoredFile)=>void;
  /** Opens the file beside a new chat in this space, where messages edit it. */
  onEditFile:(file:StoredFile)=>void;
  onRenameFile:(file:StoredFile,name:string)=>void;
  /** A Google Drive folder linked to this space, read live (never downloaded). */
  onLinkDrive:()=>void; onUnlinkDrive:()=>void; onShowDrive:(folderId:string)=>void; onDriveSeen:()=>void;
  /** Files from anywhere in Drive, outside the linked folder, that this space reads too. */
  onAddDriveFiles:()=>void; onRemoveDriveFile:(id:string)=>void;
  onOpenDrive:(file:DriveItem)=>void; onAskDrive:(files:DriveItem[])=>void; onDriveItems:(items:DriveItem[])=>void;
  /** Saves a file from this PC (or a Clem file, by id) into a folder of the linked Drive folder, keeping it here too. */
  /** Saves a file from this PC (or a Clem file, by id) into a Drive folder only; resolves to it as Drive lists it. */
  onAddToDrive:(folder:string,input:File|string)=>Promise<DriveItem>;
  /** Copies Drive files onto this PC, into folders named `dirs` under "On this PC". */
  onSaveOnPc:(entries:{item:DriveItem;dirs:string[]}[])=>void;
  onRetryDrive:(file:StoredFile)=>void;
  /** Opens a Drive file beside a new chat to edit it; changes go back to Drive once approved. */
  onEditDrive:(file:DriveItem)=>void;
  onOpenDriveWeb:(file:DriveItem)=>void;
  onRenameDrive:(file:DriveItem,name:string)=>Promise<boolean>;
  onTrashDrive:(file:DriveItem)=>Promise<boolean>;
  onStudyNew:(kind:'flashcards'|'summary')=>void;
  /** Opens the import from Anki or Quizlet (src/local/FlashcardImport.tsx) for this subject. */
  onImportCards:()=>void;
  onUpload:(files:FileList,folderId:string|null)=>void;
  onMake:(kind:'flashcards'|'quiz'|'worksheet'|'summary',folderId?:string|null)=>void;
  onShare:(folderId?:string)=>void;
  onUpdateSpace:(next:Space)=>void;
  onUpdateFiles:(fn:(files:StoredFile[])=>StoredFile[])=>void;
  onDeleteFile:(file:StoredFile)=>Promise<void>;
  onUpdateSet:(set:StudySet)=>void;
  onDeleteSet:(id:string)=>void;
  /** Takes a saved visual off the Visuals lists; it stays in its chat. */
  onRemoveVisual:(id:string)=>void;
  onExport:()=>void;
  onDelete:()=>void;
  onBrowseLinked:(folderId?:string)=>void;
  onBack:()=>void;
};

const dayKey=(t:number)=>new Date(t).toDateString();
/** Days in a row, ending today or yesterday, on which at least one card was reviewed. */
function streak(sets:StudySet[],now:number){
  const days=new Set(sets.flatMap(s=>(s.cards||[]).flatMap(c=>c?.reps?[dayKey(c.last)]:[])).concat(sets.flatMap(s=>s.attempts.map(a=>dayKey(a.at)))));
  let n=0,t=days.has(dayKey(now))?now:dayBefore(now);
  while(days.has(dayKey(t))){n++;t=dayBefore(t);}
  return n;
}
const ago=(t:number)=>shortWhen(t);

function Ring({value,size=58}:{value:number;size?:number}){
  const r=size/2-5,c=2*Math.PI*r;
  return <svg className="sp-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"><circle cx={size/2} cy={size/2} r={r} className="track"/><circle cx={size/2} cy={size/2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c*(1-value)} transform={`rotate(-90 ${size/2} ${size/2})`}/></svg>;
}

/** A right-click menu (a chat row, a folder, the Files area): the same actions as elsewhere, where the pointer is. */
function ContextMenu({at,onClose,items}:{at:{x:number;y:number};onClose:()=>void;items:{label:string;icon?:string;danger?:boolean;run:()=>void}[]}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{const close=(e:Event)=>{if(!root.current?.contains(e.target as Node))onClose();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);window.addEventListener('blur',onClose);window.addEventListener('scroll',onClose,true);
    root.current?.querySelector('button')?.focus();
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('blur',onClose);window.removeEventListener('scroll',onClose,true);};},[onClose]);
  const keys=menuKeys(items),choose=(n:number)=>{onClose();items[n].run();};
  useMenuKeys(true,keys,choose);
  return <div className="sp-menu-list sp-context" role="menu" ref={root} style={{position:'fixed',left:Math.min(at.x,window.innerWidth-210),top:Math.min(at.y,window.innerHeight-60*items.length),right:'auto'}}>
    {items.map((i,n)=><Fragment key={i.label}>{i.danger&&n>0&&!items[n-1].danger&&<hr/>}<button type="button" role="menuitem" className={i.danger?'danger':''} aria-keyshortcuts={keys[n]||undefined} onClick={()=>choose(n)}>{i.label}{keys[n]&&<span className="menu-key" aria-hidden="true">{keys[n]}</span>}</button></Fragment>)}</div>;
}
/** Right-clicking a chat row opens its menu; returns the handler and the menu to render. */
function useChatMenu(onDelete:(chat:Chat)=>void){
  const [menu,setMenu]=useState<{chat:Chat;x:number;y:number}|null>(null);
  const close=useMemo(()=>()=>setMenu(null),[]);
  const open=(chat:Chat)=>(e:ReactMouseEvent)=>{e.preventDefault();setMenu({chat,x:e.clientX,y:e.clientY});};
  const node=menu&&<ContextMenu at={menu} onClose={close} items={[{label:'Delete chat',icon:'trash',danger:true,run:()=>onDelete(menu.chat)}]}/>;
  return {open,node};
}


export function SpacePage({space,chats,files,sets,visuals=[],tab,onTab,actions,driveSync={},plan,planDraft,planActions,canAsk=false,memoryPlaces=[],memoryLabel,reviewNow=false,onReviewStarted}:{/** Start the review now (a flashcard reminder was clicked); `onReviewStarted` says it did. */ reviewNow?:boolean;onReviewStarted?:()=>void;space:Space;memoryPlaces?:MemoryPlace[];memoryLabel?:(scope:string)=>string;chats:Chat[];files:StoredFile[];sets:StudySet[];visuals?:VisualRecord[];tab:SpaceTab;onTab:(tab:SpaceTab)=>void;actions:SpaceActions;driveSync?:Record<string,DriveSyncState>;plan?:SpacePlan;planDraft?:PlanDraftView|null;planActions:PlanActions;canAsk?:boolean}){
  const subject=space.kind==='subject';
  const now=Date.now();
  const cards=sets.flatMap(s=>s.items.map((_,i)=>s.cards?.[i]||undefined));
  const due=cards.filter(c=>c?.reps&&isDue(c,now)).length,fresh=cards.filter(c=>!c?.reps).length;
  const mastery=cards.length?cards.filter(c=>c&&c.stability>=21).length/cards.length:0;
  const days=streak(sets,now);
  const weak=weakConcepts(sets);
  const [ask,setAsk]=useState('');
  const [review,setReview]=useState(0);
  const [instructions,setInstructions]=useState(false),[describing,setDescribing]=useState(false);
  const late=plan?planStatus(plan).overdue.length:0;
  const tabs:[SpaceTab,string,number?][]=subject?[['overview','Overview'],['chats','Chats',chats.length],['plan','Plan',late],['flashcards','Flashcards',sets.filter(s=>s.kind==='flashcards').reduce((n,s)=>n+s.items.length,0)],['quizzes','Quizzes',sets.filter(s=>s.kind==='quiz').length],['files','Files',files.length],['visuals','Visuals',visuals.length]]:[['overview','Overview'],['chats','Chats',chats.length],['plan','Plan',late],['files','Files',files.length],['visuals','Visuals',visuals.length]];
  if(desktop)tabs.push(['memory','Memory']);
  const recentChats=[...chats].sort((a,b)=>b.updated-a.updated);
  const chatMenu=useChatMenu(actions.onDeleteChat);
  const recentFiles=[...files].sort((a,b)=>(b.updated||b.created)-(a.updated||a.created));
  const startReview=()=>{onTab('flashcards');setReview(n=>n+1);};
  useEffect(()=>{if(reviewNow){startReview();onReviewStarted?.();}},[reviewNow]);
  useEffect(()=>warmMemory(),[]);
  // The underline glides to the chosen tab instead of jumping.
  const tabBar=useRef<HTMLElement>(null);
  useEffect(()=>{
    const bar=tabBar.current;if(!bar)return;
    const place=()=>{const b=bar.querySelector<HTMLElement>('[aria-selected=true]');if(!b)return;bar.style.setProperty('--tab-x',b.offsetLeft+'px');bar.style.setProperty('--tab-w',b.offsetWidth+'px');bar.dataset.ready='1';};
    place();const ro=new ResizeObserver(place);ro.observe(bar);
    // On a narrow window the chosen tab is scrolled into the bar's view.
    const chosen=bar.querySelector<HTMLElement>('[aria-selected=true]');
    if(chosen&&bar.scrollWidth>bar.clientWidth){const left=chosen.offsetLeft-bar.clientWidth/2+chosen.offsetWidth/2;bar.scrollTo({left:Math.max(0,left),behavior:'smooth'});}
    return()=>ro.disconnect();
  },[tab,tabs.length]);

  return <div className={`space-page ${subject?'is-subject':'is-project'}`}>
    <div className="sp-top">
    <header className="sp-hero">
      <button className="sp-crumb" onClick={actions.onBack}><Icon name="arrow" size={13}/>{subject?'Subjects':'Projects'}</button>
      <div className="sp-title-row">
        <div className="sp-title">
          <div className="sp-name-row"><span className="sp-hero-mark"><SpaceMark space={space} size={30} bare decorative/></span><Editable className="sp-name" value={space.name} max={100} label="Name" onSave={name=>actions.onUpdateSpace({...space,name})}/></div>
          {space.description&&<p className="sp-desc">{space.description}</p>}
        </div>
        <div className="sp-actions">
          <button className={`sp-instructions ${space.memory.trim()?'set':''}`} onClick={()=>setInstructions(true)} aria-description={space.memory.trim()?'Edit the instructions Clem follows here':'Tell Clem how to work here'}><InstructionsGlyph/>Instructions</button>
          <button className="sp-share" onClick={()=>actions.onShare()}><Icon name="import" size={16}/>Share</button>
          <Menu label="More" items={[{label:space.description?'Edit description':'Add a description',icon:'cmd-notes',run:()=>setDescribing(true)},...(subject?[{label:'Export subject ZIP',icon:'download',run:actions.onExport}]:[]),{label:`Delete ${space.kind}`,icon:'trash',danger:true,run:actions.onDelete}]}/>
        </div>
      </div>
      {space.sample&&<div className="sp-sample" role="note">
        <p>This is a sample subject: the notes and cards are examples, and any answer here comes from your own AI.</p>
        <div><button className="primary" onClick={()=>actions.onAsk(SAMPLE_STARTER)}>Try: “{SAMPLE_STARTER.split(':')[0]}”</button><button className="secondary" onClick={actions.onDelete}>Delete sample</button></div>
      </div>}
      <form className="sp-ask" onSubmit={e=>{e.preventDefault();if(ask.trim()){actions.onAsk(ask.trim());setAsk('');}}}>
        <Icon name="chat" size={18}/>
        <input value={ask} onChange={e=>setAsk(e.target.value)} placeholder={subject?`Ask anything about ${space.name}…`:`Work on ${space.name}…`} aria-label={`Ask about ${space.name}`}/>
        <button className="primary" disabled={!ask.trim()} aria-label="Start chat"><Icon name="arrow" size={16}/></button>
      </form>
      <nav className="sp-tabs" role="tablist" aria-label={`${space.name} sections`} ref={tabBar}>
        {tabs.map(([id,label,count],i)=><button key={id} role="tab" aria-selected={tab===id} tabIndex={tab===id?0:-1} className={tab===id?'active':''} onClick={()=>{setReview(0);onTab(id);}}
          // Arrow keys move along the tabs (Home and End to the ends), as tab lists do everywhere.
          onKeyDown={e=>{const to=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i-1+tabs.length)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(to<0)return;e.preventDefault();setReview(0);onTab(tabs[to][0]);requestAnimationFrame(()=>tabBar.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[to]?.focus());}}>{label}{count!==undefined&&count>0&&(id==='plan'?<span className="late" aria-label={`${count} overdue`} title={`${count} overdue`}><i aria-hidden="true"/>{count}</span>:<span>{count}</span>)}</button>)}
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
        {subject&&cards.length>0&&<section className="sp-today" aria-label="Today">
          <div className="sp-today-text">
            <b>{due?`${due} card${due===1?'':'s'} to review`:fresh?`${Math.min(fresh,20)} new card${Math.min(fresh,20)===1?'':'s'} to learn`:'All caught up'}</b>
            <span className="sp-today-meta"><Ring value={mastery} size={18}/>{Math.round(mastery*100)}% mastered<i aria-hidden="true">·</i><span className={`sp-flame ${days?'lit':''}`}><Icon name="flame" size={14}/></span>{days?`${days} day streak`:'No streak yet'}<i aria-hidden="true">·</i>{cards.length} cards</span>
          </div>
          <button className="primary sp-review" disabled={!due&&!fresh} onClick={startReview}>Start review<Icon name="arrow" size={16}/></button>
        </section>}
        {plan&&<PlanOverviewCard plan={plan} onOpen={()=>onTab('plan')}/>}
        {subject&&weak.length>0&&<section className="sp-list weak">
          <h3>Keeps slipping</h3>
          <ul>{weak.slice(0,4).map(q=><li key={q}><span>{q}</span><button onClick={()=>actions.onAsk(`Explain this again in a different way, then check me with one question: ${q}`)}>Explain again</button></li>)}</ul>
        </section>}
        <div className="sp-lists">
          <section className="sp-list recent">
            <div className="sp-list-head"><h3>Recent chats</h3>{chats.length>4&&<button onClick={()=>onTab('chats')}>All chats</button>}</div>
            {recentChats.slice(0,4).map(c=><button className="sp-row" key={c.id} onClick={()=>actions.onOpenChat(c)} onContextMenu={chatMenu.open(c)}><span>{c.title}</span><small>{ago(c.updated)}</small></button>)}
            {!chats.length&&<p className="sp-empty-line">Ask your first question above.</p>}
          </section>
          <section className="sp-list recent">
            <div className="sp-list-head"><h3>Recent files</h3>{files.length>4&&<button onClick={()=>onTab('files')}>All files</button>}</div>
            {recentFiles.slice(0,4).map(f=><button className="sp-row" key={f.id} onClick={()=>actions.onOpenFile(f)}>{f.video?<VideoThumb id={f.video.id} className="sp-row-thumb"/>:<FileGlyph file={f} size={22}/>}<span>{shownName(f)}</span><small>{ago(f.updated||f.created)}</small></button>)}
            {!files.length&&<p className="sp-empty-line">Nothing added yet.</p>}
          </section>
        </div>
        <Squiggle/>
        <Templates label="Make something" items={[
          ...(subject?[{key:'cards',icon:'cmd-flashcards',title:'Flashcards',line:'From your files and chats.',run:()=>actions.onMake('flashcards')},
            {key:'quiz',icon:'cmd-quiz',title:'Quiz',line:'Checked, then scheduled.',run:()=>actions.onMake('quiz')}]:[]),
          {key:'sheet',icon:'cmd-pdf',title:'Worksheet',line:'A PDF, saved to Worksheets.',run:()=>actions.onMake('worksheet')},
          {key:'sum',icon:'cmd-summarize',title:'Summary',line:'Every topic, complete and accurate.',run:()=>actions.onMake('summary')},
        ]}/>
      </div>}

      {tab==='plan'&&<PlanView space={space} plan={plan} draft={planDraft} actions={planActions} canAsk={canAsk}/>}
      {tab==='chats'&&<ChatList chats={recentChats} onOpen={actions.onOpenChat} onMenu={chatMenu.open} onNew={()=>actions.onDraft('')}/>}
      {tab==='flashcards'&&<SubjectStudy key="cards" kind="flashcards" autoStart={review} onImport={actions.onImportCards} sets={sets.filter(s=>s.kind==='flashcards')} onGenerate={k=>actions.onDraft(`/${k} Create a study set from this subject’s sources.`)} onUpdate={actions.onUpdateSet} onDelete={actions.onDeleteSet}/>}
      {tab==='quizzes'&&<SubjectStudy key="quiz" kind="quiz" sets={sets.filter(s=>s.kind==='quiz')} onGenerate={k=>actions.onDraft(`/${k} Create a study set from this subject’s sources.`)} onUpdate={actions.onUpdateSet} onDelete={actions.onDeleteSet}/>}
      {tab==='files'&&<FilesView space={space} files={files} actions={actions} driveSync={driveSync}/>}
      {tab==='visuals'&&<section className="lib sp-visuals" aria-label={`Visuals saved in ${space.name}`}>{visuals.length?<SavedVisuals visuals={visuals} chats={chats} spaces={[space]} showPlace={false} onOpen={id=>{const chat=chats.find(c=>c.id===id);if(chat)actions.onOpenChat(chat);}} onRemove={actions.onRemoveVisual}/>:<div className="sp-visuals-empty"><Icon name="visuals" size={22}/><p>Visuals you save in this {space.kind} appear here.</p><button className="sp-visuals-draw" onClick={()=>actions.onDraft('/visual ')}>Draw a visual</button></div>}</section>}
      {tab==='memory'&&desktop&&<section className="sp-memory"><span className="sp-eyebrow">What Clem remembers here</span><MemoryConversation home={`${space.kind}:${space.id}`} only labelFor={memoryLabel||(()=>space.name)} places={memoryPlaces} empty={`Details you share in this ${space.kind}'s chats, like deadlines or goals, appear here.`}/></section>}
    </div>
    {instructions&&<InstructionsDialog space={space} onSave={memory=>actions.onUpdateSpace({...space,memory})} onClose={()=>setInstructions(false)}/>}
    {describing&&<DescriptionDialog space={space} onSave={description=>actions.onUpdateSpace({...space,description})} onClose={()=>setDescribing(false)}/>}

    {chatMenu.node}
  </div>;
}

function Editable({value,onSave,className,max,label,placeholder}:{value:string;onSave:(v:string)=>void;className:string;max:number;label:string;placeholder?:string}){
  const [editing,setEditing]=useState(false),[text,setText]=useState(value);
  useEffect(()=>setText(value),[value]);
  const commit=()=>{setEditing(false);const next=text.trim();if(next!==value&&(next||label!=='Name'))onSave(next);else setText(value);};
  return editing?<input className={className+' editing'} autoFocus value={text} maxLength={max} aria-label={label} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape'){setText(value);setEditing(false);}}}/>
    :<button className={className} aria-description={`Edit ${label.toLowerCase()}`} onClick={()=>setEditing(true)}>{value||<span className="placeholder">{placeholder}</span>}</button>;
}


/** A space's chats, newest first: a title and when. A search appears once there are enough to need one. */
function ChatList({chats,onOpen,onMenu,onNew}:{chats:Chat[];onOpen:(c:Chat)=>void;onMenu:(c:Chat)=>(e:ReactMouseEvent)=>void;onNew:()=>void}){
  const [q,setQ]=useState('');
  const shown=chats.filter(c=>!q||(c.title+' '+(c.summary||'')+' '+c.messages.map(m=>m.content).join(' ')).toLowerCase().includes(q.toLowerCase()));
  const start=<button type="button" className="sp-new-chat" onClick={onNew}><span className="sp-new-chat-icon"><Icon name="plus" size={15}/></span><span><strong>New chat</strong><small>Starts in this subject, with its files and memory</small></span><Icon name="arrow" size={15}/></button>;
  if(!chats.length)return <section className="sp-chats" aria-label="Chats">{start}<EmptyState scene="conversation" line="Or ask your first question above."/></section>;
  return <section className="sp-chats" aria-label="Chats">
    {start}
    {chats.length>8&&<label className="sp-find"><Icon name="research" size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats"/></label>}
    {shown.map(c=><button key={c.id} className="sp-chat" onClick={()=>onOpen(c)} onContextMenu={onMenu(c)}><strong>{c.title}</strong><small>{ago(c.updated)}</small></button>)}
    {!shown.length&&<p className="sp-empty-line">No chat matches.</p>}
  </section>;
}

function FilesView({space,files,actions,driveSync}:{space:Space;files:StoredFile[];actions:SpaceActions;driveSync:Record<string,DriveSyncState>}){
  const folders=space.folders||[];
  const [at,setAt]=useState<string|null>(null);
  const [naming,setNaming]=useState<{id?:string;name:string}|null>(null);
  const [over,setOver]=useState<string|null>(null);
  const [linked,setLinked]=useState<Linked[]>([]);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!desktop)return;void desktop.invoke({action:'folders',scope:`${space.kind}:${space.id}`}).then(setLinked).catch(()=>{});},[space.id]);
  useEffect(()=>{if(at&&!folders.some(f=>f.id===at))setAt(null);},[folders,at]);
  const path=useMemo(()=>{const out:SpaceFolder[]=[];let id=at;while(id){const f=folders.find(x=>x.id===id);if(!f)break;out.unshift(f);id=f.parentId;}return out;},[at,folders]);
  const here=arranged(folders.filter(f=>(f.parentId||null)===at),(a,b)=>a.name.localeCompare(b.name));
  // Files kept in the linked Drive folder are listed there, with their sync state, not again under "On this PC".
  const [driveIds,setDriveIds]=useState<Set<string>>(()=>new Set());
  const inDrive=(f:StoredFile)=>!!space.drive&&!f.folderId&&(!!f.driveFolder||!!f.driveId&&driveIds.has(f.driveId));
  const inHere=arranged(files.filter(f=>(f.folderId||null)===at&&!inDrive(f)),(a,b)=>(b.updated||b.created)-(a.updated||a.created));
  const countIn=(id:string):number=>files.filter(f=>f.folderId===id).length+folders.filter(f=>f.parentId===id).reduce((n,f)=>n+countIn(f.id),0);
  const setFolders=(next:SpaceFolder[])=>actions.onUpdateSpace({...space,folders:next});
  // The person's own arrangement, by dragging a card's ☰ handle: folders among folders, files among files, in this folder.
  const ranked=<T extends {id:string}>(ids:string[])=>(x:T)=>{const i=ids.indexOf(x.id);return i<0?x:{...x,rank:i+1};};
  const folderOrder=useReorder('folders:'+(at||'top'),here.map(f=>f.id),ids=>setFolders(folders.map(ranked<SpaceFolder>(ids))));
  const fileOrder=useReorder('files:'+(at||'top'),inHere.map(f=>f.id),ids=>actions.onUpdateFiles(all=>all.map(ranked<StoredFile>(ids))));
  const shownFolders=folderOrder.order.flatMap(id=>here.filter(f=>f.id===id));
  const shownFiles=fileOrder.order.flatMap(id=>inHere.filter(f=>f.id===id));
  const saveName=()=>{if(!naming)return;const name=naming.name.trim().slice(0,80);if(!name){setNaming(null);return;}
    if(folders.some(f=>f.id!==naming.id&&(f.parentId||null)===at&&f.name.toLowerCase()===name.toLowerCase())){setNaming(null);return;}
    setFolders(naming.id?folders.map(f=>f.id===naming.id?{...f,name}:f):[...folders,{id:crypto.randomUUID(),name,parentId:at,created:Date.now()}]);setNaming(null);};
  const move=(ids:string[],folderId:string|null)=>actions.onUpdateFiles(all=>all.map(f=>ids.includes(f.id)?{...f,folderId}:f));
  const removeFolder=async(folder:SpaceFolder)=>{
    if(!await confirmDialog({title:`Remove “${folder.name}”?`,message:'Its files and folders move up one level. Nothing is deleted.',confirm:'Remove folder'}))return;
    actions.onUpdateFiles(all=>all.map(f=>f.folderId===folder.id?{...f,folderId:folder.parentId}:f));
    setFolders(folders.filter(f=>f.id!==folder.id).map(f=>f.parentId===folder.id?{...f,parentId:folder.parentId}:f));
  };
  const drop=(folderId:string|null)=>(e:DragEvent)=>{e.preventDefault();e.stopPropagation();setOver(null);const ids=e.dataTransfer.getData('application/x-clem-file').split(',').filter(Boolean);if(ids.length){move(ids,folderId);setPicked(new Set());}else if(e.dataTransfer.files.length)actions.onUpload(e.dataTransfer.files,folderId);};
  const dragTarget=(id:string)=>({onDragOver:(e:DragEvent)=>{e.preventDefault();setOver(id);},onDragLeave:()=>setOver(o=>o===id?null:o)});
  const destinations=(file:StoredFile)=>[{label:space.name+' (top level)',id:null as string|null},...folders.map(f=>({label:folderPath(folders,f.id),id:f.id as string|null}))].filter(d=>d.id!==(file.folderId||null));
  const [moving,setMoving]=useState<StoredFile|null>(null);
  // Files picked with "Select": dragged (or moved) together. Leaving the folder clears the pick.
  const [picked,setPicked]=useState<Set<string>>(()=>new Set());
  const [movingPicked,setMovingPicked]=useState(false);
  useEffect(()=>{setPicked(new Set());setMovingPicked(false);},[at,space.id]);
  const pick=(id:string)=>setPicked(p=>{const n=new Set(p);if(n.has(id))n.delete(id);else n.add(id);return n;});
  const pickedHere=shownFiles.filter(f=>picked.has(f.id)).map(f=>f.id);
  /** What a drag from a file carries: every picked file when it is one of them, otherwise just itself. A drag of several
   *  shows how many go. */
  const dragFiles=(f:StoredFile,e:DragEvent)=>{
    const ids=picked.has(f.id)?pickedHere:[f.id];
    e.dataTransfer.setData('application/x-clem-file',ids.join(','));e.dataTransfer.effectAllowed='move';
    if(ids.length>1){const tag=document.createElement('div');tag.className='sp-drag-count';tag.textContent=`${ids.length} files`;document.body.appendChild(tag);e.dataTransfer.setDragImage(tag,16,16);setTimeout(()=>tag.remove(),0);}
  };
  const [renaming,setRenaming]=useState<string|null>(null);
  /** Right-click: on a folder, its own options; anywhere else in Files, what can be added here (a new folder first). */
  const [context,setContext]=useState<{x:number;y:number;folder?:SpaceFolder}|null>(null);
  const closeContext=useMemo(()=>()=>setContext(null),[]);
  const folderItems=(f:SpaceFolder)=>[{label:'Rename',icon:'rename',run:()=>setNaming({id:f.id,name:f.name})},{label:'Share folder',icon:'import',run:()=>actions.onShare(f.id)},{label:'Remove folder',icon:'trash',danger:true,run:()=>void removeFolder(f)}];
  const openContext=(e:ReactMouseEvent)=>{
    const target=e.target as Element;
    // Files, the linked Drive folder and text fields keep their own (or the system's) menu.
    if(flat||target.closest('.sp-file,.gd-space,input,textarea,.sp-menu-list,.sp-move'))return;
    const card=target.closest<HTMLElement>('.sp-folder[data-folder]');
    e.preventDefault();
    setContext({x:e.clientX,y:e.clientY,folder:card?folders.find(f=>f.id===card.dataset.folder):undefined});
  };
  const linkPc=()=>void desktop!.invoke({action:'linkFolder',scope:`${space.kind}:${space.id}`}).then(()=>desktop!.invoke({action:'folders',scope:`${space.kind}:${space.id}`})).then(setLinked).catch(()=>{});
  // Finding a file: a name, channel or kind looks through every folder here at once, each file shown with where it is.
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState<FileKind|'all'>('all');
  const kindCounts=useMemo(()=>{const c=new Map<FileKind,number>();for(const f of files)c.set(kindOf(f),(c.get(kindOf(f))||0)+1);return c;},[files]);
  const shownKind=kind!=='all'&&kindCounts.has(kind)?kind:'all';
  const q=query.trim().toLowerCase();
  const flat=!!q||shownKind!=='all';
  const found=flat?files.filter(f=>(shownKind==='all'||kindOf(f)===shownKind)&&(!q||(f.name+' '+(f.video?.channel||'')+' '+(f.video?.playlist?.title||'')).toLowerCase().includes(q))).sort((a,b)=>(b.updated||b.created)-(a.updated||a.created)):[];
  const where=(f:StoredFile)=>f.folderId?folderPath(folders,f.folderId):'';
  // Files in the linked Drive folders are found too, in every linked folder and every subfolder: by name and folder here,
  // and by what they say through Drive's own search. Those with a copy here are already found above.
  const [driveFound,setDriveFound]=useState<{item:DriveItem;folder:string}[]>([]),[driveSearching,setDriveSearching]=useState(false);
  const links=[space.drive,...(space.drives||[])].filter((d):d is NonNullable<typeof d>=>!!d);
  const linkKey=links.map(d=>d.folderId).join(',');
  useEffect(()=>{
    if(!q||shownKind!=='all'||!desktop||!links.length){setDriveFound([]);setDriveSearching(false);return;}
    let live=true;setDriveSearching(true);
    const words=q.split(/\s+/).filter(Boolean);
    const timer=setTimeout(()=>void Promise.all(links.map(d=>driveFolder(d.folderId,q,false,30).then(r=>{
      const all=r.items.filter(i=>!i.folder);
      const named=all.filter(i=>{const hay=((i.path||'')+' '+i.name).toLowerCase();return words.every(w=>hay.includes(w));});
      const said=r.hits.map(h=>all.find(i=>i.id===h.id)).filter((i):i is DriveItem=>!!i);
      return [...named,...said].map(item=>({item,folder:d.folderName}));
    }).catch(()=>[]))).then(lists=>{
      if(!live)return;
      const seen=new Set(files.map(f=>f.driveId).filter(Boolean));
      setDriveFound(lists.flat().filter(({item})=>!seen.has(item.id)&&!!seen.add(item.id)).slice(0,80));
      setDriveSearching(false);
    }),250);
    return()=>{live=false;clearTimeout(timer);};
  },[q,shownKind,linkKey]);
  /** A file of this PC to copy into the Drive folder shown ("Save copy in Drive"); the Drive view uploads it. */
  const [toDrive,setToDrive]=useState<{key:string;id:string}|null>(null);
  const setSource=(f:StoredFile,on:boolean)=>actions.onUpdateSpace({...space,sources:on?[...new Set([...space.sources,f.id])]:space.sources.filter(id=>id!==f.id)});
  /** A file's picture, name and what it is; `place` names its folder when files from several folders are listed. */
  const fileOpen=(f:StoredFile,place?:string)=>{
    const glyph=f.video?<VideoThumb id={f.video.id} duration={durationLabel(f.video.durationSec)} className="sp-thumb"/>:<FileGlyph file={f} size={36}/>;
    if(renaming===f.id)return <div className="sp-file-open">{glyph}<RenameField name={shownName(f)} onSave={name=>{actions.onRenameFile(f,f.video&&!/\.md$/i.test(name)?name+'.md':name);setRenaming(null);}} onCancel={()=>setRenaming(null)}/></div>;
    // One short line: where it is (when several folders are listed), a missing transcript, and when.
    const meta=[place!==undefined?place||'':'',f.video?.captions==='none'?captionsLabel(f.video):'',ago(f.updated||f.created)].filter(Boolean);
    return <button className="sp-file-open" onClick={()=>picked.size?pick(f.id):actions.onOpenFile(f)}>{picked.size>0&&<input type="checkbox" className="sp-pick" aria-label={`Select ${shownName(f)}`} checked={picked.has(f.id)} onClick={e=>e.stopPropagation()} onChange={()=>pick(f.id)}/>}{glyph}<span><strong>{shownName(f)}</strong><small className={f.video?.captions==='none'?'sp-no-transcript':undefined}>{meta.join(' · ')}</small></span></button>;
  };
  const fileTools=(f:StoredFile,handle?:ReturnType<typeof fileOrder.handle>)=><>
    <label className="sp-source" title="Clem reads this file when answering here"><input type="checkbox" checked={space.sources.includes(f.id)} onChange={e=>setSource(f,e.target.checked)}/>Source</label>
    <Menu label={`${shownName(f)} options`} handle={handle} items={[{label:'Open',run:()=>actions.onOpenFile(f)},{label:'Rename',icon:'rename',run:()=>setRenaming(f.id)},{label:'Ask about it',icon:'chat',run:()=>actions.onAskFile(f)},...(f.video?[{label:'Watch on YouTube',icon:'external',run:()=>window.open(watchUrl(f.video!.id),'_blank','noopener')}]:[]),...(handle?[{label:picked.has(f.id)?'Deselect':'Select',icon:'check',run:()=>pick(f.id)}]:[]),...(!f.video&&/\.(pdf|docx|pptx|xlsx|txt|md|csv|json|tex)$/i.test(f.name)?[{label:'Edit with Clem',run:()=>actions.onEditFile(f)}]:[]),{label:'Move to…',run:()=>setMoving(f)},...(space.drive?[{label:'Save copy in Drive',run:()=>setToDrive({key:crypto.randomUUID(),id:f.id})}]:[]),{label:'Delete',icon:'trash',danger:true,run:()=>void actions.onDeleteFile(f)}]}/>
  </>;
  return <section className={`sp-files ${over==='root-area'?'drop':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setOver('root-area');}}} onDragOverCapture={e=>{if((e.target as Element).closest?.('.gd-space'))setOver(null);}} onDragLeave={e=>{if(e.currentTarget===e.target)setOver(null);}} onDrop={drop(at)} onContextMenu={openContext}>
    {/* One bar: find (or the way back out of a folder) on the left, one Add menu on the right. */}
    <div className="sp-files-bar">
      {at?<nav className="sp-path" aria-label="Folder path">
        <button className={over==='crumb-root'?'over':''} onClick={()=>setAt(null)} onDrop={drop(null)} {...dragTarget('crumb-root')}><Icon name="files" size={15}/>Files</button>
        {path.map(f=><span key={f.id}><i>/</i><button className={over==='crumb-'+f.id?'over':''} onClick={()=>setAt(f.id)} onDrop={drop(f.id)} {...dragTarget('crumb-'+f.id)}>{f.name}</button></span>)}
      </nav>:(files.length>0||links.length>0)&&<label className="sp-find"><Icon name="research" size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&query){e.preventDefault();setQuery('');}}} placeholder="Find" aria-label={`Find files in ${space.name}`}/></label>}
      <Menu label="Add" trigger={<><Icon name="plus" size={15}/>Add</>} items={[
        {label:'Upload files',icon:'attach',run:()=>input.current?.click()},
        {label:'YouTube video',icon:'play',run:()=>actions.onSaveVideo(at)},
        {label:'New folder',icon:'folder-plus',run:()=>setNaming({name:''})},
        ...(!space.drive&&!at?[{label:'Link Google Drive',icon:'drive',run:actions.onLinkDrive}]:[]),
        ...(desktop&&!at?[{label:'Link a folder on this PC',icon:'projects',run:linkPc}]:[]),
        ...(at?[{label:'Share folder',icon:'import',run:()=>actions.onShare(at)}]:[])]}/>
      <input ref={input} type="file" multiple hidden onChange={e=>{if(e.target.files?.length)actions.onUpload(e.target.files,at);e.target.value='';}}/>
    </div>
    {!at&&kindCounts.size>1&&<div className="files-kinds sp-kinds" role="group" aria-label="Show">
      <button type="button" aria-pressed={shownKind==='all'} onClick={()=>setKind('all')}>All</button>
      {fileKinds.filter(k=>kindCounts.has(k.id)).map(k=><button type="button" key={k.id} aria-pressed={shownKind===k.id} onClick={()=>setKind(shownKind===k.id?'all':k.id)}>{k.label}</button>)}
    </div>}
    {flat&&<div className="sp-file-list sp-found" aria-label="Matching files">
      {found.map(f=><div key={f.id} className="sp-file">{fileOpen(f,where(f))}{fileTools(f)}</div>)}
      {driveFound.map(({item,folder})=><div key={'drive-'+item.id} className="sp-file gd-file">
        <button className="sp-file-open" onClick={()=>actions.onOpenDrive(item)}><FileGlyph file={{name:item.name+(({document:'.docx',presentation:'.pptx',spreadsheet:'.xlsx'} as Record<string,string>)[item.mimeType.replace('application/vnd.google-apps.','')]||''),type:item.mimeType}} size={36}/><span><strong>{item.name}</strong><small>{['Google Drive · '+folder+(item.path?' / '+item.path:''),item.modified?ago(Date.parse(item.modified)):''].filter(Boolean).join(' · ')}</small></span></button>
        <Menu label={`${item.name} options`} items={[{label:'Open',run:()=>actions.onOpenDrive(item)},{label:'Ask about it',icon:'chat',run:()=>actions.onAskDrive([item])}]}/>
      </div>)}
      {driveSearching&&!found.length&&!driveFound.length&&<p className="sp-empty-line sp-found-none" role="status">Searching Google Drive…</p>}
      {!found.length&&!driveFound.length&&!driveSearching&&<p className="sp-empty-line sp-found-none">Nothing found. <button type="button" onClick={()=>{setQuery('');setKind('all');}}>Clear</button></p>}
    </div>}
    {!flat&&space.drive&&!at&&<DriveFolderView space={space} files={files} driveSync={driveSync} actions={actions}
      copy={toDrive}
      onItems={items=>{setDriveIds(new Set(items.filter(x=>!x.folder).map(x=>x.id)));actions.onDriveItems(items);}}/>}
    {!flat&&<>
    {!space.drive&&!at&&<DriveExtras space={space} actions={actions}/>}
    {/* Files added here are kept on this PC only; they are not sent to the linked Drive folder. */}
    {space.drive&&!at&&(inHere.length>0||here.length>0)&&<span className="sp-eyebrow sp-local-head">On this PC</span>}
    {(here.length>0||naming&&!naming.id)&&<div className="sp-folders">
      {shownFolders.map(f=>naming?.id===f.id?<div key={f.id} className="sp-folder naming"><FolderIcon/><input autoFocus value={naming.name} maxLength={80} aria-label="Folder name" onChange={e=>setNaming({...naming,name:e.target.value})} onBlur={saveName} onKeyDown={e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')setNaming(null);}}/></div>
        :<div key={f.id} {...folderOrder.item(f.id)} data-folder={f.id} className={`sp-folder ${over===f.id?'over':''}`} role="button" tabIndex={0} onClick={()=>setAt(f.id)} onKeyDown={e=>{if(e.key==='Enter')setAt(f.id);}} onDrop={drop(f.id)} {...dragTarget(f.id)}>
          <FolderIcon/><div><strong>{f.name}</strong><small>{countIn(f.id)}</small></div>
          <Menu label={`${f.name} options`} handle={folderOrder.handle(f.id)} items={folderItems(f)}/>
        </div>)}
      {naming&&!naming.id&&<div className="sp-folder naming"><FolderIcon/><input autoFocus value={naming.name} maxLength={80} placeholder="Folder name" aria-label="New folder name" onChange={e=>setNaming({...naming,name:e.target.value})} onBlur={saveName} onKeyDown={e=>{if(e.key==='Enter')saveName();if(e.key==='Escape')setNaming(null);}}/></div>}
    </div>}
    {picked.size>0&&<div className="sp-pick-bar" role="toolbar" aria-label="Selected files"><strong>{picked.size} selected</strong>
      <button onClick={()=>setPicked(new Set(shownFiles.map(f=>f.id)))}>Select all</button><button onClick={()=>setMovingPicked(true)}>Move to…</button><button onClick={()=>setPicked(new Set())}>Clear</button></div>}
    <div className="sp-file-list">
      {shownFiles.map(f=><div key={f.id} {...fileOrder.item(f.id)} className={`sp-file${picked.has(f.id)?' picked':''}${f.video?' is-video':''}`} draggable onDragStart={e=>{if(fileOrder.pressing()){e.preventDefault();return;}dragFiles(f,e);}}>
        {fileOpen(f)}{fileTools(f,fileOrder.handle(f.id))}
      </div>)}
      {!inHere.length&&!here.length&&!naming&&!(space.drive&&!at)&&<EmptyState scene="folder" line={at?'Empty folder.':'Drop files here.'}>
        <button className="primary" onClick={()=>input.current?.click()}>Upload</button><button onClick={()=>actions.onSaveVideo(at)}><YouTubeLogo size={15}/>YouTube</button></EmptyState>}
    </div>
    </>}
    {moving&&<div className="sp-move" role="dialog" aria-label={`Move ${moving.name}`}><strong>Move “{moving.name}” to</strong>{destinations(moving).map(d=><button key={d.id||'root'} onClick={()=>{move([moving.id],d.id);setMoving(null);}}><FolderIcon/>{d.label}</button>)}<button className="cancel" onClick={()=>setMoving(null)}>Cancel</button></div>}
    {movingPicked&&picked.size>0&&<div className="sp-move" role="dialog" aria-label={`Move ${picked.size} files`}><strong>Move {picked.size} file{picked.size===1?'':'s'} to</strong>{[{label:space.name+' (top level)',id:null as string|null},...folders.map(f=>({label:folderPath(folders,f.id),id:f.id as string|null}))].filter(d=>d.id!==at).map(d=><button key={d.id||'root'} onClick={()=>{move([...picked],d.id);setPicked(new Set());setMovingPicked(false);}}><FolderIcon/>{d.label}</button>)}<button className="cancel" onClick={()=>setMovingPicked(false)}>Cancel</button></div>}
    {desktop&&!at&&linked.length>0&&<div className="sp-linked"><span className="sp-eyebrow">On this PC</span>
      {linked.map(l=><button key={l.id} className="sp-row" onClick={()=>actions.onBrowseLinked(l.id)} title={l.path}><Icon name="projects" size={16}/><span>{l.path.split(/[\\/]/).pop()}</span></button>)}</div>}
    {context&&<ContextMenu at={context} onClose={closeContext} items={context.folder
      ?[{label:'Open',run:()=>setAt(context.folder!.id)},{label:'New folder inside',icon:'folder-plus',run:()=>{setAt(context.folder!.id);setNaming({name:''});}},...folderItems(context.folder)]
      :[{label:'New folder',icon:'folder-plus',run:()=>setNaming({name:''})},{label:'Upload files',icon:'attach',run:()=>input.current?.click()},{label:'YouTube video',icon:'play',run:()=>actions.onSaveVideo(at)}]}/>}
  </section>;
}

export const folderPath=(folders:SpaceFolder[],id:string)=>{const names:string[]=[];let cur:string|null=id;while(cur){const f=folders.find(x=>x.id===cur);if(!f)break;names.unshift(f.name);cur=f.parentId;}return names.join(' / ');};


function DriveGlyph(){return <svg className="drive-glyph" width="15" height="14" viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>;}
