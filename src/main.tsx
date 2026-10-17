import React,{lazy,Suspense,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {desktop} from './desktop/bridge';
import './type.css';
import './style.css';
import './revamp.css';
import './marketing.css';
import './production.css';
import './popups.css';
import {applyTheme} from './theme/theme';
const ProvenanceChecker=lazy(()=>import("./ProvenanceChecker"));
const Download=lazy(()=>import('./site/Download').then(module=>({default:module.Download})));
const DesktopRoot=lazy(()=>import('./desktop/DesktopRoot'));
const Landing=lazy(()=>import('./site/Landing').then(m=>({default:m.Landing})));
const Marketing=lazy(()=>import('./site/Marketing').then(m=>({default:m.Marketing})));
const Legal=lazy(()=>import('./site/Legal').then(m=>({default:m.Legal})));
const Login=lazy(()=>import('./Login').then(m=>({default:m.Login})));
const AuthCallback=lazy(()=>import('./Login').then(m=>({default:m.AuthCallback})));
const AdminApp=lazy(()=>import('./admin/AdminApp'));
const adminHost=location.hostname==='admin.mowrai.com';
let authReady:Promise<unknown>|undefined;
// Mowr is free, so the refund policy was retired; old links land on the Terms.
if(location.hash==='#/refunds')history.replaceState(null,'',location.pathname+location.search+'#/terms');
function Root(){
 const [route,setRoute]=useState(location.hash.slice(1)||'/'),[ready,setReady]=useState(false);
 // Arrivals from an email link (or its error) see a confirmation page until they navigate elsewhere.
 const [callback,setCallback]=useState(()=>!adminHost&&((location.search.includes('code=')&&!location.search.includes('recovery='))||/^#\/?error=/.test(location.hash)));
 const publicPage=(path:string)=>path==='/'?<Landing/>:['/privacy','/terms'].includes(path)?<Legal route={path}/>:<Marketing route={path}/>;
 useEffect(()=>{const change=()=>{setRoute(location.hash.slice(1)||'/');setCallback(false);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 // admin.mowrai.com signs in with its own client; the app client must not consume its OAuth code.
 useEffect(()=>{if(adminHost)return;if(route.startsWith('/login')||route.startsWith('/desktop-signin')||route.startsWith('/drive-connect')||route.startsWith('/app')||location.search.includes('code=')||location.search.includes('recovery=')){authReady??=import('./supabase').then(module=>module.initSupabase());void authReady.finally(()=>{setReady(true);setRoute(location.hash.slice(1)||'/');});}},[route]);
 const isPublic=route==='/'||['/privacy','/terms','/pricing','/support','/about'].includes(route)||route.startsWith('/features');
 const loading=<main className="workspace-loading" role="status">Opening Mowr…</main>;
 if(callback)return <Suspense fallback={loading}><AuthCallback ready={ready||/^#\/?error=/.test(location.hash)}/></Suspense>;
 if(adminHost||route.startsWith('/admin'))return <Suspense fallback={loading}><AdminApp/></Suspense>;
 return <Suspense fallback={loading}>{location.hostname==="check.mowrai.com"||route==="/check"?<ProvenanceChecker/>:isPublic?publicPage(route):(route.startsWith('/login')||route.startsWith('/desktop-signin')||route.startsWith('/drive-connect'))?(ready?<Login key={route}/>:loading):<Download account={route.startsWith('/app')&&ready} returning={route==='/desktop-return'}/>}</Suspense>;
}
applyTheme();
if(desktop)void import('./desktop/window-tone').then(m=>m.followWindowTone());
// Supabase sends OAuth returns it doesn't recognise to mowrai.com. If admin.mowrai.com started this sign-in
// (it sets a short-lived cookie), hand the code back there: only the admin origin holds the PKCE verifier.
const adminReturn=!desktop&&!adminHost&&location.hostname.endsWith('mowrai.com')&&/(?:^|;\s*)mowr_admin_oauth=1/.test(document.cookie)&&/[?&](code|error)=/.test(location.search);
if(adminReturn){document.cookie='mowr_admin_oauth=; domain=mowrai.com; path=/; max-age=0; secure; samesite=lax';location.replace('https://admin.mowrai.com/'+location.search);}
else createRoot(document.getElementById('root')!).render(<React.StrictMode>{desktop?<Suspense fallback={<main className="workspace-loading">Opening Mowr…</main>}><DesktopRoot/></Suspense>:<Root/>}</React.StrictMode>);
