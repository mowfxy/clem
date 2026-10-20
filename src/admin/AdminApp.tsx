import {useCallback,useEffect,useState} from 'react';
import {GoogleLogo,Icon,Logo} from '../Icons';
import {AdminError,adminApi,adminClient,demo,type Staff} from './api';
import {Avatar,I,ToastHost} from './ui';
import {useDarkOnly} from '../site/SiteHeader';
import {Overview} from './Overview';
import {Stats} from './Stats';
import {Users} from './Users';
import {Cases} from './Cases';
import {Announcements} from './Announcements';
import {Team} from './Team';
import {Audit} from './Audit';
import {Emails} from './Emails';
import './admin.css';

/** The lab's logo, set like m4labs.xyz's: a bold M4 and a ringed "labs". */
function LabLogo(){return <span className="adm-lab-logo" aria-label="M4 Labs"><b>M4</b><i>labs</i></span>;}

export type Section='overview'|'stats'|'users'|'cases'|'announcements'|'emails'|'team'|'audit';
export type Go=(section:Section,id?:string)=>void;

// The M4 Labs admin. Clem is the lab's first project, so every section here serves Clem; icons are Clem's drawn set.
const groups:{label:string;items:{id:Section;label:string;icon:string;min?:'admin'}[]}[]=[
  {label:'Workspace',items:[
    {id:'overview',label:'Overview',icon:'analysis'},
    {id:'stats',label:'Stats',icon:'diagram'},
    {id:'cases',label:'Support cases',icon:'chat'},
    {id:'users',label:'People',icon:'account'},
  ]},
  {label:'Staff',items:[
    {id:'announcements',label:'Announcements',icon:'globe'},
    {id:'emails',label:'Emails',icon:'mail',min:'admin'},
    {id:'team',label:'Team',icon:'lock'},
    {id:'audit',label:'Audit log',icon:'clock',min:'admin'},
  ]},
];
const sections=groups.flatMap(g=>g.items);
// admin.m4labs.xyz owns the whole hash; the main site serves the portal under #/admin for local work.
const prefix=location.hostname==='admin.m4labs.xyz'?'':'/admin';
function parse(){const parts=location.hash.slice(1).replace(prefix,'').split('/').filter(Boolean);const section=(sections.some(n=>n.id===parts[0])?parts[0]:'overview') as Section;return {section,id:parts[1]?decodeURIComponent(parts[1]):undefined};}

export default function AdminApp(){
  const [staff,setStaff]=useState<Staff|null>(null);
  const [phase,setPhase]=useState<'loading'|'signin'|'denied'|'ready'>('loading');
  const [denied,setDenied]=useState('');
  const [where,setWhere]=useState(parse);
  const [menu,setMenu]=useState(false);
  useDarkOnly();
  useEffect(()=>{document.title='M4 Labs admin';const change=()=>{setWhere(parse());setMenu(false);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!menu)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[menu]);
  const go=useCallback<Go>((section,id)=>{location.hash=`${prefix}/${section}${id?'/'+encodeURIComponent(id):''}`;},[]);
  const check=useCallback(async()=>{
    try{setStaff(await adminApi<Staff>('/admin/me'));setPhase('ready');}
    catch(e){if(e instanceof AdminError&&e.status===401){setPhase('signin');return;}setDenied((e as Error).message);setPhase('denied');}
  },[]);
  useEffect(()=>{void (async()=>{if(demo){await check();return;}const client=await adminClient();const {data}=await client.auth.getSession();if(location.search){const q=new URLSearchParams(location.search);if(q.has('code')||q.has('error')){history.replaceState(null,'',location.pathname+location.hash);if(location.hostname==='admin.m4labs.xyz')document.cookie='clem_admin_oauth=; domain=m4labs.xyz; path=/; max-age=0; secure; samesite=lax';}}if(!data.session){setPhase('signin');return;}const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(level.data?.nextLevel==='aal2'&&level.data.currentLevel!=='aal2'){setPhase('signin');return;}await check();})();},[check]);
  async function signOut(){if(demo)return;const client=await adminClient();await client.auth.signOut();setStaff(null);setPhase('signin');}
  if(phase==='loading')return <div className="adm-root adm-center"><Logo size={44} thinking/></div>;
  if(phase==='signin')return <ToastHost><SignIn onDone={check}/></ToastHost>;
  if(phase==='denied')return <div className="adm-root adm-center adm-auth"><div className="adm-auth-card"><p className="adm-prompt"><span>m4labs:~$</span> clem admin</p><h1>No staff access</h1><p>{denied}</p><button className="adm-primary wide" onClick={()=>void signOut()}>Use another account</button></div></div>;
  const s=staff!;
  return <ToastHost><div className={`adm-root adm-shell ${menu?'menu-open':''}`}>
    <header className="adm-topbar">
      <button className="adm-icon" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name={menu?'close':'menu'} size={20}/></button>
      <a className="adm-brand small" href={`#${prefix}/overview`}><LabLogo/><em>admin</em></a>
    </header>
    <div className="adm-scrim nav" onClick={()=>setMenu(false)} aria-hidden="true"/>
    <aside className="adm-nav" aria-label="Admin navigation">
      <a className="adm-brand" href={`#${prefix}/overview`}><LabLogo/><em>admin</em></a>
      <span className="adm-project"><Logo size={16}/><span className="wordmark">clem</span><small>project</small></span>
      <nav>{groups.map(g=>{const items=g.items.filter(n=>!n.min||s.role!=='support');return <div className="adm-nav-group" key={g.label}>
        <span className="adm-nav-label">{g.label}</span>
        {items.map(n=><a key={n.id} href={`#${prefix}/${n.id}`} className={where.section===n.id?'on':''} aria-current={where.section===n.id?'page':undefined}><Icon name={n.icon} size={19}/><span>{n.label}</span></a>)}
      </div>;})}</nav>
      <div className="adm-nav-foot">
        {!s.mfa&&<a className="adm-mfa-tip" href="https://clem.m4labs.xyz/#/app" target="_blank" rel="noreferrer"><Icon name="verify" size={17}/><span>Add an authenticator to protect staff access.</span></a>}
        <div className="adm-me"><Avatar person={{id:s.id,email:s.email}} size={32}/><div><strong title={s.email}>{s.email}</strong><small>{s.role}</small></div><button className="adm-icon" aria-label="Sign out" title="Sign out" onClick={()=>void signOut()}><I name="logout"/></button></div>
      </div>
    </aside>
    <main className="adm-main" key={where.section}>{(()=>{switch(where.section){
      case 'stats':return <Stats/>;
      case 'users':return <Users go={go} selected={where.id} staff={s}/>;
      case 'cases':return <Cases go={go} selected={where.id}/>;
      case 'announcements':return <Announcements staff={s}/>;
      case 'emails':return s.role==='support'?<Overview go={go}/>:<Emails go={go}/>;
      case 'team':return <Team staff={s}/>;
      case 'audit':return <Audit go={go}/>;
      default:return <Overview go={go}/>;
    }})()}</main>
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
    // Lets clem.m4labs.xyz forward the return here if Supabase falls back to the main site.
    if(location.hostname==='admin.m4labs.xyz')document.cookie='clem_admin_oauth=1; domain=m4labs.xyz; path=/; max-age=600; secure; samesite=lax';
    const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/',queryParams:{prompt:'select_account'}}});
    if(error){setError(error.message);setBusy(false);}
  }
  return <div className="adm-root adm-center adm-auth">
        <form className="adm-auth-card" onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
      <LabLogo/>
      <p className="adm-prompt"><span>m4labs:~$</span> {factor?'verify --totp':'login --staff'}</p>
      <h1>{factor?'Verify it’s you.':'M4 Labs admin.'}</h1>
      <p>{factor?'Enter the 6-digit code from your authenticator app.':'Staff sign-in for Clem. Use your Clem account.'}</p>
      {!factor&&<><button type="button" className="adm-google" disabled={busy} onClick={()=>void google()}><GoogleLogo/>Continue with Google</button><div className="adm-or"><span>or</span></div></>}
      {factor?<label>Code<input name="code" className="adm-code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required autoFocus/></label>:<>
        <label>Email<input name="email" type="email" autoComplete="username" required autoFocus placeholder="you@m4labs.xyz"/></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required/></label></>}
      {error&&<p className="adm-error-text" role="alert">{error}</p>}
      <button className="adm-primary wide" disabled={busy}>{busy?'Checking…':factor?'Verify':'Sign in'}<I name="arrow" size={16}/></button>
      {!factor&&<a className="adm-quiet-link" href="https://clem.m4labs.xyz/#/login">Forgot password?</a>}
    </form>
    <a className="adm-auth-home" href="https://m4labs.xyz">cd m4labs.xyz</a>
  </div>;
}
