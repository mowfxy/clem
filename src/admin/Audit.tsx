import {useEffect,useState} from 'react';
import {adminApi} from './api';
import {Empty,ErrorNote,I,Skeleton,date,useLoad} from './ui';
import type {Go} from './AdminApp';

type Entry={id:string;actor_email:string;action:string;target:string;detail:string;created_at:string};
const personAction=(action:string)=>/^(user|subscription|case)\./.test(action);

export function Audit({go}:{go:Go}){
  const [q,setQ]=useState('');const [query,setQuery]=useState('');
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),250);return()=>clearTimeout(t);},[q]);
  const {data,error,loading,reload}=useLoad(()=>adminApi<{entries:Entry[]}>(`/admin/audit?q=${encodeURIComponent(query)}`),[query]);
  return <div className="adm-page">
    <header className="adm-page-head"><div><h1>Audit log</h1><p>Every staff action, newest first. Entries can’t be edited or removed.</p></div></header>
    <div className="adm-toolbar"><label className="adm-search"><I name="search"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search actions, people or details" aria-label="Search audit log"/></label></div>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton rows={10}/>:data!.entries.length?<div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>When</th><th>Staff</th><th>Action</th><th>Detail</th></tr></thead><tbody>{data!.entries.map(e=><tr key={e.id} className={personAction(e.action)?'':'static'} onClick={()=>{if(personAction(e.action))go('users',e.target);}}><td>{date(e.created_at)} <small className="adm-muted">{new Date(e.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></td><td>{e.actor_email}</td><td><code>{e.action}</code></td><td>{e.detail||<span className="adm-muted">{e.target}</span>}</td></tr>)}</tbody></table></div>:<Empty icon="log" title="No entries"/>}
  </div>;
}
