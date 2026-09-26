import {useEffect,useRef,useState} from 'react';
import {adminApi,type CaseRow} from './api';
import {Avatar,Badge,Empty,ErrorNote,I,PageHead,Skeleton,ago,date,useLoad,useToast,who} from './ui';
import type {Go} from './AdminApp';

const statuses=[['active','Active'],['open','Open'],['pending','Waiting on person'],['resolved','Resolved'],['closed','Closed'],['all','All']] as const;
const priorityTone:Record<string,string>={urgent:'danger',high:'warn',normal:'neutral',low:'quiet'};
const replies=['Thanks for reaching out — I\'m looking into this now and will update you shortly.','This is fixed in the latest build. Please update Mowr from mowrai.com/download and let us know if it happens again.','Could you share the steps that lead to this, and your Mowr version (Settings → About)?'];

export function Cases({go,selected}:{go:Go;selected?:string}){
  const [status,setStatus]=useState('active');const [q,setQ]=useState('');const [query,setQuery]=useState('');
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),250);return()=>clearTimeout(t);},[q]);
  const list=useLoad(()=>adminApi<{cases:CaseRow[]}>(`/admin/cases?status=${status}&q=${encodeURIComponent(query)}`),[status,query]);
  return <div className="adm-page adm-inbox-page">
    <PageHead scene="lifebuoy" title="Support cases" line="Questions, bug reports and ideas from people using Mowr."><button className="adm-ghost" onClick={list.reload}><I name="refresh"/>Refresh</button></PageHead>
    <div className="adm-inbox">
      <section className="adm-inbox-list">
        <div className="adm-inbox-tools"><label className="adm-search"><I name="search"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search cases" aria-label="Search cases"/></label>
        <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter by status">{statuses.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        {list.error?<ErrorNote error={list.error} onRetry={list.reload}/>:list.loading&&!list.data?<Skeleton rows={7}/>:list.data!.cases.length?<ul>{list.data!.cases.map(c=><li key={c.id}><button className={selected===c.id?'on':''} onClick={()=>go('cases',c.id)}>
          <span className="adm-inbox-row-top"><strong>{c.email||c.username||'Unknown person'}</strong><small>{ago(c.updated_at)}</small></span>
          <span className="adm-inbox-subject">{c.awaiting_staff&&<i className="adm-unread" aria-label="Awaiting reply"/>}{c.subject}</span>
          <span className="adm-chips"><Badge tone={priorityTone[c.priority]}>{c.priority}</Badge><Badge>{c.category.replace('Contact support','Help').replace('Report a bug','Bug').replace('Suggest a feature','Idea')}</Badge>{c.status!=='open'&&<Badge tone="quiet">{c.status}</Badge>}</span>
        </button></li>)}</ul>:<Empty scene="lifebuoy" title="Nothing here">{status==='active'?'Every case has been handled.':'No cases match this filter.'}</Empty>}
      </section>
      <section className="adm-inbox-detail">{selected?<CaseDetail key={selected} id={selected} go={go} onChanged={list.reload}/>:<Empty scene="conversation" title="Choose a case">Pick a conversation to read and reply.</Empty>}</section>
    </div>
  </div>;
}

type Message={id:string;author:'user'|'staff'|'note';author_name:string;body:string;created_at:string};
type Detail={case:CaseRow&{message:string;display_name?:string;last_seen_at?:string;user_seen_at?:string};messages:Message[];otherCases:{id:string;subject:string;status:string;created_at:string}[];team:{id:string;email:string;role:string}[]};

function CaseDetail({id,go,onChanged}:{id:string;go:Go;onChanged:()=>void}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<Detail>('/admin/cases/'+id),[id]);
  const [body,setBody]=useState('');const [internal,setInternal]=useState(false);const [busy,setBusy]=useState(false);
  const end=useRef<HTMLDivElement>(null);
  useEffect(()=>{end.current?.scrollIntoView({block:'end'});},[data?.messages.length]);
  async function update(fields:Record<string,unknown>,done:string){setBusy(true);try{await adminApi(`/admin/cases/${id}/update`,fields);toast(done);await reload();onChanged();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  async function send(status?:string){if(body.trim().length<2)return;setBusy(true);try{await adminApi(`/admin/cases/${id}/reply`,{body,internal,...(status?{status}:{})});toast(internal?'Note added':'Reply sent to the app');setBody('');await reload();onChanged();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  if(error)return <ErrorNote error={error} onRetry={reload}/>;
  if(loading&&!data)return <Skeleton rows={8}/>;
  const {case:c,messages,otherCases,team}=data!;
  const seen=c.user_seen_at&&messages.filter(m=>m.author==='staff').some(m=>m.created_at<=c.user_seen_at!);
  return <div className="adm-case">
    <header className="adm-case-head">
      <div><span className="adm-muted">{c.category} · opened {date(c.created_at)}</span><h2>{c.subject}</h2></div>
      <div className="adm-case-controls">
        <select value={c.status} disabled={busy} onChange={e=>void update({status:e.target.value},'Status updated')} aria-label="Status"><option value="open">Open</option><option value="pending">Waiting on person</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>
        <select value={c.priority} disabled={busy} onChange={e=>void update({priority:e.target.value},'Priority updated')} aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
        <select value={c.assignee_id||''} disabled={busy} onChange={e=>void update({assigneeId:e.target.value||null},'Assignment updated')} aria-label="Assignee"><option value="">Unassigned</option>{team.map(t=><option key={t.id} value={t.id}>{t.email}</option>)}</select>
      </div>
    </header>
    <div className="adm-case-body">
      <div className="adm-thread">
        <article className="adm-msg user"><Avatar person={{id:c.owner_id,email:c.email,username:c.username}} size={30}/><div><header><strong>{who({email:c.email,username:c.username,display_name:c.display_name})}</strong><small>{ago(c.created_at)}</small></header><p>{c.message}</p></div></article>
        {messages.map(m=><article key={m.id} className={`adm-msg ${m.author}`}>{m.author==='user'?<Avatar person={{id:c.owner_id,email:c.email,username:c.username}} size={30}/>:<span className="adm-msg-mark">{m.author==='note'?<I name="note" size={15}/>:'M'}</span>}<div><header><strong>{m.author==='user'?who({email:c.email,username:c.username}):m.author==='note'?'Internal note':'Mowr support'}</strong><small>{ago(m.created_at)}</small></header><p>{m.body}</p></div></article>)}
        {seen&&<p className="adm-seen"><I name="check" size={13}/>Seen in the app</p>}
        <div ref={end}/>
      </div>
      <aside className="adm-case-side">
        <h3>Requester</h3>
        <button className="adm-person link" onClick={()=>go('users',c.owner_id)}><Avatar person={{id:c.owner_id,email:c.email,username:c.username}}/><span><strong>{who({email:c.email,username:c.username,display_name:c.display_name})}</strong><small>{c.email}</small></span></button>
        <dl className="adm-facts single"><div><dt>Last seen</dt><dd>{ago(c.last_seen_at)}</dd></div><div><dt>Cases</dt><dd>{otherCases.length+1}</dd></div></dl>
        {!!otherCases.length&&<><h3>Other cases</h3>{otherCases.map(o=><button key={o.id} className="adm-row link" onClick={()=>go('cases',o.id)}><div><strong>{o.subject}</strong><small>{o.status} · {date(o.created_at)}</small></div></button>)}</>}
        {c.email&&<a className="adm-ghost" href={`mailto:${c.email}?subject=${encodeURIComponent('Re: '+c.subject)}`}><I name="external"/>Email instead</a>}
      </aside>
    </div>
    <form className={`adm-composer ${internal?'internal':''}`} onSubmit={e=>{e.preventDefault();void send();}}>
      <div className="adm-composer-tabs"><button type="button" className={!internal?'on':''} onClick={()=>setInternal(false)}>Reply</button><button type="button" className={internal?'on':''} onClick={()=>setInternal(true)}>Internal note</button>
        {!internal&&<select aria-label="Insert a saved reply" value="" onChange={e=>{if(e.target.value)setBody(b=>(b?b+'\n\n':'')+e.target.value);}}><option value="">Saved replies…</option>{replies.map(r=><option key={r} value={r}>{r.slice(0,60)}…</option>)}</select>}</div>
      <textarea value={body} onChange={e=>setBody(e.target.value)} rows={4} maxLength={10000} placeholder={internal?'Only the team can see this.':'Write a reply. It appears in the person\'s Mowr app under Support.'} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))void send();}}/>
      <footer><small className="adm-muted">Ctrl + Enter to send</small><div>{!internal&&<button type="button" disabled={busy||body.trim().length<2} onClick={()=>void send('resolved')}>Send & resolve</button>}<button className="adm-primary" disabled={busy||body.trim().length<2}><I name="send" size={15}/>{internal?'Add note':'Send reply'}</button></div></footer>
    </form>
  </div>;
}
