import {useState} from 'react';
import {adminApi} from './api';
import {Badge,Empty,ErrorNote,I,Skeleton,date,money,useLoad} from './ui';
import type {Go} from './AdminApp';

type Sub={subscription_id:string;user_id:string;status:string;valid_until:string|null;updated_at:string;email?:string;username?:string;active:boolean};
type Grant={id:string;user_id:string;reason:string;valid_until:string|null;created_at:string;revoked_at:string|null;email?:string;username?:string;active:boolean};
type Data={subscriptions:Sub[];grants:Grant[];priceCents:number;lemon:boolean;testMode:boolean};
const statusTone:Record<string,string>={active:'ok',on_trial:'ok',cancelled:'warn',past_due:'danger',unpaid:'danger',expired:'quiet',paused:'quiet'};

export function Subscriptions({go}:{go:Go}){
  const {data,error,loading,reload}=useLoad(()=>adminApi<Data>('/admin/subscriptions'),[]);
  const [tab,setTab]=useState<'paid'|'grants'>('paid');
  if(error)return <ErrorNote error={error} onRetry={reload}/>;
  if(loading&&!data)return <Skeleton rows={8}/>;
  const d=data!;
  const active=d.subscriptions.filter(s=>s.active);
  const renewing=active.filter(s=>s.status!=='cancelled');
  const risk=d.subscriptions.filter(s=>s.status==='past_due'||s.status==='unpaid');
  return <div className="adm-page">
    <header className="adm-page-head"><div><h1>Subscriptions</h1><p>The $2/month plan and complimentary access.</p></div><button className="adm-ghost" onClick={reload}><I name="refresh"/>Refresh</button></header>
    {!d.lemon&&<div className="adm-alert"><I name="card"/><div><strong>Payments are not connected yet</strong><p>Add LEMON_API_KEY, LEMON_STORE_ID, LEMON_VARIANT_ID and LEMON_WEBHOOK_SECRET to the account Worker to take payments. Complimentary access works now.</p></div></div>}
    {d.lemon&&d.testMode&&<div className="adm-alert"><I name="card"/><div><strong>Test mode</strong><p>Lemon Squeezy is in test mode; no real money is moving.</p></div></div>}
    <section className="adm-stats">
      <div className="adm-stat accent"><span>Monthly recurring</span><strong>{money(active.length*d.priceCents)}</strong><small>{active.length} active</small></div>
      <div className="adm-stat"><span>Renewing</span><strong>{renewing.length}</strong><small>{active.length-renewing.length} cancelling</small></div>
      <div className={`adm-stat ${risk.length?'warn':''}`}><span>Payment problems</span><strong>{risk.length}</strong><small>past due or unpaid</small></div>
      <div className="adm-stat"><span>Complimentary</span><strong>{d.grants.filter(g=>g.active).length}</strong><small>active grants</small></div>
    </section>
    <div className="adm-segment" role="tablist"><button role="tab" aria-selected={tab==='paid'} className={tab==='paid'?'on':''} onClick={()=>setTab('paid')}>Paid ({d.subscriptions.length})</button><button role="tab" aria-selected={tab==='grants'} className={tab==='grants'?'on':''} onClick={()=>setTab('grants')}>Complimentary ({d.grants.length})</button></div>
    {tab==='paid'?(d.subscriptions.length?<div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Person</th><th>Status</th><th>Access until</th><th>Subscription</th><th>Updated</th></tr></thead><tbody>{d.subscriptions.map(s=><tr key={s.subscription_id} onClick={()=>go('users',s.user_id)} tabIndex={0}><td><strong>{s.email||s.username||s.user_id.slice(0,8)}</strong></td><td><Badge tone={statusTone[s.status]||'neutral'}>{s.status.replace('_',' ')}</Badge></td><td>{date(s.valid_until)}</td><td className="adm-mono">#{s.subscription_id}</td><td>{date(s.updated_at)}</td></tr>)}</tbody></table></div>:<Empty icon="card" title="No paid subscriptions yet">They appear here as soon as Lemon Squeezy confirms a checkout.</Empty>)
    :(d.grants.length?<div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Person</th><th>Status</th><th>Until</th><th>Reason</th><th>Granted</th></tr></thead><tbody>{d.grants.map(g=><tr key={g.id} onClick={()=>go('users',g.user_id)} tabIndex={0}><td><strong>{g.email||g.username||g.user_id.slice(0,8)}</strong></td><td><Badge tone={g.active?'ok':'quiet'}>{g.active?'active':g.revoked_at?'revoked':'ended'}</Badge></td><td>{g.valid_until?date(g.valid_until):'No expiry'}</td><td>{g.reason||'—'}</td><td>{date(g.created_at)}</td></tr>)}</tbody></table></div>:<Empty icon="gift" title="No complimentary access">Open a person and choose “Give free access”.</Empty>)}
  </div>;
}
