import {useState} from 'react';
import {adminApi,type Staff} from './api';
import {Badge,Empty,ErrorNote,I,Skeleton,ago,date,useLoad,useToast} from './ui';

type Announcement={id:string;title:string;body:string;tone:'info'|'success'|'warning';link:string|null;starts_at:string;ends_at:string|null;archived:number;created_at:string};
const blank={title:'',body:'',tone:'info',link:'',days:'7'};

export function Announcements({staff}:{staff:Staff}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<{announcements:Announcement[]}>('/admin/announcements'),[]);
  const [draft,setDraft]=useState(blank);
  const [busy,setBusy]=useState(false);
  const canEdit=staff.role!=='support';
  const live=(a:Announcement)=>!a.archived&&(!a.ends_at||Date.parse(a.ends_at)>Date.now());
  async function publish(){setBusy(true);try{await adminApi('/admin/announcements',{title:draft.title,body:draft.body,tone:draft.tone,link:draft.link||undefined,days:draft.days==='none'?null:Number(draft.days)});toast('Published to the app');setDraft(blank);await reload();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  async function archive(id:string){try{await adminApi(`/admin/announcements/${id}/archive`,{});toast('Announcement taken down');await reload();}catch(e){toast((e as Error).message,'error');}}
  return <div className="adm-page">
    <header className="adm-page-head"><div><h1>Announcements</h1><p>Short notes shown in everyone’s Mowr app, such as maintenance or a new release.</p></div></header>
    {canEdit&&<div className="adm-grid-2 compose">
      <form className="adm-card adm-form" onSubmit={e=>{e.preventDefault();void publish();}}>
        <header><h2>New announcement</h2></header>
        <label>Title<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} required maxLength={80} placeholder="Mowr 0.3 is here"/></label>
        <label>Message<textarea value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} required maxLength={400} rows={3} placeholder="One or two sentences."/></label>
        <div className="adm-form-row"><label>Style<select value={draft.tone} onChange={e=>setDraft({...draft,tone:e.target.value})}><option value="info">Information</option><option value="success">Good news</option><option value="warning">Heads up</option></select></label>
        <label>Show for<select value={draft.days} onChange={e=>setDraft({...draft,days:e.target.value})}><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option><option value="30">1 month</option><option value="none">Until taken down</option></select></label></div>
        <label>Link (optional, mowrai.com only)<input value={draft.link} onChange={e=>setDraft({...draft,link:e.target.value})} type="url" placeholder="https://mowrai.com/#/changelog"/></label>
        <footer><span className="adm-muted">{draft.body.length}/400</span><button className="adm-primary" disabled={busy}><I name="megaphone" size={15}/>Publish</button></footer>
      </form>
      <div className="adm-card"><header><h2>Preview</h2><span className="adm-muted">As it appears in the app</span></header>
        <div className={`adm-announce-preview tone-${draft.tone}`}><span className="spark"/><div><strong>{draft.title||'Your title'}</strong><p>{draft.body||'Your message appears here, just above the account button.'}</p>{draft.link&&<span className="more">Learn more →</span>}</div></div>
      </div>
    </div>}
    <section className="adm-card"><header><h2>History</h2></header>
      {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:data!.announcements.length?<ul className="adm-list plain">{data!.announcements.map(a=><li key={a.id}><div className="adm-row"><div><strong>{a.title} {live(a)?<Badge tone="ok">Live</Badge>:<Badge tone="quiet">Ended</Badge>}</strong><small>{a.body}</small><small>Published {ago(a.created_at)} · {a.ends_at?`ends ${date(a.ends_at)}`:'no end date'}</small></div>{canEdit&&live(a)&&<button onClick={()=>void archive(a.id)}>Take down</button>}</div></li>)}</ul>:<Empty icon="megaphone" title="No announcements yet"/>}
    </section>
  </div>;
}
