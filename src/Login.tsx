import {returnToDrive} from "./drive-signin";
import {returnToDesktop} from './desktop-signin';
import {useEffect,useState,type ReactNode} from 'react';
import {getSupabase,bridgeSession} from './supabase';
import {Logo,Icon,GoogleLogo} from './Icons';
import {Illustration} from './Illustrations';
import type {Scene} from './vectorFilm';
import './auth.css';

/** Webmail shortcuts; the provider matching the address is offered first. */
const inboxes:[string,string,RegExp][]=[
 ['Gmail','https://mail.google.com/mail/u/0/#search/from%3A%40m4labs.xyz+in%3Aanywhere',/@(gmail|googlemail)\./i],
 ['Outlook','https://outlook.live.com/mail/0/',/@(outlook|hotmail|live|msn)\./i],
 ['Yahoo Mail','https://mail.yahoo.com/',/@(yahoo|ymail)\./i],
 ['iCloud Mail','https://www.icloud.com/mail',/@(icloud|me|mac)\.com$/i],
 ['Proton Mail','https://mail.proton.me/',/@(proton|protonmail|pm)\./i],
];

/** Shared frame for every sign-in state: ambient ink art, a card, and a soft transition between steps. */
export function AuthShell({scene,stepKey,children}:{scene:Scene;stepKey:string;children:ReactNode}){
 return <main className="auth-page au-page"><div className="au-glow" aria-hidden="true"/><section className="au-card" key={stepKey}>
  <div className="au-art"><Illustration scene={scene}/></div>
  {children}
 </section><a className="au-home" href="#/"><Logo size={18}/><span className="wordmark">clem</span></a></main>;
}

function Inbox({email,kind,onBack,onResend,busy,message}:{email:string;kind:'signup'|'reset';onBack:()=>void;onResend:()=>void;busy:boolean;message:string}){
 const ordered=[...inboxes].sort((a,b)=>Number(b[2].test(email))-Number(a[2].test(email))),[first,...rest]=ordered,known=first[2].test(email);
 return <AuthShell scene="envelope" stepKey="inbox">
  <h1>Check your inbox.</h1>
  <p>We sent a {kind==='signup'?'confirmation':'reset'} link to <strong>{email}</strong>.</p>
  <div className="au-inbox">
   {known&&<a className="primary au-inbox-main" href={first[1]} target="_blank" rel="noopener">Open {first[0]}<Icon name="arrow" size={17}/></a>}
   <div className="au-inbox-grid">{(known?rest:ordered).map(([name,url])=><a key={name} href={url} target="_blank" rel="noopener">{name}</a>)}</div>
  </div>
  <p className="au-fine">Not there? Check spam, or <button className="au-inline" disabled={busy} onClick={onResend}>{busy?'sending…':'send it again'}</button>.</p>
  {message&&<p className="au-status" role="status">{message}</p>}
  <button className="login-text" onClick={onBack}>Use a different email</button>
 </AuthShell>;
}

export function Login(_props: {onClose?:()=>void} = {}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[mode,setMode]=useState<'login'|'signup'|'forgot'|'reset'>(location.hash.includes('reset')?'reset':'login'),[factor,setFactor]=useState(''),[emailMfa,setEmailMfa]=useState(location.hash.includes('email-mfa'));
 const [sent,setSent]=useState<{email:string;kind:'signup'|'reset'}|null>(null);
 useEffect(()=>{document.title='Sign in to Clem';if(location.hash.includes('error=callback'))setError('That link could not be used. Sign in again.');},[]);
 const client=getSupabase();
 useEffect(()=>{if(location.hash.includes('/mfa'))void client?.auth.mfa.listFactors().then(r=>{if(r.data?.totp[0])setFactor(r.data.totp[0].id);});},[]);
 async function finish(){const {data,error}=await client!.auth.getSession();if(error)throw error;if(!data.session)throw Error('Check your email to confirm your account.');const factors=await client!.auth.mfa.listFactors();if(factors.error)throw factors.error;const level=await client!.auth.mfa.getAuthenticatorAssuranceLevel();if(factors.data.totp.length&&level.data?.currentLevel!=='aal2'){setFactor(factors.data.totp[0].id);return;}try{await bridgeSession(data.session.access_token);}catch(e){if(location.hash.includes('email-mfa')){setEmailMfa(true);return;}throw e;}if(!returnToDesktop(data.session)&&!returnToDrive())location.hash='/app';}
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{if(!client)throw Error('Sign-in is temporarily unavailable. Please try again shortly.');await fn();}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 if(sent)return <Inbox {...sent} busy={busy} message={message} onBack={()=>{setSent(null);setMessage('');}} onResend={()=>void run(async()=>{const r=sent.kind==='signup'?await client!.auth.resend({type:'signup',email:sent.email,options:{emailRedirectTo:location.origin+'/'}}):await client!.auth.resetPasswordForEmail(sent.email,{redirectTo:location.origin+'/?recovery=1'});if(r.error)throw r.error;setMessage('Sent. It can take a minute.');})}/>;
 const verifying=!!(factor||emailMfa);
 const title=verifying?'Verify it’s you.':mode==='signup'?'Your space to think.':mode==='forgot'?'Reset your password.':mode==='reset'?'Choose a new password.':'Welcome back.';
 const scene:Scene=verifying?'keypad':mode==='signup'?'sprout':mode==='forgot'||mode==='reset'?'key':'kite';
 return <AuthShell scene={scene} stepKey={verifying?'verify':mode}>
  <h1>{title}</h1>
  <p>{factor?'Enter the code from your authenticator app.':emailMfa?'Request a code, then enter it below.':mode==='forgot'?'We’ll email you a secure link.':mode==='signup'?'Create your account.':mode==='reset'?'Use at least 12 characters.':'Sign in to continue.'}</p>
  {(mode==='login'||mode==='signup')&&!verifying&&<><button className="google-signin au-google" disabled={busy} onClick={()=>void run(async()=>{const {error}=await client!.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});if(error)throw error;})}><GoogleLogo/>Continue with Google</button><div className="login-divider"><span>or</span></div></>}
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
   if(factor){const {error}=await client!.auth.mfa.challengeAndVerify({factorId:factor,code:String(f.get('code'))});if(error)throw error;await finish();return;}
   if(emailMfa){const r=await fetch('/api/security/email/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:f.get('code')})});if(!r.ok)throw Error((await r.json()).error);setEmailMfa(false);await finish();return;}
   if(mode==='forgot'){const email=String(f.get('email'));const {error}=await client!.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/?recovery=1'});if(error)throw error;setSent({email,kind:'reset'});return;}
   if(mode==='reset'){const {error}=await client!.auth.updateUser({password:String(f.get('password'))});if(error)throw error;await finish();return;}
   if(mode==='signup'){const email=String(f.get('email'));const {data,error}=await client!.auth.signUp({email,password:String(f.get('password')),options:{emailRedirectTo:location.origin+'/'}});if(error)throw error;if(!data.session){setSent({email,kind:'signup'});return;}}
   else {const {error}=await client!.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(error)throw error;}
   await finish();
  });}}>{verifying?<label>Verification code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required autoFocus className="au-code"/></label>:<>{mode!=='reset'&&<label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label>}{mode!=='forgot'&&<label>Password<input name="password" type="password" required minLength={mode==='login'?1:12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} placeholder={mode==='signup'||mode==='reset'?'At least 12 characters':''}/></label>}</>}
   <button className="primary au-submit" disabled={busy}>{busy?<><Logo size={16} thinking/>Please wait</>:<>{verifying?'Verify':mode==='signup'?'Create account':mode==='forgot'?'Send link':mode==='reset'?'Save password':'Sign in'}<Icon name="arrow" size={17}/></>}</button>
  </form>
  {!verifying&&<div className="au-links">{mode==='login'&&<button className="login-text" onClick={()=>{setMode('forgot');setError('');}}>Forgot password?</button>}<button className="login-text" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('');setError('')}}>{mode==='login'?'New to Clem? Create an account':'Back to sign in'}</button></div>}
  {message&&<p className="au-status" role="status">{message}</p>}{error&&<p className="inline-error au-error" role="alert">{error}</p>}
  {emailMfa&&<button className="login-text" disabled={busy} onClick={()=>void run(async()=>{const r=await fetch("/api/security/email/send",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!r.ok)throw Error((await r.json()).error);setMessage("A code has been sent.");})}>Send code</button>}
  <p className="login-terms">By continuing you agree to the <a href="https://m4labs.xyz/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="https://m4labs.xyz/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
 </AuthShell>;
}

/** Landing page for links in Clem emails: shows progress while the session is exchanged, then a clear result. */
export function AuthCallback({ready}:{ready:boolean}){
 const hash=new URLSearchParams(location.hash.replace(/^#\/?/,''));
 const linkError=hash.get('error_description')||new URLSearchParams(location.search).get('error_description');
 const [state,setState]=useState<'checking'|'done'|'failed'>(linkError?'failed':'checking');
 useEffect(()=>{document.title='Confirming — Clem';},[]);
 useEffect(()=>{if(!ready||linkError)return;let live=true;const client=getSupabase();const check=async()=>{const {data}=await client!.auth.getSession();if(live)setState(data.session?'done':'failed');};void (client?check():Promise.resolve(setState('failed'))).catch(()=>live&&setState('failed'));return()=>{live=false;};},[ready]);
 if(state==='checking')return <AuthShell scene="discover" stepKey="checking"><div className="au-check"><Logo size={40} thinking/></div><h1>Confirming…</h1><p>One moment while we check your link.</p><div className="au-progress" aria-hidden="true"><i/></div></AuthShell>;
 if(state==='failed')return <AuthShell scene="expired" stepKey="failed"><h1>This link has expired.</h1><p>{linkError&&/expired|invalid/i.test(linkError)?'Links work once and expire after a while.':'We couldn’t use that link.'} Sign in to get a new one.</p><a className="primary au-submit" href="#/login">Sign in<Icon name="arrow" size={17}/></a></AuthShell>;
 return <AuthShell scene="door" stepKey="done"><div className="au-done" aria-hidden="true"><svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div><h1>You’re in.</h1><p>Your email is confirmed. Return to the Clem app, or download it to get started.</p><div className="au-actions"><a className="primary au-submit" href="#/app">Continue<Icon name="arrow" size={17}/></a><a className="login-text" href="#/download?start">Download for Windows</a></div></AuthShell>;
}
