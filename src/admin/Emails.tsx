import {useEffect,useState} from 'react';
import {adminApi,mailApi,type MailPreset,type Person} from './api';
import {Avatar,Empty,ErrorNote,I,Modal,PageHead,Skeleton,ago,useLoad,useToast,who} from './ui';
import type {Go} from './AdminApp';

type Entry={id:string;actor_email:string;action:string;target:string;detail:string;created_at:string};
/** `id` is empty for an address typed in by hand that has no Mowr account. */
type Recipient=Pick<Person,'id'|'email'|'username'|'display_name'>;
const looksLikeEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function Emails({go}:{go:Go}){
  const [composing,setComposing]=useState(false);
  const {data,error,loading,reload}=useLoad(()=>adminApi<{entries:Entry[]}>('/admin/audit?q=email.send'),[]);
  const sent=data?.entries.filter(e=>e.action==='email.send')||[];
  return <div className="adm-page">
    <PageHead scene="envelope" title="Emails" line="Write to anyone, or send one of Mowr’s preset emails. The automatic emails keep going out on their own."><button className="adm-primary" onClick={()=>setComposing(true)}><I name="send" size={15}/>Send an email</button></PageHead>
    <section className="adm-card"><header><h2>Sent by staff</h2></header>
      {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:sent.length?<ul className="adm-list plain">{sent.map(e=><li key={e.id}>{e.target.includes('@')?<div className="adm-row"><div><strong>{e.detail.split(' · ').slice(1).join(' · ')||e.detail}</strong><small>{e.actor_email} · {ago(e.created_at)}</small></div></div>:<button className="adm-row link" onClick={()=>go('users',e.target)}><div><strong>{e.detail.split(' · ').slice(1).join(' · ')||e.detail}</strong><small>{e.actor_email} · {ago(e.created_at)}</small></div><I name="arrow" size={15}/></button>}</li>)}</ul>:<Empty scene="plane" title="Nothing sent yet">Emails you send from here, or from a person’s page, are listed here.</Empty>}
    </section>
    {composing&&<SendEmail onClose={()=>setComposing(false)} onSent={reload}/>}
  </div>;
}

/** Write a message or pick a preset, see exactly what the person gets, then send. Opened from the Emails page or a person's page. */
export function SendEmail({person,onClose,onSent}:{person?:Recipient;onClose:()=>void;onSent?:()=>void}){
  const toast=useToast();
  const [to,setTo]=useState<Recipient|null>(person||null);
  const [kind,setKind]=useState('custom');
  const [subject,setSubject]=useState('');
  const [message,setMessage]=useState('');
  const [version,setVersion]=useState('');
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const presets=useLoad(()=>mailApi<{presets:MailPreset[];ready:boolean}>('/presets'),[]);
  const [preview,setPreview]=useState<{subject:string;html:string}|null>(null);
  // Update emails announce the version the website offers now.
  useEffect(()=>{void fetch('/desktop-release.json').then(r=>r.json()).then(d=>setVersion(v=>v||String(d.version||''))).catch(()=>{});},[]);
  const target=to?(to.id?{userId:to.id}:{email:to.email}):{};
  useEffect(()=>{
    let live=true;
    const t=setTimeout(()=>{void mailApi<{subject:string;html:string}>('/preview',{kind,...target,version,notes,subject,message}).then(p=>{if(live)setPreview(p);}).catch(()=>{});},kind==='update'||kind==='custom'?400:0);
    return()=>{live=false;clearTimeout(t);};
  },[kind,to?.id,to?.email,version,notes,subject,message]);
  async function send(){
    if(!to)return;
    setBusy(true);
    try{const r=await mailApi<{to:string}>('/send',{kind,...target,version,notes,subject,message});toast(`Sent to ${r.to}`);onSent?.();onClose();}
    catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}
  }
  const ready=presets.data?.ready!==false;
  return <Modal wide title="Send an email" line="Uses the same design as the automatic emails. It goes out right away and is kept in the audit log." onClose={onClose}>
    <form className="adm-form adm-mail" onSubmit={e=>{e.preventDefault();void send();}}>
      <div className="adm-mail-fields">
        <div className="adm-mail-label">To</div>
        {to?<div className="adm-mail-to"><Avatar person={to} size={34}/><span className="adm-mail-who"><strong>{who(to)}</strong><small>{to.email||'No email on record'}</small></span>{!person&&<button type="button" className="adm-icon" aria-label="Choose someone else" onClick={()=>setTo(null)}><I name="close" size={15}/></button>}</div>:<PersonPicker onPick={setTo}/>}
        <div className="adm-mail-label">Email</div>
        {presets.error?<ErrorNote error={presets.error} onRetry={presets.reload}/>:!presets.data?<Skeleton rows={3}/>:<div className="adm-mail-presets" role="radiogroup" aria-label="Preset email">
          {presets.data.presets.map(p=><button type="button" role="radio" aria-checked={kind===p.id} key={p.id} className={kind===p.id?'on':''} onClick={()=>setKind(p.id)}><strong>{p.label}</strong><small>{p.about}</small></button>)}
        </div>}
        {kind==='custom'&&<>
          <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} required maxLength={150} placeholder="About your Mowr account"/></label>
          <label>Message<textarea value={message} onChange={e=>setMessage(e.target.value)} required minLength={2} rows={7} maxLength={10000} placeholder={'Write it like a normal email. Line breaks are kept.\nIt starts with “Hi” and their first name when Mowr knows it.'}/></label>
        </>}
        {kind==='update'&&<>
          <label>Version<input value={version} onChange={e=>setVersion(e.target.value)} required pattern="\d+\.\d+\.\d+(-[\w.]+)?" placeholder="0.3.0"/></label>
          <label>What changed, one per line<textarea value={notes} onChange={e=>setNotes(e.target.value)} required rows={4} maxLength={2000} placeholder={'Flashcards follow your exam date\nTidier recent files'}/></label>
        </>}
        {!ready&&<p className="adm-alert danger">Email sending is not set up on the website yet, so nothing can be sent.</p>}
      </div>
      <aside className="adm-mail-preview" aria-label="Preview">
        <div className="adm-mail-subject"><small>Subject</small><strong>{preview?.subject||'…'}</strong></div>
        {preview?<iframe title="Email preview" sandbox="" srcDoc={preview.html}/>:<div className="adm-mail-frame-wait"><Skeleton rows={6}/></div>}
      </aside>
      <footer><div><button type="button" onClick={onClose}>Cancel</button><button className="adm-primary" disabled={busy||!to?.email||!ready||!presets.data}><I name="send" size={15}/>{busy?'Sending…':to?.email?`Send to ${to.email}`:'Send'}</button></div></footer>
    </form>
  </Modal>;
}

function PersonPicker({onPick}:{onPick:(p:Recipient)=>void}){
  const [q,setQ]=useState('');const [query,setQuery]=useState('');
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),250);return()=>clearTimeout(t);},[q]);
  const {data,loading}=useLoad(()=>query?adminApi<{users:Person[]}>(`/admin/users?q=${encodeURIComponent(query)}`):Promise.resolve({users:[]}),[query]);
  const typed=q.trim().toLowerCase(),users=data?.users.slice(0,6)||[];
  // Anyone can be written to: an address with no account is offered as is.
  const byHand=looksLikeEmail(typed)&&!users.some(p=>p.email?.toLowerCase()===typed);
  const pickTyped=()=>onPick({id:'',email:typed,username:null,display_name:null});
  return <div className="adm-mail-picker">
    <label className="adm-search"><I name="search"/><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(byHand)pickTyped();else if(users.length===1&&users[0].email)onPick(users[0]);}}} placeholder="Search people, or type any email address" aria-label="Find a person" autoFocus/></label>
    {query&&<div className="adm-mail-results">
      {byHand&&<button type="button" className="adm-person link" onClick={pickTyped}><span className="adm-mail-at" aria-hidden="true">@</span><span><strong>Send to {typed}</strong><small>Not a Mowr account</small></span></button>}
      {loading&&!users.length?<Skeleton rows={2}/>:users.length?users.map(p=><button type="button" key={p.id} className="adm-person link" disabled={!p.email} onClick={()=>onPick(p)}><Avatar person={p} size={28}/><span><strong>{who(p)}</strong><small>{p.email||'No email on record'}</small></span></button>):!byHand&&<p className="adm-muted">No one matches. Type a full email address to write to anyone.</p>}
    </div>}
  </div>;
}
