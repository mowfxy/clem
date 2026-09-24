import {useState} from 'react';
import {adminApi,type Staff} from './api';
import {Avatar,Badge,ErrorNote,I,Skeleton,useLoad,useToast} from './ui';

const describe={owner:'Everything, including the team.',admin:'People, access, moderation and announcements.',support:'Read people and answer support cases.'};
const tone=(role:string)=>role==='owner'?'accent':role==='admin'?'ok':'neutral';

export function Team({staff}:{staff:Staff}){
  const toast=useToast();
  const {data,error,loading,reload}=useLoad(()=>adminApi<{team:{id:string;email:string;role:'owner'|'admin'|'support'}[]}>('/admin/team'),[]);
  const [busy,setBusy]=useState(false);
  const owner=staff.role==='owner';
  async function run(path:string,body:unknown,done:string){setBusy(true);try{await adminApi(path,body);toast(done);await reload();return true;}catch(e){toast((e as Error).message,'error');return false;}finally{setBusy(false);}}
  return <div className="adm-page">
    <header className="adm-page-head"><div><h1>Team</h1><p>Who can use this portal, and what they can do.</p></div></header>
    <div className="adm-roles">{Object.entries(describe).map(([role,text])=><div key={role}><Badge tone={tone(role)}>{role}</Badge><p>{text}</p></div>)}</div>
    {owner&&<form className="adm-card adm-form inline" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);void run('/admin/team',{email:String(f.get('email')),role:String(f.get('role'))},'Team member added').then(ok=>{if(ok)form.reset();});}}>
      <label>Email<input name="email" type="email" required placeholder="teammate@example.com"/></label>
      <label>Role<select name="role"><option value="support">Support</option><option value="admin">Admin</option></select></label>
      <button className="adm-primary" disabled={busy}>Add to team</button>
      <p className="adm-muted">They need to have signed in to the Mowr app once. Owners are set in the account service code.</p>
    </form>}
    {error?<ErrorNote error={error} onRetry={reload}/>:loading&&!data?<Skeleton/>:<section className="adm-card"><ul className="adm-list plain">{data!.team.map(m=><li key={m.id}><div className="adm-row"><div className="adm-person"><Avatar person={m}/><span><strong>{m.email}{m.id===staff.id&&' (you)'}</strong><small>{describe[m.role]}</small></span></div><div className="adm-row-actions"><Badge tone={tone(m.role)}>{m.role}</Badge>{owner&&m.role!=='owner'&&<button disabled={busy} onClick={()=>{if(confirm(`Remove ${m.email} from the team?`))void run(`/admin/team/${m.id}/remove`,{},'Removed from team');}}><I name="close" size={14}/>Remove</button>}</div></div></li>)}</ul></section>}
  </div>;
}
