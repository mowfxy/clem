import {useCallback,useEffect,useState} from 'react';
import {GoogleLogo,Logo} from '../Icons';
import {AdminError,adminApi,adminClient,demo,type Staff} from './api';
import {I,ToastHost} from './ui';
import {Overview} from './Overview';
import {Users} from './Users';
import {Cases} from './Cases';
import {Subscriptions} from './Subscriptions';
import {Announcements} from './Announcements';
import {Team} from './Team';
import {Audit} from './Audit';
import './admin.css';

export type Section='overview'|'users'|'subscriptions'|'cases'|'announcements'|'team'|'audit';
export type Go=(section:Section,id?:string)=>void;

const nav:{id:Section;label:string;icon:string;min?:'admin'}[]=[
  {id:'overview',label:'Overview',icon:'overview'},
  {id:'cases',label:'Support cases',icon:'inbox'},
  {id:'users',label:'People',icon:'users'},
  {id:'subscriptions',label:'Subscriptions',icon:'card'},
  {id:'announcements',label:'Announcements',icon:'megaphone'},
  {id:'team',label:'Team',icon:'shield'},
  {id:'audit',label:'Audit log',icon:'log',min:'admin'},
];
// admin.mowrai.com owns the whole hash; the main site serves the portal under #/admin for local work.
const prefix=location.hostname==='admin.mowrai.com'?'':'/admin';
function parse(){const parts=location.hash.slice(1).replace(prefix,'').split('/').filter(Boolean);const section=(nav.some(n=>n.id===parts[0])?parts[0]:'overview') as Section;return {section,id:parts[1]?decodeURIComponent(parts[1]):undefined};}

export default function AdminApp(){
  const [staff,setStaff]=useState<Staff|null>(null);
  const [phase,setPhase]=useState<'loading'|'signin'|'denied'|'ready'>('loading');
  const [denied,setDenied]=useState('');
  const [where,setWhere]=useState(parse);
  const [menu,setMenu]=useState(false);
  useEffect(()=>{document.title='Mowr Admin';const change=()=>{setWhere(parse());setMenu(false);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  const go=useCallback<Go>((section,id)=>{location.hash=`${prefix}/${section}${id?'/'+encodeURIComponent(id):''}`;},[]);
  const check=useCallback(async()=>{
    try{setStaff(await adminApi<Staff>('/admin/me'));setPhase('ready');}
    catch(e){if(e instanceof AdminError&&e.status===401){setPhase('signin');return;}setDenied((e as Error).message);setPhase('denied');}
  },[]);
  useEffect(()=>{void (async()=>{if(demo){await check();return;}const client=await adminClient();const {data}=await client.auth.getSession();if(location.search){const q=new URLSearchParams(location.search);if(q.has('code')||q.has('error'))history.replaceState(null,'',location.pathname+location.hash);}if(!data.session){setPhase('signin');return;}const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(level.data?.nextLevel==='aal2'&&level.data.currentLevel!=='aal2'){setPhase('signin');return;}await check();})();},[check]);
  async function signOut(){if(demo)return;const client=await adminClient();await client.auth.signOut();setStaff(null);setPhase('signin');}
  if(phase==='loading')return <div className="adm-root adm-center"><Logo size={44} thinking/></div>;
  if(phase==='signin')return <ToastHost><SignIn onDone={check}/></ToastHost>;
  if(phase==='denied')return <div className="adm-root adm-center"><div className="adm-auth-card"><Logo size={40}/><h1>No staff access</h1><p>{denied}</p><button className="adm-primary" onClick={()=>void signOut()}>Use another account</button></div></div>;
  const visible=nav.filter(n=>!n.min||staff!.role!=='support');
  const page=(()=>{switch(where.section){
    case 'users':return <Users go={go} selected={where.id} staff={staff!}/>;
    case 'cases':return <Cases go={go} selected={where.id}/>;
    case 'subscriptions':return <Subscriptions go={go}/>;
    case 'announcements':return <Announcements staff={staff!}/>;
    case 'team':return <Team staff={staff!}/>;
    case 'audit':return <Audit go={go}/>;
    default:return <Overview go={go}/>;
  }})();
  return <ToastHost><div className={`adm-root adm-shell ${menu?'menu-open':''}`}>
    <aside className="adm-nav">
      <a className="adm-brand" href={`#${prefix}/overview`}><Logo size={26}/><span>mowr</span><em>admin</em></a>
      <nav>{visible.map(n=><a key={n.id} href={`#${prefix}/${n.id}`} className={where.section===n.id?'on':''} aria-current={where.section===n.id?'page':undefined}><I name={n.icon}/>{n.label}</a>)}</nav>
      <div className="adm-nav-foot">
        {!staff!.mfa&&<a className="adm-mfa-tip" href="https://mowrai.com/#/app" target="_blank" rel="noreferrer"><I name="shield" size={15}/><span>Protect staff access with an authenticator app.</span></a>}
        <div className="adm-me"><span className="adm-me-dot"/><div><strong>{staff!.email}</strong><small>{staff!.role}</small></div><button className="adm-icon" aria-label="Sign out" title="Sign out" onClick={()=>void signOut()}><I name="logout"/></button></div>
      </div>
    </aside>
    <button className="adm-menu-button" aria-label="Open navigation" onClick={()=>setMenu(!menu)}><I name={menu?'close':'log'}/></button>
    <main className="adm-main" key={where.section}>{page}</main>
  </div></ToastHost>;
}

function SignIn({onDone}:{onDone:()=>Promise<void>}){
  const [factor,setFactor]=useState('');const [error,setError]=useState(()=>new URLSearchParams(location.search).get('error_description')||'');const [busy,setBusy]=useState(false);
  useEffect(()=>{void adminClient().then(async client=>{const {data}=await client.auth.getSession();if(data.session){const f=await client.auth.mfa.listFactors();if(f.data?.totp[0])setFactor(f.data.totp[0].id);}});},[]);
  async function submit(form:FormData){
    setBusy(true);setError('');
    try{
      const client=await adminClient();
      if(factor){const {error}=await client.auth.mfa.challengeAndVerify({factorId:factor,code:String(form.get('code'))});if(error)throw error;await onDone();return;}
      const {error}=await client.auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});
      if(error)throw error;
      const factors=await client.auth.mfa.listFactors();
      const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if(factors.data?.totp.length&&level.data?.currentLevel!=='aal2'){setFactor(factors.data.totp[0].id);return;}
      await onDone();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function google(){
    setBusy(true);setError('');
    const client=await adminClient();
    const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/',queryParams:{prompt:'select_account'}}});
    if(error){setError(error.message);setBusy(false);}
  }
  return <div className="adm-root adm-center adm-signin">
    <div className="adm-signin-glow" aria-hidden="true"/>
    <form className="adm-auth-card" onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
      <Logo size={40}/>
      <h1>{factor?'Verify it’s you':'Mowr Admin'}</h1>
      <p>{factor?'Enter the 6-digit code from your authenticator app.':'Staff sign-in. Use your Mowr account.'}</p>
      {!factor&&<><button type="button" className="adm-google" disabled={busy} onClick={()=>void google()}><GoogleLogo/>Continue with Google</button><div className="adm-or"><span>or</span></div></>}
      {factor?<label>Code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required autoFocus/></label>:<>
        <label>Email<input name="email" type="email" autoComplete="username" required autoFocus/></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required/></label></>}
      {error&&<p className="adm-error-text" role="alert">{error}</p>}
      <button className="adm-primary" disabled={busy}>{busy?'Checking…':factor?'Verify':'Sign in'}<I name="arrow" size={16}/></button>
      {!factor&&<a className="adm-link" href="https://mowrai.com/#/login">Forgot password?</a>}
    </form>
  </div>;
}
