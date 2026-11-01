import {useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type FormEvent,type ReactNode} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {SpaceMark} from './SpaceMark';
import {Menu} from './SpaceMenu';
import {Editable,FilesView,type SpaceActions} from './SpacePage';
import {InstructionsDialog,InstructionsGlyph,DescriptionDialog} from './InstructionsDialog';
import {TeamDialog} from './ProjectTeam';
import {MessageBody} from '../chat/MessageBody';
import {ModelSelector} from '../ModelSelector';
import {EmptyState} from '../ui/Calm';
import {shortWhen} from '../ui/when';
import {sizeLabel} from '../store';
import {REACTIONS,teamOf} from '../../core/coordinator';
import {recall,serializeMemory,RECALL_CHARS,type MemoryEntry} from '../../core/project-memory';
import type {Chat,Model,ProjectAgent,ProjectRoom,ProjectThread,Reaction,RoomMessage,Space,StoredFile} from '../../core/types';
import type {DriveSyncState} from '../drive/drive';
import type {MessageRef} from './useProjects';
import './space.css';
import './space-calm.css';
import './space-files.css';
import './space-simple.css';
import './project.css';

export type ProjectSection='coordinator'|'threads'|'context';
export type ProjectActions={
  send:(text:string)=>void;
  reply:(thread:string,text:string)=>void;
  stop:(key:string)=>void;
  react:(ref:MessageRef,emoji:string)=>void;
  clear:()=>void;
  memory:{add:(text:string,tags:string[])=>void;edit:(id:string,text:string,tags:string[])=>void;forget:(id:string)=>void;clear:()=>void};
  onConnect:()=>void;
};

const ago=(t:number)=>shortWhen(t);
const who=(by:string,agents:ProjectAgent[])=>by==='you'?'You':by==='coordinator'?'Coordinator':agents.find(a=>a.id===by)?.name||'An agent';
const statusLine:Record<ProjectThread['status'],string>={working:'Working',done:'Done',failed:'Failed',stopped:'Stopped'};

/** A project: the person talks to its coordinator, which hands work to the team in threads; Context holds what it knows. */
export function ProjectPage({space,room,memory,models,fallbackModel,busy,chats,files,driveSync,section,onSection,actions,project}:{space:Space;room:ProjectRoom;memory?:MemoryEntry[];models:Model[];fallbackModel:string;busy:Record<string,true>;chats:Chat[];files:StoredFile[];driveSync:Record<string,DriveSyncState>;section:ProjectSection;onSection:(s:ProjectSection)=>void;actions:SpaceActions;project:ProjectActions}){
  const team=teamOf(space),agents=team.agents;
  const [teamOpen,setTeamOpen]=useState(false),[instructions,setInstructions]=useState(false),[describing,setDescribing]=useState(false);
  const [openThread,setOpenThread]=useState<string|null>(null);
  const working=room.threads.filter(t=>t.status==='working').length;
  // Where Back goes from an open thread: the coordinator chat it was opened from, or the list of threads.
  const [cameFrom,setCameFrom]=useState<'coordinator'|'list'>('list');
  const showThread=(id:string)=>{setOpenThread(id);setCameFrom('coordinator');onSection('threads');};
  const pickSection=(id:ProjectSection)=>{if(id==='threads')setOpenThread(null);onSection(id);};
  const tabs:[ProjectSection,string,ReactNode?][]=[['coordinator','Coordinator'],['threads','Threads',working?<span className="pj-tab-live" aria-label={`${working} working`}><i aria-hidden="true"/>{working}</span>:room.threads.length?<span>{room.threads.length}</span>:null],['context','Context',memory?.length?<span>{memory.length}</span>:null]];
  const tabBar=useRef<HTMLElement>(null);
  // The underline glides to the chosen tab, as on a subject's page.
  useEffect(()=>{
    const bar=tabBar.current;if(!bar)return;
    const place=()=>{const b=bar.querySelector<HTMLElement>('[aria-selected=true]');if(!b)return;bar.style.setProperty('--tab-x',b.offsetLeft+'px');bar.style.setProperty('--tab-w',b.offsetWidth+'px');bar.dataset.ready='1';};
    place();const ro=new ResizeObserver(place);ro.observe(bar);return()=>ro.disconnect();
  },[section,working,room.threads.length,memory?.length]);
  return <div className="space-page is-project pj">
    <div className="sp-top">
      <header className="sp-hero pj-hero">
        <button className="sp-crumb" onClick={actions.onBack}><Icon name="arrow" size={13}/>Projects</button>
        <div className="sp-title-row">
          <div className="sp-title">
            <div className="sp-name-row"><span className="sp-hero-mark"><SpaceMark space={space} size={30} bare decorative/></span><Editable className="sp-name" value={space.name} max={100} label="Name" onSave={name=>actions.onUpdateSpace({...space,name})}/></div>
            {space.description&&<p className="sp-desc">{space.description}</p>}
          </div>
          <div className="sp-actions">
            <button className="sp-instructions pj-team-button" onClick={()=>setTeamOpen(true)} aria-description="Choose the coordinator's model and the agents it can hand work to">
              <Icon name="users" size={16}/>Team</button>
            <button className={`sp-instructions ${space.memory.trim()?'set':''}`} onClick={()=>setInstructions(true)}><InstructionsGlyph/>Instructions</button>
            <Menu label="More" items={[{label:space.description?'Edit description':'Add a description',icon:'cmd-notes',run:()=>setDescribing(true)},{label:'Share files',icon:'import',run:()=>actions.onShare()},{label:'Clear conversation',icon:'refresh',run:project.clear},{label:'Delete project',icon:'trash',danger:true,run:actions.onDelete}]}/>
          </div>
        </div>
        <nav className="sp-tabs pj-tabs" role="tablist" aria-label={`${space.name} sections`} ref={tabBar}>
          {tabs.map(([id,label,badge],i)=><button key={id} role="tab" aria-selected={section===id} tabIndex={section===id?0:-1} className={section===id?'active':''} onClick={()=>pickSection(id)}
            onKeyDown={e=>{const to=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i-1+tabs.length)%tabs.length:-1;if(to<0)return;e.preventDefault();pickSection(tabs[to][0]);requestAnimationFrame(()=>tabBar.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[to]?.focus());}}>{label}{badge}</button>)}
        </nav>
      </header>
    </div>
    <div className={`sp-body pj-body pj-in-${section}`} key={section}>
      {section==='coordinator'&&<CoordinatorChat space={space} room={room} agents={agents} models={models} model={team.coordinatorModel||fallbackModel} running={!!busy[space.id]} project={project} onThread={showThread} onTeam={()=>setTeamOpen(true)} onModel={id=>actions.onUpdateSpace({...space,team:{...team,coordinatorModel:id}})}/>}
      {section==='threads'&&<Threads room={room} agents={agents} models={models} busy={busy} open={openThread} cameFrom={cameFrom} onOpen={id=>{setOpenThread(id);setCameFrom('list');}} onBack={()=>{setOpenThread(null);if(cameFrom==='coordinator')onSection('coordinator');}} project={project} onCoordinator={()=>onSection('coordinator')}/>}
      {section==='context'&&<Context space={space} memory={memory} chats={chats} files={files} driveSync={driveSync} actions={actions} project={project} onInstructions={()=>setInstructions(true)}/>}
    </div>
    {teamOpen&&<TeamDialog space={space} models={models} fallbackModel={fallbackModel} onConnect={project.onConnect} onSave={next=>actions.onUpdateSpace({...space,team:next})} onClose={()=>setTeamOpen(false)}/>}
    {instructions&&<InstructionsDialog space={space} onSave={memory=>actions.onUpdateSpace({...space,memory})} onClose={()=>setInstructions(false)}/>}
    {describing&&<DescriptionDialog space={space} onSave={description=>actions.onUpdateSpace({...space,description})} onClose={()=>setDescribing(false)}/>}
  </div>;
}

// ---------------------------------------------------------------- reactions

function SmileGlyph(){return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="10" r="6.5"/><path d="M6.6 11.6c.6.9 1.4 1.4 2.4 1.4s1.8-.5 2.4-1.4"/><circle cx="7" cy="8.4" r=".6" fill="currentColor" stroke="none"/><circle cx="11" cy="8.4" r=".6" fill="currentColor" stroke="none"/><path d="M16.5 2.5v4M14.5 4.5h4"/></svg>;}

/** The reactions under a message, grouped by emoji, and the button that adds one. */
function Reactions({reactions=[],agents,onToggle,label}:{reactions?:Reaction[];agents:ProjectAgent[];onToggle:(emoji:string)=>void;label:string}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(e:Event)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLButtonElement>('.pj-react-add')?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);root.current?.querySelector<HTMLButtonElement>('.pj-react-pick button')?.focus();
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[open]);
  const groups=useMemo(()=>{const m=new Map<string,string[]>();for(const r of reactions)m.set(r.emoji,[...(m.get(r.emoji)||[]),r.by]);return [...m];},[reactions]);
  return <div className={`pj-reactions${groups.length?' has':''}`} ref={root}>
    {groups.map(([emoji,by])=>{const mine=by.includes('you');
      return <button key={emoji} type="button" className={`pj-reaction${mine?' mine':''}`} aria-pressed={mine} aria-label={`${emoji}${by.length>1?`, ${by.length}`:''}${mine?'. Press to remove yours':''}`} onClick={()=>onToggle(emoji)}>
        <span className="pj-reaction-emoji">{emoji}</span>{by.length>1&&<span className="pj-reaction-n">{by.length}</span>}</button>;})}
    <button type="button" className="pj-react-add" aria-label={`React to ${label}`} aria-expanded={open} onClick={()=>setOpen(!open)}><SmileGlyph/></button>
    {open&&<div className="pj-react-pick" role="menu" aria-label="Reactions">{REACTIONS.map(e=><button key={e} type="button" role="menuitem" aria-label={e} className={reactions.some(r=>r.by==='you'&&r.emoji===e)?'on':''} onClick={()=>{onToggle(e);setOpen(false);}}>{e}</button>)}</div>}
  </div>;
}

// ---------------------------------------------------------------- messages

function Thinking({label='Thinking…'}:{label?:string}){return <span className="thinking">{label}</span>;}

function MessageMeta({m,memory,label}:{m:RoomMessage;memory?:boolean;label?:ReactNode}){
  const used=m.recalled?.length||0;
  if(!label&&!(memory&&(used||m.remembered)))return null;
  return <div className="pj-meta">{label}{memory&&used>0&&<span title="Lines from the project memory file this reply was given">Read {used} {used===1?'memory':'memories'}</span>}{memory&&!!m.remembered&&<span className="pj-meta-saved"><Icon name="check" size={12}/>Saved {m.remembered} to memory</span>}</div>;
}

/** One message, in the app's own bubble style: the person's on the right, the AI's as text. */
function Message({m,agents,models,thread,onReact,latest,children}:{m:RoomMessage;agents:ProjectAgent[];models:Model[];thread?:ProjectThread;onReact:(emoji:string)=>void;latest:boolean;children?:ReactNode}){
  const mine=m.from==='you',writing=m.status==='writing';
  const agent=agents.find(a=>a.id===m.from);
  const inThread=!!thread;
  const name=mine?'You':m.from==='coordinator'?'Coordinator':agent?.name||'Agent';
  return <article className={`message ${mine?'user':'assistant'} pj-message${writing&&!m.content?' waiting':''}${latest?' latest':''}`} data-from={m.from}>
    {writing&&!m.content?<div className="pj-waiting"><Thinking label={inThread?`${name} is working…`:'Thinking…'}/></div>
      :<div className="message-text">{mine?m.content:<MessageBody content={m.content} streaming={writing}/>}</div>}
    {m.status==='error'&&<p className="pj-error" role="alert">{m.error||'This reply failed.'}</p>}
    {m.status==='stopped'&&<p className="pj-stopped">Stopped</p>}
    {children}
    {!writing&&<div className="pj-under">
      <Reactions reactions={m.reactions} agents={agents} label={mine?'your message':`${name}’s message`} onToggle={onReact}/>
      <MessageMeta m={m} memory={!mine} label={<time dateTime={new Date(m.at).toISOString()}>{ago(m.at)}</time>}/>
    </div>}
  </article>;
}

/** A handoff, as one small line under the coordinator's message: who got a message from it, and how it is going.
 *  Pressing it opens the conversation between the coordinator and that agent right there; Open thread goes to it. */
function HandoffNote({thread,agent,agents,index=0,onOpen}:{thread:ProjectThread;agent?:ProjectAgent;agents:ProjectAgent[];index?:number;onOpen:()=>void}){
  const [open,setOpen]=useState(false);
  const chat=useRef<HTMLDivElement>(null);
  // Opened, the conversation is brought into view above the message box.
  useEffect(()=>{if(open)chat.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[open]);
  const name=agent?.name||'A removed agent';
  const replies=thread.messages.filter(m=>m.from!=='coordinator'||m!==thread.messages[0]).length;
  return <div className={`pj-handoff is-${thread.status}${open?' open':''}`} style={{'--i':index} as CSSProperties}>
    <button type="button" className="pj-handoff-line" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span className="pj-handoff-dot" aria-hidden="true"/>
      <span className="pj-handoff-text"><b>{name}</b> received a message from the coordinator<i aria-hidden="true">·</i><span>{thread.title}</span></span>
      <span key={thread.status} className={`pj-handoff-state is-${thread.status}`}>{thread.status==='working'?'Working…':statusLine[thread.status]}</span>
      <Icon name="down" size={13}/>
    </button>
    {open&&<div className="pj-handoff-chat" ref={chat}>
      {thread.messages.map(m=>{const who_=m.from==='coordinator'?'Coordinator':m.from==='you'?'You':agents.find(a=>a.id===m.from)?.name||name;
        return <div key={m.id} className={`pj-handoff-msg from-${m.from==='coordinator'?'coordinator':m.from==='you'?'you':'agent'}`}>
          <small>{who_}{m.from==='coordinator'&&<> → {name}</>}</small>
          {m.status==='writing'&&!m.content?<Thinking label="Working…"/>:<div className="pj-handoff-body"><MessageBody content={m.content} streaming={m.status==='writing'}/></div>}
          {!!m.reactions?.length&&<span className="pj-handoff-reacts">{m.reactions.map((r,i)=><span key={i}>{r.emoji}</span>)}</span>}
        </div>;})}
      <button type="button" className="pj-handoff-open" onClick={onOpen}>{replies?'Open thread to reply':'Open thread'}<Icon name="arrow" size={13}/></button>
    </div>}
  </div>;
}

/** The message box, as in a chat: Enter sends, Shift+Enter breaks the line, and the button stops a running reply. */
function Composer({placeholder,running,onSend,onStop,disabled,children,autoFocus}:{placeholder:string;running:boolean;onSend:(text:string)=>void;onStop:()=>void;disabled?:string;children?:ReactNode;autoFocus?:boolean}){
  const [text,setText]=useState('');
  const field=useRef<HTMLTextAreaElement>(null);
  // Grows with what is typed; empty, it goes back to the stylesheet's one-line height.
  useLayoutEffect(()=>{const el=field.current;if(!el)return;el.style.height='';if(text)el.style.height=Math.min(el.scrollHeight,264)+'px';},[text]);
  useEffect(()=>{if(autoFocus)field.current?.focus();},[autoFocus]);
  const submit=(e?:FormEvent)=>{e?.preventDefault();const t=text.trim();if(!t||running||disabled)return;onSend(t);setText('');};
  return <form className="composer pj-composer-form" onSubmit={submit}>
    <textarea ref={field} rows={1} value={text} aria-label="Your message" placeholder={disabled||placeholder} disabled={!!disabled} onChange={e=>setText(e.target.value)}
      onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}}/>
    <div className="composer-bottom">
      <div className="composer-tools pj-composer-left">{children}</div>
      <div className="composer-tools">
        {running?<button type="button" className="send-button" aria-label="Stop" aria-description="Stops the reply and any threads it started" onClick={onStop}><span className="stop-square"/></button>
          :<button className="send-button" aria-label="Send message" disabled={!text.trim()||!!disabled}><Icon name="up" size={22}/></button>}
      </div>
    </div>
  </form>;
}

/** Keeps the newest message in view while the person is at the end. */
function useFollow(dep:unknown){
  const end=useRef<HTMLDivElement>(null),near=useRef(true);
  useEffect(()=>{const scroller=end.current?.closest('.workspace');if(!scroller)return;const on=()=>{near.current=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<140;};scroller.addEventListener('scroll',on,{passive:true});return()=>scroller.removeEventListener('scroll',on);},[]);
  // The composer is sticky over the end of the page, so the page is scrolled to its very bottom, not to the marker.
  useLayoutEffect(()=>{const scroller=end.current?.closest<HTMLElement>('.workspace');if(dep&&near.current&&scroller)scroller.scrollTop=scroller.scrollHeight;},[dep]);
  return end;
}

function CoordinatorChat({space,room,agents,models,model,running,project,onThread,onTeam,onModel}:{space:Space;room:ProjectRoom;agents:ProjectAgent[];models:Model[];model:string;running:boolean;project:ProjectActions;onThread:(id:string)=>void;onTeam:()=>void;onModel:(id:string)=>void}){
  // Nothing to follow yet: the page stays at its top, where the introduction is.
  const end=useFollow(room.messages.length&&room.messages.map(m=>m.id+m.content.length+(m.reactions?.length||0)).join()+room.threads.map(t=>t.status).join());
  const canAsk=models.some(m=>m.connected);
  const last=room.messages.at(-1);
  const waitingOnThreads=running&&last?.from==='coordinator'&&!last.status&&!!last.threads?.length&&room.threads.some(t=>last.threads!.includes(t.id)&&t.status==='working');
  return <section className={`pj-chat${room.messages.length?'':' is-empty'}`} aria-label="Coordinator">
    {!room.messages.length?<div className="pj-intro">
      <Illustration scene="relay" viewBox="104 62 272 290" className="pj-intro-art"/>
      <h2>Tell the coordinator what you’re working on.</h2>
      <p>It answers you, and hands bigger pieces to {agents.length?'your team':'agents you add in Team'}. Each handoff opens a thread you can read.</p>
      <div className="pj-starters">{[`Plan the next two weeks`,'Research the options for me','Draft it, then have it reviewed'].map(s=><button key={s} type="button" disabled={!canAsk} onClick={()=>project.send(s)}>{s}<Icon name="arrow" size={14}/></button>)}</div>
    </div>
    :<div className="messages pj-messages">
      {room.messages.map((m,i)=><Message key={m.id} m={m} agents={agents} models={models} latest={i===room.messages.length-1} onReact={e=>project.react({message:m.id},e)}>
        {!!m.threads?.length&&<div className="pj-handoffs">{m.threads.map((id,i)=>{const t=room.threads.find(x=>x.id===id);return t?<HandoffNote key={id} index={i} thread={t} agent={agents.find(a=>a.id===t.agent)} agents={agents} onOpen={()=>onThread(id)}/>:null;})}</div>}
      </Message>)}
      {waitingOnThreads&&<div className="pj-waiting pj-after"><Thinking label="Waiting for the team to report back…"/></div>}
    </div>}
    <div ref={end}/>
    <div className="chat-composer pj-composer">
      <Composer placeholder={room.messages.length?'Reply to the coordinator…':`What should ${space.name} get done?`} running={running} onSend={project.send} onStop={()=>project.stop(space.id)} disabled={canAsk?undefined:'Connect an AI in Settings → Models to start'}>
        <button type="button" className="pj-roster" onClick={onTeam} aria-label={`Team: ${agents.map(a=>a.name).join(', ')||'no agents'}. Change in Team`}>
          <Icon name="users" size={15}/><span>{agents.length?agents.map(a=>a.name).join(', '):'Add agents'}</span>
        </button>
      </Composer>
      <div className="pj-composer-model"><span>Coordinator</span><ModelSelector models={models} value={model} onChange={onModel} onConnect={project.onConnect} label="Coordinator model"/></div>
    </div>
  </section>;
}

// ---------------------------------------------------------------- threads

/** Which day a thread belongs to in the list. */
function dayGroup(t:number,now=Date.now()){const d=new Date(t).toDateString();if(d===new Date(now).toDateString())return 'Today';if(d===new Date(now-864e5).toDateString())return 'Yesterday';return new Date(t).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});}

/** Every handoff, newest first and grouped by day; opening one shows it on its own page with a way back. */
function Threads({room,agents,models,busy,open,cameFrom,onOpen,onBack,project,onCoordinator}:{room:ProjectRoom;agents:ProjectAgent[];models:Model[];busy:Record<string,true>;open:string|null;cameFrom:'coordinator'|'list';onOpen:(id:string)=>void;onBack:()=>void;project:ProjectActions;onCoordinator:()=>void}){
  const [filter,setFilter]=useState<string>('all');
  const current=room.threads.find(t=>t.id===open)||null;
  useEffect(()=>{if(open&&!current)onBack();},[open,current]);
  if(current)return <ThreadView key={current.id} thread={current} agents={agents} models={models} running={!!busy['thread:'+current.id]||current.status==='working'} project={project} backLabel={cameFrom==='coordinator'?'Coordinator':'All threads'} onBack={onBack}/>;
  if(!room.threads.length)return <section className="pj-threads-empty"><EmptyState scene="conversation" line="When the coordinator hands work to an agent, the thread appears here."><button className="primary" onClick={onCoordinator}>Talk to the coordinator</button></EmptyState></section>;
  const used=[...new Set(room.threads.map(t=>t.agent))];
  const shown=[...room.threads].filter(t=>filter==='all'||t.agent===filter).sort((a,b)=>(b.status==='working'?1:0)-(a.status==='working'?1:0)||b.updated-a.updated);
  const groups:[string,ProjectThread[]][]=[];
  for(const t of shown){const g=t.status==='working'?'Working now':dayGroup(t.updated);const last=groups.at(-1);if(last&&last[0]===g)last[1].push(t);else groups.push([g,[t]]);}
  return <section className="pj-threads" aria-label="Threads">
    {used.length>1&&<div className="pj-thread-filter" role="group" aria-label="Show threads from">
      <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All<span>{room.threads.length}</span></button>
      {used.map(id=><button type="button" key={id} aria-pressed={filter===id} onClick={()=>setFilter(filter===id?'all':id)}>{who(id,agents)}<span>{room.threads.filter(t=>t.agent===id).length}</span></button>)}
    </div>}
    {groups.map(([label,list])=><div key={label} className="pj-thread-group">
      <h4>{label}</h4>
      <ul>{list.map(t=>{const agent=agents.find(a=>a.id===t.agent),turns=t.messages.filter(m=>m.from!=='coordinator').length;
        return <li key={t.id}><button type="button" className={`pj-thread-row is-${t.status}`} onClick={()=>onOpen(t.id)}>
          <span className="pj-handoff-dot" aria-hidden="true"/>
          <span className="pj-thread-row-text">
            <span className="pj-thread-row-top"><strong>{t.title}</strong><small>{agent?.name||'Removed agent'}</small></span>
            <span className="pj-thread-row-sum">{t.status==='working'?'Working on it…':t.summary||statusLine[t.status]}</span>
          </span>
          <span className="pj-thread-row-side"><small>{ago(t.updated)}</small><small>{turns} {turns===1?'reply':'replies'}</small></span>
          <Icon name="right" size={15}/>
        </button></li>;})}</ul>
    </div>)}
  </section>;
}

function ThreadView({thread,agents,models,running,project,backLabel,onBack}:{thread:ProjectThread;agents:ProjectAgent[];models:Model[];running:boolean;project:ProjectActions;backLabel:string;onBack:()=>void}){
  const agent=agents.find(a=>a.id===thread.agent);
  const model=models.find(x=>x.id===agent?.model)?.name;
  const end=useFollow(thread.messages.map(m=>m.id+m.content.length).join());
  // Escape goes back too, unless something is being typed.
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!(e.target as Element)?.closest?.('input,textarea,dialog,[role=menu]'))onBack();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[onBack]);
  return <div className="pj-thread" aria-label={`Thread: ${thread.title}`}>
    <button type="button" className="pj-back" onClick={onBack} aria-keyshortcuts="Escape"><Icon name="arrow" size={14}/>{backLabel}</button>
    <header className="pj-thread-head">
      <div>
        <h3>{thread.title}</h3>
        <p className="pj-thread-sub"><span className={`pj-handoff-dot is-${thread.status}`} aria-hidden="true"/><b>{agent?.name||'Removed agent'}</b>{model&&<> · {model}</>} · {thread.status==='working'?'Working…':statusLine[thread.status]} · started {ago(thread.created)}</p>
      </div>
    </header>
    <div className="messages pj-messages pj-thread-messages">
      {thread.messages.map((m,i)=>{const react=(e:string)=>project.react({thread:thread.id,message:m.id},e);
        return m.from==='coordinator'?<Received key={m.id} m={m} agents={agents} onReact={react}/>:<Message key={m.id} m={m} agents={agents} models={models} thread={thread} latest={i===thread.messages.length-1} onReact={react}/>;})}
      <div ref={end}/>
    </div>
    <div className="chat-composer pj-composer pj-thread-composer">
      <Composer placeholder={agent?`Add to this thread; ${agent.name} answers here…`:'This agent was removed from the team'} disabled={agent?undefined:'This agent was removed from the team'} running={running} onSend={t=>project.reply(thread.id,t)} onStop={()=>project.stop('thread:'+thread.id)}/>
    </div>
  </div>;
}

/** A message the coordinator handed into this thread: one small line, as in the coordinator chat. Pressing it shows
 *  what it said; reactions to it stay visible either way. */
function Received({m,agents,onReact}:{m:RoomMessage;agents:ProjectAgent[];onReact:(emoji:string)=>void}){
  const [open,setOpen]=useState(false);
  return <div className={`pj-received${open?' open':''}`}>
    <button type="button" className="pj-handoff-line" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span className="pj-handoff-dot" aria-hidden="true"/>
      <span className="pj-handoff-text">Received a message from the <b>coordinator</b><i aria-hidden="true">·</i><span>{ago(m.at)}</span></span>
      {!open&&!!m.reactions?.length&&<span className="pj-handoff-reacts">{m.reactions.map((r,i)=><span key={i}>{r.emoji}</span>)}</span>}
      <Icon name="down" size={13}/>
    </button>
    {open&&<div className="pj-handoff-chat pj-received-body">
      <div className="pj-handoff-body"><MessageBody content={m.content} streaming={false}/></div>
      <Reactions reactions={m.reactions} agents={agents} label="the coordinator’s message" onToggle={onReact}/>
    </div>}
  </div>;
}

// ---------------------------------------------------------------- context

function Context({space,memory,chats,files,driveSync,actions,project,onInstructions}:{space:Space;memory?:MemoryEntry[];chats:Chat[];files:StoredFile[];driveSync:Record<string,DriveSyncState>;actions:SpaceActions;project:ProjectActions;onInstructions:()=>void}){
  const [query,setQuery]=useState(''),[adding,setAdding]=useState(''),[editing,setEditing]=useState<string|null>(null);
  const list=memory||[];
  const found=useMemo(()=>query.trim()?recall(list,query,{count:50,chars:20000}):null,[list,query]);
  const shown=found||[...list].reverse();
  const perMessage=Math.round(Math.min(RECALL_CHARS,list.reduce((n,e)=>n+e.text.length+24,0))/3.5);
  const bytes=useMemo(()=>new Blob([serializeMemory(list)]).size,[list]);
  const add=(e:FormEvent)=>{e.preventDefault();const {text,tags}=splitTags(adding);if(text){project.memory.add(text,tags);setAdding('');}};
  return <div className="pj-context">
    <section className="pj-panel pj-memory" aria-labelledby="pj-memory-title">
      <div className="pj-panel-head">
        <div><h3 id="pj-memory-title">Memory</h3>
          <p>The coordinator keeps decisions, dates and preferences in <code>memory.md</code>. Each message reads only the lines that match it, so memory stays small however much it holds.</p></div>
        {list.length>0&&<Menu label="Memory options" items={[{label:'Download memory.md',icon:'download',run:()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([serializeMemory(list,`${space.name} · project memory`)],{type:'text/markdown'}));a.download=`${space.name} memory.md`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}},{label:'Forget everything',icon:'trash',danger:true,run:project.memory.clear}]}/>}
      </div>
      <dl className="pj-memory-stats">
        <div><dt>Facts</dt><dd>{memory?list.length:'…'}</dd></div>
        <div><dt>File</dt><dd>{sizeLabel(bytes)}</dd></div>
        <div><dt>Per message</dt><dd title="The most memory one message carries, however large the file grows">≤ {perMessage.toLocaleString()} tokens</dd></div>
      </dl>
      {list.length>0&&<label className="sp-find pj-memory-find"><Icon name="research" size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('');}} placeholder="Search memory the way the coordinator does" aria-label="Search memory"/></label>}
      {found&&<p className="pj-memory-note" role="status">{found.length?`${found.length} matching ${found.length===1?'line':'lines'}, best first. A message about this would read the top ${Math.min(found.length,8)}.`:'Nothing matches. The coordinator would read no memory for this.'}</p>}
      <ul className="pj-facts">
        {shown.map(e=><li key={e.id} className="pj-fact">
          {editing===e.id?<FactEdit fact={e} onSave={(text,tags)=>{project.memory.edit(e.id,text,tags);setEditing(null);}} onCancel={()=>setEditing(null)}/>:<>
            <div className="pj-fact-text"><span>{e.text}</span><small>{e.tags.map(t=><b key={t}>#{t}</b>)}<time>{e.at}</time></small></div>
            <div className="pj-fact-tools"><button type="button" aria-label="Edit" onClick={()=>setEditing(e.id)}><Icon name="rename" size={15}/></button><button type="button" aria-label="Forget" onClick={()=>project.memory.forget(e.id)}><Icon name="trash" size={15}/></button></div>
          </>}
        </li>)}
        {memory&&!list.length&&<li className="pj-fact-empty">Nothing yet. Tell the coordinator a deadline, a decision or how you like things, and it keeps it here.</li>}
      </ul>
      <form className="pj-fact-add" onSubmit={add}>
        <input value={adding} onChange={e=>setAdding(e.target.value)} maxLength={400} placeholder="Add a fact, e.g. #launch Launch is on December 3" aria-label="Add a fact to memory"/>
        <button disabled={!adding.trim()}>Add</button>
      </form>
    </section>
    <section className="pj-panel pj-instructions">
      <div className="pj-panel-head"><div><h3>Instructions</h3><p>Every message to the coordinator and the team carries these.</p></div><button type="button" className="sp-instructions" onClick={onInstructions}><InstructionsGlyph/>{space.memory.trim()?'Edit':'Add'}</button></div>
      {space.memory.trim()?<blockquote>{space.memory.trim().slice(0,600)}{space.memory.length>600?'…':''}</blockquote>:<p className="pj-muted">No instructions yet: goals, tone, constraints.</p>}
    </section>
    {chats.length>0&&<section className="pj-panel pj-older">
      <div className="pj-panel-head"><div><h3>Earlier chats</h3><p>Chats from this project before it had a coordinator.</p></div></div>
      {[...chats].sort((a,b)=>b.updated-a.updated).slice(0,6).map(c=><button className="sp-row" key={c.id} onClick={()=>actions.onOpenChat(c)}><span>{c.title}</span><small>{ago(c.updated)}</small></button>)}
    </section>}
    <section className="pj-panel pj-files">
      <div className="pj-panel-head"><div><h3>Files</h3><p>Mark a file Source and the team reads it when it matters.</p></div></div>
      <FilesView space={space} files={files} actions={actions} driveSync={driveSync}/>
    </section>
  </div>;
}

/** "#launch #dates Launch is on Dec 3" → tags and text. */
function splitTags(raw:string){const tags=[...raw.matchAll(/#([\p{L}\p{N}-]+)/gu)].map(m=>m[1]);return {tags,text:raw.replace(/#[\p{L}\p{N}-]+/gu,'').replace(/\s+/g,' ').trim()};}

function FactEdit({fact,onSave,onCancel}:{fact:MemoryEntry;onSave:(text:string,tags:string[])=>void;onCancel:()=>void}){
  const [value,setValue]=useState(`${fact.tags.map(t=>'#'+t).join(' ')} ${fact.text}`.trim());
  const save=()=>{const {text,tags}=splitTags(value);if(text)onSave(text,tags);else onCancel();};
  return <form className="pj-fact-edit" onSubmit={e=>{e.preventDefault();save();}}><input autoFocus value={value} maxLength={460} aria-label="Edit fact" onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')onCancel();}}/><button>Save</button><button type="button" onClick={onCancel}>Cancel</button></form>;
}

