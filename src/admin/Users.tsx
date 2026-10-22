import {useEffect,useState} from 'react';
import {adminApi,type Person,type Staff} from './api';
import {Avatar,Badge,Empty,ErrorNote,I,Modal,PageHead,PersonStatus,Skeleton,ago,copy,date,useLoad,useToast,who,Select} from './ui';
import type {Go} from './AdminApp';
import {productName} from './products';

// "Setting up" is Clem's four-step welcome; "No product yet" is an account that hasn't opened any lab product.
const filters=[['all','Everyone'],['active','Active this week'],['new','New this week'],['account','No product yet'],['setup','Setting up Clem'],['suspended','Suspended']] as const;

function toCsv(rows:Person[]){
  const cols=['id','email','products','username','display_name','setup_step','suspended','created_at','last_sign_in_at','first_seen_at','last_seen_at','cases'] as const;
  // Names are typed by people themselves; a leading = + - @ would run as a formula when staff open the file in a spreadsheet.
  const cell=(v:unknown)=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
  return [cols.join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\n');
}

export function Users({go,selected,staff}:{go:Go;selected?:string;staff:Staff}){
  const [q,setQ]=useState('');const [query,setQuery]=useState('');const [plan,setPlan]=useState('all');
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),250);return()=>clearTimeout(t);},[q]);
  const {data,error,loading,reload}=useLoad(()=>adminApi<{users:Person[];total:number}>(`/admin/users?q=${encodeURIComponent(query)}&plan=${plan}`),[query,plan]);
  function exportCsv(){if(!data)return;const url=URL.createObjectURL(new Blob([toCsv(data.users)],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`m4labs-accounts-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
  return <div className="adm-page">
    <PageHead scene="invite" title="Accounts" line={data?`${data.total} M4 Labs ${data.total===1?'account':'accounts'}${plan==='all'?'. One account signs in to every lab product.':' match.'}`:'Every M4 Labs account, across the lab’s products.'}><button className="adm-ghost" onClick={exportCsv} disabled={!data?.users.length}><I name="download"/>Export CSV</button></PageHead>
    <div className="adm-toolbar">
      <label className="adm-search"><I name="search"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search email, username or ID" aria-label="Search accounts"/></label>
      <div className="adm-segment" role="tablist">{filters.map(([value,label])=><button key={value} role="tab" aria-selected={plan===value} className={plan===value?'on':''} onClick={()=>setPlan(value)}>{label}</button>)}</div>
    </div>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton rows={9}/>:data!.users.length?
    <div className="adm-table-wrap"><table className="adm-table">
      <thead><tr><th>Account</th><th>Products</th><th>Status</th><th>Last seen</th><th>Joined</th><th className="num">Cases</th></tr></thead>
      <tbody>{data!.users.map(p=><tr key={p.id} className={selected===p.id?'selected':''} onClick={()=>go('accounts',p.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')go('accounts',p.id);}}>
        <td><div className="adm-person"><Avatar person={p}/><span><strong>{who(p)}</strong><small>{p.email||'Email not recorded yet'}</small></span></div></td>
        <td><div className="adm-chips">{p.products?.length?p.products.map(id=><Badge key={id}>{productName(id)}</Badge>):<span className="adm-muted">—</span>}</div></td>
        <td><PersonStatus person={p}/></td>
        <td>{ago(p.last_seen_at||p.last_sign_in_at)}</td><td>{date(p.created_at||p.first_seen_at)}</td><td className="num">{p.cases||''}</td>
      </tr>)}</tbody>
    </table></div>:<Empty scene="kite" title={query||plan!=='all'?'No matches':'No accounts yet'}>{query||plan!=='all'?'Try a different search or filter.':'Accounts appear here once someone signs up for any M4 Labs product.'}</Empty>}
    {selected&&<PersonDrawer id={selected} staff={staff} onClose={()=>go('accounts')} onChanged={reload} go={go}/>}
  </div>;
}

type Detail={user:Person;owner:boolean;moderation:{status:string;reason:string;until:string|null;updated_at:string}|null;notes:{id:string;author_email:string;body:string;created_at:string}[];cases:{id:string;subject:string;status:string;priority:string;created_at:string}[];directory:{email:string;created_at:string;last_sign_in_at:string;confirmed:boolean;mfa:boolean;providers:string[]}|null;history:{id:string;action:string;actor_email:string;detail:string;created_at:string}[]};

function PersonDrawer({id,staff,onClose,onChanged,go}:{id:string;staff:Staff;onClose:()=>void;onChanged:()=>void;go:Go}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<Detail>('/admin/users/'+id),[id]);
  const [dialog,setDialog]=useState<null|'suspend'>(null);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const admin=staff.role!=='support';
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!dialog)onClose();};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[dialog,onClose]);
  async function act(path:string,body:unknown,done:string){setBusy(true);try{await adminApi(`/admin/users/${id}/${path}`,body);toast(done);setDialog(null);await reload();onChanged();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  const d=data;
  return <><div className="adm-scrim" onClick={onClose}/><aside className="adm-drawer" aria-label="Account details">
    <header><button className="adm-icon" aria-label="Close" onClick={onClose}><I name="close"/></button></header>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!d?<Skeleton rows={10}/>:d&&<>
      <div className="adm-drawer-hero"><Avatar person={d.user} size={56}/><div><h2>{who(d.user)}</h2><p>{d.user.email||d.directory?.email||'Email not recorded'}</p><div className="adm-chips"><PersonStatus person={d.user}/>{d.directory?.mfa&&<Badge tone="ok">MFA</Badge>}</div></div></div>
      <dl className="adm-facts">
        <div><dt>Products</dt><dd>{d.user.products?.length?d.user.products.map(productName).join(', '):'None yet'}</dd></div>
        <div><dt>Account created</dt><dd>{date(d.directory?.created_at||d.user.created_at)}</dd></div>
        {!!d.user.products?.includes('clem')&&<>
        <div><dt>Clem username</dt><dd>{d.user.username?'@'+d.user.username:'—'}</dd></div>
        <div><dt>Clem setup</dt><dd>{(d.user.setup_step??0)>=4?'Finished':`${d.user.setup_step??0} of 4 steps`}</dd></div>
        <div><dt>First in Clem</dt><dd>{date(d.user.first_seen_at)}</dd></div>
        <div><dt>Last in Clem</dt><dd>{ago(d.user.last_seen_at)}</dd></div></>}
        {d.directory&&<div><dt>Sign-in</dt><dd>{d.directory.providers.join(', ')||'email'} · {ago(d.directory.last_sign_in_at)}</dd></div>}
        <div className="wide"><dt>User ID</dt><dd><button className="adm-mono" onClick={()=>copy(d.user.id,toast)} title="Copy ID">{d.user.id}<I name="copy" size={13}/></button></dd></div>
      </dl>
      {d.user.suspended&&d.moderation&&<div className="adm-alert danger"><I name="ban"/><div><strong>Suspended{d.moderation.until?` until ${date(d.moderation.until)}`:''}</strong><p>{d.moderation.reason}</p></div></div>}
      {admin&&<div className="adm-actions">
        <button disabled={!d.user.email} title={d.user.email?undefined:'No email on record'} onClick={()=>go('emails',d.user.id)}><I name="send"/>Send email</button>
        {!d.owner&&!!d.user.products?.length&&(d.user.suspended?<button disabled={busy} onClick={()=>act('unsuspend',{},'Suspension lifted')}><I name="check"/>Lift suspension</button>:<button className="danger" onClick={()=>setDialog('suspend')}><I name="ban"/>Suspend</button>)}
      </div>}
      <section className="adm-drawer-section"><h3>Support cases</h3>
        {d.cases.length?d.cases.map(c=><button className="adm-row link" key={c.id} onClick={()=>go('cases',c.id)}><div><strong>{c.subject}</strong><small>{c.status} · {date(c.created_at)}</small></div><I name="arrow" size={15}/></button>):<p className="adm-muted">No cases.</p>}
      </section>
      <section className="adm-drawer-section"><h3>Staff notes</h3>
        <form className="adm-note-form" onSubmit={e=>{e.preventDefault();if(note.trim())void act('note',{body:note},'Note saved').then(()=>setNote(''));}}><textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Add a private note for the team…"/><button disabled={busy||!note.trim()}>Save note</button></form>
        {d.notes.map(n=><div className="adm-note" key={n.id}><p>{n.body}</p><small>{n.author_email} · {ago(n.created_at)}</small></div>)}
      </section>
      {!!d.history.length&&<section className="adm-drawer-section"><h3>History</h3><ul className="adm-timeline compact">{d.history.map(h=><li key={h.id}><span className="dot"/><div><strong>{h.action.replace(/[._]/g,' ')}</strong><small>{h.actor_email} · {ago(h.created_at)}</small>{h.detail&&<p>{h.detail}</p>}</div></li>)}</ul></section>}
    </>}
  </aside>
  {dialog==='suspend'&&<Modal title="Suspend this account" onClose={()=>setDialog(null)}><form className="adm-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const days=String(f.get('days'));void act('suspend',{reason:String(f.get('reason')),days:days==='forever'?null:Number(days)},'Account suspended');}}>
    <label>Reason shown to the person<textarea name="reason" required minLength={3} maxLength={500} rows={3} placeholder="Explain what happened and how to appeal."/></label>
    <label>Length<Select name="days" defaultValue="7" options={[{value:'1',label:'1 day'},{value:'7',label:'1 week'},{value:'30',label:'1 month'},{value:'forever',label:'Until lifted'}]}/></label>
    <p className="adm-muted">Their workspace closes the next time the app checks access. Local files on their PC are never touched.</p>
    <footer><button type="button" onClick={()=>setDialog(null)}>Cancel</button><button className="adm-primary danger" disabled={busy}>Suspend</button></footer></form></Modal>}
  </>;
}
