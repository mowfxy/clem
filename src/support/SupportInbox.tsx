import {splitLogs} from '../../core/support-logs';
import {useEffect,useState} from 'react';
import {desktop} from '../desktop/bridge';
import {ContactOptions} from './ContactDialog';
import {SettingsCard, SettingRow} from '../settings/SettingsParts';
import {Icon} from '../Icons';
import type {SupportCase} from '../notices/useWorkspaceSignals';
import './support.css';

const statusLabel:Record<SupportCase['status'],string>={open:'Open',pending:'Replied',resolved:'Resolved',closed:'Closed'};
const when=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/** Help & support: three ways to reach the team, your requests and their replies, and where else to find us. */
export function SupportInbox({cases,onChanged}:{cases:SupportCase[];onChanged:()=>Promise<void>|void}){
  const [open,setOpen]=useState<string|null>(null);
  const active=cases.find(c=>c.id===open);
  useEffect(()=>{if(active?.unread)void desktop?.invoke({action:'supportSeen',id:active.id}).then(()=>onChanged()).catch(()=>{});},[active?.id,active?.unread]);
  if(active)return <SupportThread item={active} onBack={()=>setOpen(null)} onChanged={onChanged}/>;
  return <div className="help">
    <ContactOptions onSent={desktop?onChanged:undefined}/>
    {cases.length>0&&<SettingsCard title="Your requests"><ul className="support-list">{cases.map((c,i)=><li key={c.id} style={{animationDelay:i*40+'ms'}}><button onClick={()=>setOpen(c.id)}>
      <span className={`support-status status-${c.status}`}>{statusLabel[c.status]}</span>
      <span className="support-subject">{c.unread&&<span className="support-unread" aria-label="New reply"><Icon name="new-reply" size={13}/></span>}{c.subject}</span>
      <small>{c.category} · {when(c.updated_at||c.created_at)} · {c.messages.length} {c.messages.length===1?'reply':'replies'}</small>
    </button></li>)}</ul></SettingsCard>}
    <SettingsCard title="Elsewhere">
     <SettingRow title="Email" description="support@m4labs.xyz"><a className="secondary" href="mailto:support@m4labs.xyz">Write <Icon name="arrow" size={15}/></a></SettingRow>
     <SettingRow title="Source code" description="Free and open source"><a className="secondary" href="https://github.com/mowfxy/clem" target="_blank" rel="noreferrer">GitHub <Icon name="external" size={15}/></a></SettingRow>
    </SettingsCard>
  </div>;
}

function SupportThread({item,onBack,onChanged}:{item:SupportCase;onBack:()=>void;onChanged:()=>Promise<void>|void}){
  const [body,setBody]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function send(){setBusy(true);setError('');try{await desktop!.invoke({action:'supportReply',id:item.id,body});setBody('');await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="support-inbox">
    <button className="support-back" onClick={onBack}><Icon name="arrow" size={15}/>Your requests</button>
    <header className="support-thread-head"><span className={`support-status status-${item.status}`}>{statusLabel[item.status]}</span><h2>{item.subject}</h2><p className="muted">{item.category} · opened {when(item.created_at)}</p></header>
    <div className="support-thread">
      <article className="support-msg mine"><p>{splitLogs(item.message).text}</p><small>You · {when(item.created_at)}</small></article>
      {item.messages.map(m=><article key={m.id} className={`support-msg ${m.author==='user'?'mine':'team'}`}>{m.author==='staff'&&<span className="support-team-mark">M</span>}<div><p>{m.body}</p><small>{m.author==='user'?'You':'Clem support'} · {when(m.created_at)}</small></div></article>)}
    </div>
    {item.status==='closed'?<p className="fine">This request is closed. Start a new request if you still need help.</p>:<form className="support-reply" onSubmit={e=>{e.preventDefault();if(body.trim().length>1)void send();}}>
      <textarea value={body} onChange={e=>setBody(e.target.value)} rows={3} maxLength={10000} placeholder="Write a reply…" aria-label="Reply" onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&body.trim().length>1)void send();}}/>
      {error&&<p className="inline-error" role="alert">{error}</p>}
      <div><small className="fine">Please leave out passwords and keys.</small><button className="primary" disabled={busy||body.trim().length<2}>{busy?'Sending…':'Send reply'}<Icon name="arrow" size={15}/></button></div>
    </form>}
  </div>;
}
