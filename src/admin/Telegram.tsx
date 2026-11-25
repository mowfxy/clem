import {useState} from 'react';
import {confirmDialog} from '../dialogs';
import {adminApi,type Staff} from './api';
import {Avatar,Badge,Empty,ErrorNote,PageHead,Skeleton,ago,useLoad,useToast,who} from './ui';

type Row={id:string;email?:string|null;username?:string|null;display_name?:string|null;requested_at:number;approved_at:number|null;paired:boolean};
const at=(ms:number)=>ago(new Date(ms).toISOString());

/** Telegram's early access: who signed up, and letting them in. */
export function Telegram({staff,go}:{staff:Staff;go:(section:'accounts',id:string)=>void}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<{people:Row[]}>('/admin/telegram'),[]);
  const [busy,setBusy]=useState(false);
  const canEdit=staff.role!=='support';
  async function act(p:Row,action:'approve'|'remove',done:string){setBusy(true);try{await adminApi(`/admin/telegram/${p.id}/${action}`,{});toast(done);await reload();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  async function remove(p:Row){if(await confirmDialog({title:`Remove ${who(p)}?`,message:p.paired?'Their Telegram is disconnected and messages still waiting are deleted. They can sign up again.':'They leave the list and can sign up again.',confirm:'Remove',danger:true}))void act(p,'remove','Removed');}
  const waiting=data?.people.filter(p=>!p.approved_at)||[],inside=data?.people.filter(p=>p.approved_at)||[];
  const row=(p:Row)=><li key={p.id}><div className="adm-row">
    <div className="adm-person"><Avatar person={p}/><span><strong><button type="button" className="adm-link" onClick={()=>go('accounts',p.id)}>{who(p)}</button></strong><small>{p.email?p.email+' · ':''}{p.approved_at?'let in '+at(p.approved_at):'signed up '+at(p.requested_at)}</small></span></div>
    <div className="adm-row-actions">{p.paired&&<Badge tone="ok">Connected</Badge>}{canEdit&&!p.approved_at&&<button className="adm-primary" disabled={busy} onClick={()=>void act(p,'approve','Let in')}>Let in</button>}{canEdit&&<button disabled={busy} onClick={()=>void remove(p)}>Remove</button>}</div>
  </div></li>;
  return <div className="adm-page">
    <PageHead product="clem" title="Telegram" line="Early access: people sign up in Clem, and can connect Telegram once let in."/>
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:<>
      <section className="adm-card"><header><h2>Waiting</h2><span className="adm-muted">{waiting.length}</span></header>{waiting.length?<ul className="adm-list plain">{waiting.map(row)}</ul>:<Empty title="Nobody is waiting">Sign-ups from Clem show here.</Empty>}</section>
      <section className="adm-card"><header><h2>Let in</h2><span className="adm-muted">{inside.length}</span></header>{inside.length?<ul className="adm-list plain">{inside.map(row)}</ul>:<Empty title="Nobody yet">Owners always have Telegram and aren’t listed unless they signed up.</Empty>}</section>
    </>}
  </div>;
}
