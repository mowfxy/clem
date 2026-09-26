import {adminApi,type CaseRow} from './api';
import {Avatar,Badge,Empty,ErrorNote,I,PageHead,Skeleton,Sparkbars,ago,useLoad} from './ui';
import type {Go} from './AdminApp';

type Overview={users:number;newThisWeek:number;activeThisWeek:number;activeToday:number;suspended:number;setup?:Record<string,number>;openCases:number;awaitingReply:number;urgentCases:number;signups:{date:string;count:number}[];recentCases:CaseRow[];recentAudit:{id:string;actor_email:string;action:string;target:string;detail:string;created_at:string}[]};

// setup_step counts completed steps of the app's four-step welcome.
const steps=['Chose a username','Added their name','Chose memory','Connected an AI'];

export function Overview({go}:{go:Go}){
  const {data,error,loading,reload}=useLoad(()=>adminApi<Overview>('/admin/overview'),[]);
  if(error)return <ErrorNote error={error} onRetry={reload}/>;
  if(loading&&!data)return <Skeleton rows={8}/>;
  const d=data!;
  const setup=d.setup||{};
  const reached=(n:number)=>Object.entries(setup).reduce((sum,[step,count])=>Number(step)>=n?sum+count:sum,0);
  const finished=reached(4);
  const share=(n:number)=>d.users?Math.round(n/d.users*100):0;
  return <div className="adm-page">
    <PageHead scene="telescope" title="Overview" line="How Mowr is doing right now.">
      <button className="adm-ghost" onClick={reload}><I name="refresh"/>Refresh</button>
    </PageHead>
    <section className="adm-stats">
      <button className="adm-stat" onClick={()=>go('users')}><span>People</span><strong>{d.users}</strong><small>+{d.newThisWeek} this week</small></button>
      <button className="adm-stat" onClick={()=>go('users')}><span>Active this week</span><strong>{d.activeThisWeek}</strong><small>{d.activeToday} today · {share(d.activeThisWeek)}% of people</small></button>
      <button className="adm-stat" onClick={()=>go('users')}><span>Finished setup</span><strong>{finished}</strong><small>{share(finished)}% connected an AI</small></button>
      <button className={`adm-stat ${d.awaitingReply?'warn':''}`} onClick={()=>go('cases')}><span>Open cases</span><strong>{d.openCases}</strong><small>{d.awaitingReply} awaiting a reply{d.urgentCases?` · ${d.urgentCases} high priority`:''}</small></button>
    </section>
    <div className="adm-grid-2">
      <section className="adm-card">
        <header><h2>New people</h2><span className="adm-muted">Last 14 days</span></header>
        <Sparkbars values={d.signups} label="New people per day for the last 14 days"/>
        <div className="adm-axis"><span>{d.signups[0]?.date.slice(5)}</span><span>Today</span></div>
      </section>
      <section className="adm-card">
        <header><h2>Getting started</h2><span className="adm-muted">{d.suspended} suspended</span></header>
        {d.users?<ul className="adm-funnel">{steps.map((label,i)=>{const n=reached(i+1);return <li key={label}><span>{label}</span><i><b style={{width:`${share(n)}%`}}/></i><strong>{n}</strong></li>;})}</ul>
        :<Empty title="No people yet">People appear after they open the desktop app.</Empty>}
        <p className="adm-card-note">Mowr is free for everyone. Each bar counts people who reached that step of the welcome.</p>
      </section>
    </div>
    <div className="adm-grid-2">
      <section className="adm-card">
        <header><h2>Needs attention</h2><button className="adm-link" onClick={()=>go('cases')}>All cases<I name="arrow" size={14}/></button></header>
        {d.recentCases.length?<ul className="adm-list">{d.recentCases.map(c=><li key={c.id}><button onClick={()=>go('cases',c.id)}><Avatar person={{id:c.owner_id,email:c.email,username:c.username}} size={30}/><span><strong>{c.subject}</strong><small>{c.email||c.username||'Unknown'} · {ago(c.updated_at)}</small></span>{c.awaiting_staff?<Badge tone="warn">Reply needed</Badge>:<Badge>{c.status}</Badge>}</button></li>)}</ul>:<Empty scene="lifebuoy" title="Inbox zero">No open support cases.</Empty>}
      </section>
      <section className="adm-card">
        <header><h2>Recent staff activity</h2><button className="adm-link" onClick={()=>go('audit')}>Audit log<I name="arrow" size={14}/></button></header>
        {d.recentAudit.length?<ul className="adm-timeline">{d.recentAudit.map(e=><li key={e.id}><span className="dot"/><div><strong>{e.action.replace(/[._]/g,' ')}</strong><small>{e.actor_email} · {ago(e.created_at)}</small>{e.detail&&<p>{e.detail}</p>}</div></li>)}</ul>:<Empty scene="hourglass" title="Quiet so far">Staff actions will appear here.</Empty>}
      </section>
    </div>
  </div>;
}
