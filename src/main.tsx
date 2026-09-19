import React,{lazy,Suspense,useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {desktop} from './desktop/bridge';
import './style.css';
import './revamp.css';
import './marketing.css';
import './production.css';
const Download=lazy(()=>import('./Download').then(module=>({default:module.Download})));
const DesktopRoot=lazy(()=>import('./desktop/DesktopRoot'));
const Landing=lazy(()=>import('./Landing').then(m=>({default:m.Landing})));
const Marketing=lazy(()=>import('./Marketing').then(m=>({default:m.Marketing})));
const Legal=lazy(()=>import('./Legal').then(m=>({default:m.Legal})));
const Login=lazy(()=>import('./Login').then(m=>({default:m.Login})));
let authReady:Promise<unknown>|undefined;
function Root(){
 const [route,setRoute]=useState(location.hash.slice(1)||'/'),[ready,setReady]=useState(false);
 const background=useRef('/');
 const publicPage=(path:string)=>path==='/'?<Landing/>:['/privacy','/terms','/refunds'].includes(path)?<Legal route={path}/>:<Marketing route={path}/>;
 useEffect(()=>{const change=()=>setRoute(location.hash.slice(1)||'/');window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 useEffect(()=>{if(route.startsWith('/login')||route.startsWith('/desktop-signin')||route.startsWith('/app')||location.search.includes('code=')||location.search.includes('recovery=')){authReady??=import('./supabase').then(module=>module.initSupabase());void authReady.finally(()=>setReady(true));}},[route]);
 const isPublic=route==='/'||['/privacy','/terms','/refunds','/pricing','/about'].includes(route)||route.startsWith('/features');
 if(isPublic)background.current=route;
 const loading=<main className="workspace-loading" role="status">Opening Mowr…</main>;
 return <Suspense fallback={loading}>{isPublic?publicPage(route):(route.startsWith('/login')||route.startsWith('/desktop-signin'))?<>{publicPage(background.current)}{ready?<Login key={route} onClose={()=>{location.hash=background.current}}/>:loading}</>:<Download account={route.startsWith('/app')&&ready} returning={route==='/desktop-return'}/>}</Suspense>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{desktop?<Suspense fallback={<main className="workspace-loading">Opening Mowr…</main>}><DesktopRoot/></Suspense>:<Root/>}</React.StrictMode>);
