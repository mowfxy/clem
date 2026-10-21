import {useState} from 'react';
import {adminApi,type Staff} from './api';
import {Badge,Empty,ErrorNote,I,Skeleton,ago,date,useLoad,useToast,PageHead,Select,Modal} from './ui';

type Announcement={id:string;title:string;body:string;tone:'info'|'success'|'warning';link:string|null;starts_at:string;ends_at:string|null;archived:number;created_at:string};
const blank={title:'',body:'',tone:'info',link:'',days:'7'};

export function Announcements({staff}:{staff:Staff}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<{announcements:Announcement[]}>('/admin/announcements'),[]);
  const [draft,setDraft]=useState(blank);
  const [busy,setBusy]=useState(false);
  const [composing,setComposing]=useState(false);
  const canEdit=staff.role!=='support';
  const live=(a:Announcement)=>!a.archived&&(!a.ends_at||Date.parse(a.ends_at)>Date.now());
  async function publish(){setBusy(true);try{await adminApi('/admin/announcements',{title:draft.title,body:draft.body,tone:draft.tone,link:draft.link||undefined,days:draft.days==='none'?null:Number(draft.days)});toast('Published to the app');setDraft(blank);setComposing(false);await reload();}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}}
  async function archive(id:string){try{await adminApi(`/admin/announcements/${id}/archive`,{});toast('Announcement taken down');await reload();}catch(e){toast((e as Error).message,'error');}}
  return <div className="adm-page">
    <PageHead product="clem" scene="envelope" title="Announcements" line="Short notes shown in everyone’s Clem app, such as maintenance or a new release.">{canEdit&&<button className="adm-primary" onClick={()=>setComposing(true)}><I name="megaphone" size={15}/>New announcement</button>}</PageHead>
    {composing&&<Modal wide title="New announcement" line="Shown in everyone’s Clem app, just above the account button." onClose={()=>setComposing(false)}>
      <form className="adm-form adm-compose" onSubmit={e=>{e.preventDefault();void publish();}}>
        <div className="adm-compose-fields">
          <label>Title<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} required maxLength={80} placeholder="Clem 0.3 is here" autoFocus/></label>
          <label>Message<textarea value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} required maxLength={400} rows={4} placeholder="One or two sentences."/></label>
          <div className="adm-form-row"><label>Style<Select value={draft.tone} onChange={v=>setDraft({...draft,tone:v})} options={[{value:'info',label:'Information'},{value:'success',label:'Good news'},{value:'warning',label:'Heads up'}]}/></label>
          <label>Show for<Select value={draft.days} onChange={v=>setDraft({...draft,days:v})} options={[{value:'1',label:'1 day'},{value:'3',label:'3 days'},{value:'7',label:'1 week'},{value:'30',label:'1 month'},{value:'none',label:'Until taken down'}]}/></label></div>
          <label>Link (optional, clem.m4labs.xyz only)<input value={draft.link} onChange={e=>setDraft({...draft,link:e.target.value})} type="url" placeholder="https://clem.m4labs.xyz/#/changelog"/></label>
        </div>
        <aside className="adm-compose-preview"><h3>Preview</h3>
          <div className={`adm-announce-preview tone-${draft.tone}`}><span className="spark"/><div><strong>{draft.title||'Your title'}</strong><p>{draft.body||'Your message appears here, just above the account button.'}</p>{draft.link&&<span className="more">Learn more →</span>}</div></div>
        </aside>
        <footer><span className="adm-muted">{draft.body.length}/400</span><div><button type="button" onClick={()=>setComposing(false)}>Cancel</button><button className="adm-primary" disabled={busy}><I name="megaphone" size={15}/>Publish</button></div></footer>
      </form>
    </Modal>}
    <section className="adm-card"><header><h2>History</h2></header>
      {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:data!.announcements.length?<ul className="adm-list plain">{data!.announcements.map(a=><li key={a.id}><div className="adm-row"><div><strong>{a.title} {live(a)?<Badge tone="ok">Live</Badge>:<Badge tone="quiet">Ended</Badge>}</strong><small>{a.body}</small><small>Published {ago(a.created_at)} · {a.ends_at?`ends ${date(a.ends_at)}`:'no end date'}</small></div>{canEdit&&live(a)&&<button onClick={()=>void archive(a.id)}>Take down</button>}</div></li>)}</ul>:<Empty scene="envelope" title="No announcements yet">Publish one and it shows in everyone’s app.</Empty>}
    </section>
  </div>;
}
