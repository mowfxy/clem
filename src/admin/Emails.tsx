import {useEffect,useState} from 'react';
import {adminApi,mailApi,type MailPreset,type Person} from './api';
import {Avatar,Empty,ErrorNote,I,PageHead,Select,Skeleton,ago,useLoad,useToast,who} from './ui';
import type {Go} from './AdminApp';

type Entry={id:string;actor_email:string;action:string;target:string;detail:string;created_at:string};
/** `id` is empty for an address typed in by hand that has no M4 Labs account. */
type Recipient=Pick<Person,'id'|'email'|'username'|'display_name'>;
const looksLikeEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** #/emails lists what staff sent; #/emails/new writes one; #/emails/<account id> writes to that account. */
export function Emails({go,compose}:{go:Go;compose?:string}){
  if(compose)return <Compose go={go} personId={compose==='new'?undefined:compose}/>;
  return <SentEmails go={go}/>;
}

function SentEmails({go}:{go:Go}){
  const {data,error,loading,reload}=useLoad(()=>adminApi<{entries:Entry[]}>('/admin/audit?q=email.send'),[]);
  const sent=data?.entries.filter(e=>e.action==='email.send')||[];
  // The audit detail reads "<kind> · <subject> → <address>"; the target is an account id, or the address itself.
  const parts=(e:Entry)=>{const rest=e.detail.split(' · ').slice(1).join(' · ')||e.detail;const at=rest.lastIndexOf(' → ');return at<0?{subject:rest,to:''}:{subject:rest.slice(0,at),to:rest.slice(at+3)};};
  return <div className="adm-page">
    <PageHead title="Emails" line="Write to any M4 Labs account or email address, or send one of the preset emails. Automatic emails go out on their own."><button className="adm-primary" onClick={()=>go('emails','new')}><I name="plus" size={15}/>New email</button></PageHead>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:sent.length?<div className="adm-table-wrap"><table className="adm-table">
      <thead><tr><th>Subject</th><th>To</th><th>Sent by</th><th>When</th></tr></thead>
      <tbody>{sent.map(e=>{const person=!e.target.includes('@'),p=parts(e);return <tr key={e.id} className={person?'':'static'} onClick={()=>{if(person)go('accounts',e.target);}}><td><strong>{p.subject}</strong></td><td>{p.to||(person?'Account':e.target)}</td><td>{e.actor_email}</td><td>{ago(e.created_at)}</td></tr>;})}</tbody>
    </table></div>:<div className="adm-card"><Empty icon="send" title="No emails sent yet">Emails staff send from here or from an account appear in this list.</Empty></div>}
  </div>;
}

/** A page of its own: the message on the left, the exact email on the right. */
function Compose({go,personId}:{go:Go;personId?:string}){
  const toast=useToast();
  const [to,setTo]=useState<Recipient|null>(null);
  const [kind,setKind]=useState('custom');
  const [subject,setSubject]=useState('');
  const [message,setMessage]=useState('');
  const [version,setVersion]=useState('');
  const [notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false);
  const presets=useLoad(()=>mailApi<{presets:MailPreset[];ready:boolean}>('/presets'),[]);
  const [preview,setPreview]=useState<{subject:string;html:string}|null>(null);
  // Opened from an account: start addressed to that person.
  useEffect(()=>{if(!personId)return;void adminApi<{user:Person}>('/admin/users/'+personId).then(d=>setTo(d.user)).catch(e=>toast((e as Error).message,'error'));},[personId]);
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
    try{const r=await mailApi<{to:string}>('/send',{kind,...target,version,notes,subject,message});toast(`Sent to ${r.to}`);go('emails');}
    catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}
  }
  const ready=presets.data?.ready!==false;
  const preset=presets.data?.presets.find(p=>p.id===kind);
  return <div className="adm-page adm-compose-page">
    <PageHead back={{label:'Emails',onClick:()=>go('emails')}} title="New email" line="It goes out right away in the same design as the automatic emails, and is kept in the audit log."/>
    <form className="adm-compose-grid" onSubmit={e=>{e.preventDefault();void send();}}>
      <section className="adm-card adm-compose-form">
        <div className="adm-field"><span className="adm-field-label">To</span>
          {to?<div className="adm-mail-to"><Avatar person={to} size={32}/><span className="adm-mail-who"><strong>{who(to)}</strong><small>{to.email||'No email on record'}</small></span><button type="button" className="adm-icon" aria-label="Choose someone else" onClick={()=>setTo(null)}><I name="close" size={15}/></button></div>
          :personId?<Skeleton rows={1}/>:<PersonPicker onPick={setTo}/>}
        </div>
        <div className="adm-field"><span className="adm-field-label">Email</span>
          {presets.error?<ErrorNote error={presets.error} onRetry={presets.reload}/>:!presets.data?<Skeleton rows={1}/>:<>
            <Select aria-label="Which email" value={kind} onChange={setKind} options={presets.data.presets.map(p=>({value:p.id,label:p.label}))}/>
            {preset?.about&&<small className="adm-field-help">{preset.about}</small>}
          </>}
        </div>
        {kind==='custom'&&<>
          <label className="adm-field"><span className="adm-field-label">Subject</span><input value={subject} onChange={e=>setSubject(e.target.value)} required maxLength={150} placeholder="About your M4 Labs account"/></label>
          <label className="adm-field"><span className="adm-field-label">Message</span><textarea value={message} onChange={e=>setMessage(e.target.value)} required minLength={2} maxLength={10000} rows={10} placeholder="Write it like a normal email. Line breaks are kept."/><small className="adm-field-help">It opens with “Hi” and their first name when we know it.</small></label>
        </>}
        {kind==='update'&&<>
          <label className="adm-field"><span className="adm-field-label">Version</span><input value={version} onChange={e=>setVersion(e.target.value)} required pattern="\d+\.\d+\.\d+(-[\w.]+)?" placeholder="0.3.0"/></label>
          <label className="adm-field"><span className="adm-field-label">What changed</span><textarea value={notes} onChange={e=>setNotes(e.target.value)} required maxLength={2000} rows={8} placeholder={'Flashcards follow your exam date\nTidier recent files'}/><small className="adm-field-help">One change per line.</small></label>
        </>}
        {kind!=='custom'&&kind!=='update'&&<p className="adm-field-note">This email is already written. Check the preview, then send it.</p>}
        {!ready&&<p className="adm-alert danger">Email sending isn’t set up on the website yet, so nothing can be sent.</p>}
        <footer><button type="button" onClick={()=>go('emails')}>Cancel</button><button className="adm-primary" disabled={busy||!to?.email||!ready||!presets.data}><I name="send" size={15}/>{busy?'Sending…':'Send email'}</button></footer>
      </section>
      <section className="adm-compose-preview-pane" aria-label="Preview">
        <header><span>Preview</span><strong>{preview?.subject||'…'}</strong>{to?.email&&<small>to {to.email}</small>}</header>
        {preview?<iframe title="Email preview" sandbox="" srcDoc={preview.html}/>:<div className="adm-mail-frame-wait"><Skeleton rows={6}/></div>}
      </section>
    </form>
  </div>;
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
      {byHand&&<button type="button" className="adm-person link" onClick={pickTyped}><span className="adm-mail-at" aria-hidden="true">@</span><span><strong>Send to {typed}</strong><small>Not an M4 Labs account</small></span></button>}
      {loading&&!users.length?<Skeleton rows={2}/>:users.length?users.map(p=><button type="button" key={p.id} className="adm-person link" disabled={!p.email} onClick={()=>onPick(p)}><Avatar person={p} size={28}/><span><strong>{who(p)}</strong><small>{p.email||'No email on record'}</small></span></button>):!byHand&&<p className="adm-muted">No one matches. Type a full email address to write to anyone.</p>}
    </div>}
  </div>;
}
