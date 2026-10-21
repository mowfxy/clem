import {useCallback,useEffect,useState} from 'react';
import {GoogleLogo,Icon} from '../Icons';
import {AdminError,adminApi,adminClient,demo,type Staff} from './api';
import {Avatar,I,ToastHost} from './ui';
import {useDarkOnly} from '../site/SiteHeader';
import {products,type ProductSection} from './products';
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

type LabSection='overview'|'accounts'|'emails'|'team'|'audit';
export type Section=LabSection|ProductSection;
export type Go=(section:Section,id?:string)=>void;

// The M4 Labs admin. Accounts, email, team and audit cover the whole lab; each product (products.ts) adds its own group.
const lab:{id:LabSection;label:string;icon:string;min?:'admin'}[]=[
  {id:'overview',label:'Overview',icon:'analysis'},
  {id:'accounts',label:'Accounts',icon:'account'},
  {id:'emails',label:'Emails',icon:'mail',min:'admin'},
  {id:'team',label:'Team',icon:'lock'},
  {id:'audit',label:'Audit log',icon:'clock',min:'admin'},
];
// Product sections live at #/<product>/<section>; one product today, so a section name maps to its product.
const productOf=(section:string)=>products.find(p=>p.sections.some(s=>s.id===section));
const path=(section:Section,id?:string)=>{const product=productOf(section);return `${product?'/'+product.id:''}/${section}${id?'/'+encodeURIComponent(id):''}`;};
// admin.m4labs.xyz owns the whole hash; the main site serves the portal under #/admin for local work.
const prefix=location.hostname==='admin.m4labs.xyz'?'':'/admin';
function parse(){
  let parts=location.hash.slice(1).replace(prefix,'').split('/').filter(Boolean);
  const product=products.find(p=>p.id===parts[0]);
  if(product)parts=parts.slice(1);
  if(parts[0]==='users')parts[0]='accounts';// links from before accounts were lab-wide
  const valid=product?product.sections.some(s=>s.id===parts[0]):lab.some(n=>n.id===parts[0]);
  const section=(valid?parts[0]:'overview') as Section;
  return {section,id:parts[1]?decodeURIComponent(parts[1]):undefined};
}

/** The tab shows the lab's mark, not Clem's: admin.m4labs.xyz is redirected there by vercel.json, local work here. */
function useLabIcon(){
  useEffect(()=>{
    document.title='M4 Labs admin';
    const set=(rel:string,href:string,type?:string)=>{const links=document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`);links.forEach(l=>{l.href=href;if(type)l.type=type;l.removeAttribute('sizes');});};
    set('icon','/m4labs/favicon.svg','image/svg+xml');set('apple-touch-icon','/m4labs/apple-touch-icon.png');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#0b0b0a');
  },[]);
}

export default function AdminApp(){
  const [staff,setStaff]=useState<Staff|null>(null);
  const [phase,setPhase]=useState<'loading'|'signin'|'mfa'|'denied'|'ready'>('loading');
  const [denied,setDenied]=useState('');
  const [where,setWhere]=useState(parse);
  const [menu,setMenu]=useState(false);
  useDarkOnly();
  useLabIcon();
  useEffect(()=>{const change=()=>{setWhere(parse());setMenu(false);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!menu)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[menu]);
  const go=useCallback<Go>((section,id)=>{location.hash=prefix+path(section,id);},[]);
  const check=useCallback(async()=>{
    try{setStaff(await adminApi<Staff>('/admin/me'));setPhase('ready');}
    catch(e){if(e instanceof AdminError&&e.status===401){setPhase('signin');return;}if(e instanceof AdminError&&e.code==='MFA_REQUIRED'){setPhase('mfa');return;}setDenied((e as Error).message);setPhase('denied');}
  },[]);
  useEffect(()=>{void (async()=>{if(demo){await check();return;}const client=await adminClient();const {data}=await client.auth.getSession();if(location.search){const q=new URLSearchParams(location.search);if(q.has('code')||q.has('error')){history.replaceState(null,'',location.pathname+location.hash);if(location.hostname==='admin.m4labs.xyz')document.cookie='m4labs_admin_oauth=; domain=m4labs.xyz; path=/; max-age=0; secure; samesite=lax';}}if(!data.session){setPhase('signin');return;}const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(level.data?.nextLevel==='aal2'&&level.data.currentLevel!=='aal2'){setPhase('signin');return;}await check();})();},[check]);
  async function signOut(){if(demo)return;const client=await adminClient();await client.auth.signOut();setStaff(null);setPhase('signin');}
  if(phase==='loading')return <div className="adm-root adm-center"><span className="adm-loading-logo"><LabLogo/></span></div>;
  if(phase==='signin')return <ToastHost><SignIn onDone={check}/></ToastHost>;
  if(phase==='mfa')return <ToastHost><MfaSetup onDone={check} onSignOut={()=>void signOut()}/></ToastHost>;
  if(phase==='denied')return <div className="adm-root adm-center adm-auth"><div className="adm-auth-card"><LabLogo/><p className="adm-prompt"><span>m4labs:~$</span> admin</p><h1>No staff access</h1><p>{denied}</p><button className="adm-primary wide" onClick={()=>void signOut()}>Use another account</button></div></div>;
  const s=staff!;
  const link=(section:Section)=>`#${prefix}${path(section)}`;
  // Links read like the paths on m4labs.xyz: ./accounts, ./stats. The section id is the path.
  const item=(n:{id:Section;label:string})=><a key={n.id} href={link(n.id)} className={where.section===n.id?'on':''} aria-current={where.section===n.id?'page':undefined} title={n.label}>{n.id}</a>;
  return <ToastHost><div className={`adm-root adm-shell ${menu?'menu-open':''}`}>
    <header className="adm-bar">
      <button className="adm-icon adm-menu" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name={menu?'close':'menu'} size={20}/></button>
      <a className="adm-brand" href={link('overview')}><LabLogo/><em>admin</em></a>
      <div className="adm-scrim nav" onClick={()=>setMenu(false)} aria-hidden="true"/>
      <nav className="adm-nav" aria-label="Admin navigation">
        <div className="adm-nav-group"><span className="adm-nav-label">lab</span>{lab.filter(n=>!n.min||s.role!=='support').map(item)}</div>
        {products.map(p=><div className="adm-nav-group" key={p.id}>
          <a className="adm-nav-label adm-nav-product" href={p.url} target="_blank" rel="noreferrer" title={`Open ${p.name}`}>{p.id}/</a>
          {p.sections.map(item)}
        </div>)}
      </nav>
      <div className="adm-bar-end">
        {!s.mfa&&<button className="adm-mfa-tip" onClick={()=>setPhase('mfa')} title="Add an authenticator to protect staff access">2fa off</button>}
        <span className="adm-me" title={`${s.email} · ${s.role}`}><Avatar person={{id:s.id,email:s.email}} size={26}/><span><strong>{s.email}</strong><small>{s.role}</small></span></span>
        <button className="adm-icon" aria-label="Sign out" title="Sign out" onClick={()=>void signOut()}><I name="logout"/></button>
      </div>
    </header>
    <main className="adm-main" key={where.section}>{(()=>{switch(where.section){
      case 'stats':return <Stats/>;
      case 'accounts':return <Users go={go} selected={where.id} staff={s}/>;
      case 'cases':return <Cases go={go} selected={where.id}/>;
      case 'announcements':return <Announcements staff={s}/>;
      case 'emails':return s.role==='support'?<Overview go={go}/>:<Emails go={go}/>;
      case 'team':return <Team staff={s}/>;
      case 'audit':return <Audit go={go}/>;
      default:return <Overview go={go}/>;
    }})()}</main>
  </div></ToastHost>;
}

/** Staff access needs an authenticator. This enrols one here, on the M4 Labs account, so no product app is needed. */
function MfaSetup({onDone,onSignOut}:{onDone:()=>Promise<void>;onSignOut:()=>void}){
  const [factor,setFactor]=useState<{id:string;qr:string;secret:string}|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{void (async()=>{
    try{
      const client=await adminClient();
      // An unfinished earlier attempt blocks a new one with the same name, so clear it first.
      const listed=await client.auth.mfa.listFactors();
      for(const f of listed.data?.all||[])if(f.status!=='verified')await client.auth.mfa.unenroll({factorId:f.id});
      const {data,error}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'M4 Labs '+new Date().toISOString().slice(0,10),issuer:'m4labs.xyz'});
      if(error)throw error;
      setFactor({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret});
    }catch(e){setError((e as Error).message);}
  })();},[]);
  async function verify(form:FormData){
    if(!factor)return;setBusy(true);setError('');
    try{const client=await adminClient();const {error}=await client.auth.mfa.challengeAndVerify({factorId:factor.id,code:String(form.get('code'))});if(error)throw error;await onDone();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="adm-root adm-center adm-auth">
    <form className="adm-auth-card" onSubmit={e=>{e.preventDefault();void verify(new FormData(e.currentTarget));}}>
      <LabLogo/>
      <p className="adm-prompt"><span>m4labs:~$</span> mfa enroll --totp</p>
      <h1>Add an authenticator.</h1>
      <p>Staff access needs a second step. Scan this with an authenticator app (1Password, Google Authenticator, Authy), then enter the 6-digit code it shows. It also protects this account in every M4 Labs product.</p>
      {factor?<>
        <img className="adm-mfa-qr" src={factor.qr} alt="QR code for your authenticator app" width={176} height={176}/>
        <details className="adm-mfa-secret"><summary>Can’t scan it?</summary><p>Enter this key instead:</p><code>{factor.secret}</code></details>
        <label>Code<input name="code" className="adm-code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required autoFocus/></label>
      </>:!error&&<p className="adm-muted">Preparing…</p>}
      {error&&<p className="adm-error-text" role="alert">{error}</p>}
      <button className="adm-primary wide" disabled={busy||!factor}>{busy?'Checking…':'Verify and continue'}<I name="arrow" size={16}/></button>
      <button type="button" className="adm-quiet-link" onClick={onSignOut}>Use another account</button>
    </form>
  </div>;
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
    if(location.hostname==='admin.m4labs.xyz')document.cookie='m4labs_admin_oauth=1; domain=m4labs.xyz; path=/; max-age=600; secure; samesite=lax';
    const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/',queryParams:{prompt:'select_account'}}});
    if(error){setError(error.message);setBusy(false);}
  }
  return <div className="adm-root adm-center adm-auth">
        <form className="adm-auth-card" onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
      <LabLogo/>
      <p className="adm-prompt"><span>m4labs:~$</span> {factor?'verify --totp':'login --staff'}</p>
      <h1>{factor?'Verify it’s you.':'M4 Labs admin.'}</h1>
      <p>{factor?'Enter the 6-digit code from your authenticator app.':'Staff sign-in for M4 Labs. Use your M4 Labs account, the one you sign in to the lab’s products with.'}</p>
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
