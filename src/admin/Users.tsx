import {useEffect,useState} from 'react';
import {confirmDialog} from '../dialogs';
import {adminApi,type Person,type Staff} from './api';
import {Avatar,Badge,Empty,ErrorNote,I,Modal,PlanBadge,Skeleton,ago,copy,date,useLoad,useToast,who} from './ui';
import type {Go} from './AdminApp';

const filters=[['all','Everyone'],['paying','Paying'],['complimentary','Complimentary'],['free','No plan'],['past_due','Past due'],['suspended','Suspended']] as const;

function toCsv(rows:Person[]){
  const cols=['id','email','username','display_name','plan','until','suspended','first_seen_at','last_seen_at','cases'] as const;
  const cell=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
  return [cols.join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\n');
}

export function Users({go,selected,staff}:{go:Go;selected?:string;staff:Staff}){
  const [q,setQ]=useState('');const [query,setQuery]=useState('');const [plan,setPlan]=useState('all');
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),250);return()=>clearTimeout(t);},[q]);
  const {data,error,loading,reload}=useLoad(()=>adminApi<{users:Person[];total:number}>(`/admin/users?q=${encodeURIComponent(query)}&plan=${plan}`),[query,plan]);
  function exportCsv(){if(!data)return;const url=URL.createObjectURL(new Blob([toCsv(data.users)],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`mowr-people-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
  return <div className="adm-page">
    <header className="adm-page-head"><div><h1>People</h1><p>{data?`${data.total} ${data.total===1?'person':'people'}`:'Everyone who has used Mowr.'}</p></div><button className="adm-ghost" onClick={exportCsv} disabled={!data?.users.length}><I name="download"/>Export CSV</button></header>
    <div className="adm-toolbar">
      <label className="adm-search"><I name="search"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search email, username or ID" aria-label="Search people"/></label>
      <div className="adm-segment" role="tablist">{filters.map(([value,label])=><button key={value} role="tab" aria-selected={plan===value} className={plan===value?'on':''} onClick={()=>setPlan(value)}>{label}</button>)}</div>
    </div>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton rows={9}/>:data!.users.length?
    <div className="adm-table-wrap"><table className="adm-table">
      <thead><tr><th>Person</th><th>Plan</th><th>Last seen</th><th>Joined</th><th>Cases</th></tr></thead>
      <tbody>{data!.users.map(p=><tr key={p.id} className={selected===p.id?'selected':''} onClick={()=>go('users',p.id)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')go('users',p.id);}}>
        <td><div className="adm-person"><Avatar person={p}/><span><strong>{who(p)}</strong><small>{p.email||'Email not recorded yet'}</small></span></div></td>
        <td><PlanBadge plan={p.plan}/>{p.suspended&&<Badge tone="danger">Suspended</Badge>}</td>
        <td>{ago(p.last_seen_at)}</td><td>{date(p.first_seen_at)}</td><td>{p.cases||''}</td>
      </tr>)}</tbody>
    </table></div>:<Empty icon="users" title={query?'No matches':'No people yet'}>{query?'Try a different search or filter.':'People appear here after they sign in to the desktop app.'}</Empty>}
    {selected&&<PersonDrawer id={selected} staff={staff} onClose={()=>go('users')} onChanged={reload} go={go}/>}
  </div>;
}

type Detail={user:Person;subscriptions:{subscription_id:string;status:string;valid_until:string|null;updated_at:string}[];grants:{id:string;reason:string;valid_until:string|null;created_at:string;revoked_at:string|null;active:boolean}[];owner:boolean;moderation:{status:string;reason:string;until:string|null;updated_at:string}|null;notes:{id:string;author_email:string;body:string;created_at:string}[];cases:{id:string;subject:string;status:string;priority:string;created_at:string}[];directory:{email:string;created_at:string;last_sign_in_at:string;confirmed:boolean;mfa:boolean;providers:string[]}|null;history:{id:string;action:string;actor_email:string;detail:string;created_at:string}[]};

function PersonDrawer({id,staff,onClose,onChanged,go}:{id:string;staff:Staff;onClose:()=>void;onChanged:()=>void;go:Go}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<Detail>('/admin/users/'+id),[id]);
  const [dialog,setDialog]=useState<null|'grant'|'suspend'>(null);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');
  const admin=staff.role!=='support';
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!dialog)onClose();};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[dialog,onClose]);
  async function act(path:string,body:unknown,done:string){setBusy(true);try{await adminApi(`/admin/users/${id}/${path}`,body);toast(done);setDialog(null);await reload();onChanged();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  const d=data;
  return <><div className="adm-scrim" onClick={onClose}/><aside className="adm-drawer" aria-label="Person details">
    <header><button className="adm-icon" aria-label="Close" onClick={onClose}><I name="close"/></button></header>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!d?<Skeleton rows={10}/>:d&&<>
      <div className="adm-drawer-hero"><Avatar person={d.user} size={56}/><div><h2>{who(d.user)}</h2><p>{d.user.email||d.directory?.email||'Email not recorded'}</p><div className="adm-chips"><PlanBadge plan={d.user.plan}/>{d.user.suspended&&<Badge tone="danger">Suspended</Badge>}{d.directory?.mfa&&<Badge tone="ok">MFA</Badge>}</div></div></div>
      <dl className="adm-facts">
        <div><dt>Username</dt><dd>{d.user.username?'@'+d.user.username:'—'}</dd></div>
        <div><dt>Setup</dt><dd>{d.user.setup_step!=null?`Step ${d.user.setup_step} of 4`:'Not started'}</dd></div>
        <div><dt>First seen</dt><dd>{date(d.user.first_seen_at)}</dd></div>
        <div><dt>Last seen</dt><dd>{ago(d.user.last_seen_at)}</dd></div>
        {d.user.until&&<div><dt>Access until</dt><dd>{date(d.user.until)}</dd></div>}
        {d.directory&&<div><dt>Sign-in</dt><dd>{d.directory.providers.join(', ')||'email'} · {ago(d.directory.last_sign_in_at)}</dd></div>}
        <div className="wide"><dt>User ID</dt><dd><button className="adm-mono" onClick={()=>copy(d.user.id,toast)} title="Copy ID">{d.user.id}<I name="copy" size={13}/></button></dd></div>
      </dl>
      {d.user.suspended&&d.moderation&&<div className="adm-alert danger"><I name="ban"/><div><strong>Suspended{d.moderation.until?` until ${date(d.moderation.until)}`:''}</strong><p>{d.moderation.reason}</p></div></div>}
      {admin&&!d.owner&&<div className="adm-actions">
        <button onClick={()=>setDialog('grant')}><I name="gift"/>Give free access</button>
        {d.user.suspended?<button disabled={busy} onClick={()=>act('unsuspend',{},'Suspension lifted')}><I name="check"/>Lift suspension</button>:<button className="danger" onClick={()=>setDialog('suspend')}><I name="ban"/>Suspend</button>}
      </div>}
      <section className="adm-drawer-section"><h3>Subscription</h3>
        {d.subscriptions.length?d.subscriptions.map(s=><div className="adm-row" key={s.subscription_id}><div><strong>Lemon #{s.subscription_id}</strong><small>{s.status} · {s.valid_until?`until ${date(s.valid_until)}`:'no end date'}</small></div>{admin&&staff.lemon&&<div className="adm-row-actions"><button disabled={busy} onClick={()=>act('sync-subscription',{subscriptionId:s.subscription_id},'Synced from Lemon Squeezy')}><I name="refresh" size={15}/>Sync</button>{['active','on_trial','past_due'].includes(s.status)&&<button className="danger" disabled={busy} onClick={async()=>{if(await confirmDialog({title:'Cancel this subscription?',message:'It ends at the close of the current billing period.',confirm:'Cancel subscription',cancel:'Keep it',danger:true}))void act('cancel-subscription',{subscriptionId:s.subscription_id},'Subscription cancelled');}}>Cancel</button>}</div>}</div>):<p className="adm-muted">No paid subscription.</p>}
        {d.grants.map(g=><div className={`adm-row ${g.active?'':'muted'}`} key={g.id}><div><strong>Complimentary {g.active?'':'(ended)'}</strong><small>{g.reason||'No reason given'} · {g.valid_until?`until ${date(g.valid_until)}`:'no expiry'}{g.revoked_at?` · revoked ${date(g.revoked_at)}`:''}</small></div>{admin&&g.active&&<button disabled={busy} onClick={()=>act('revoke-grant',{grantId:g.id},'Free access revoked')}>Revoke</button>}</div>)}
      </section>
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
  {dialog==='grant'&&<Modal title="Give free access" onClose={()=>setDialog(null)}><form className="adm-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const days=String(f.get('days'));void act('grant',{days:days==='forever'?null:Number(days),reason:String(f.get('reason')||'')},'Free access granted');}}>
    <label>Duration<select name="days" defaultValue="30"><option value="7">1 week</option><option value="30">1 month</option><option value="90">3 months</option><option value="365">1 year</option><option value="forever">No expiry</option></select></label>
    <label>Reason<input name="reason" maxLength={300} placeholder="Beta tester, refund goodwill, partner…"/></label>
    <p className="adm-muted">Access unlocks the next time the app checks entitlement. It doesn't touch any paid subscription.</p>
    <footer><button type="button" onClick={()=>setDialog(null)}>Cancel</button><button className="adm-primary" disabled={busy}>Grant access</button></footer></form></Modal>}
  {dialog==='suspend'&&<Modal title="Suspend this account" onClose={()=>setDialog(null)}><form className="adm-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const days=String(f.get('days'));void act('suspend',{reason:String(f.get('reason')),days:days==='forever'?null:Number(days)},'Account suspended');}}>
    <label>Reason shown to the person<textarea name="reason" required minLength={3} maxLength={500} rows={3} placeholder="Explain what happened and how to appeal."/></label>
    <label>Length<select name="days" defaultValue="7"><option value="1">1 day</option><option value="7">1 week</option><option value="30">1 month</option><option value="forever">Until lifted</option></select></label>
    <p className="adm-muted">The workspace closes at the next entitlement check and checkout is blocked. Local files on their PC are never touched.</p>
    <footer><button type="button" onClick={()=>setDialog(null)}>Cancel</button><button className="adm-primary danger" disabled={busy}>Suspend</button></footer></form></Modal>}
  </>;
}
