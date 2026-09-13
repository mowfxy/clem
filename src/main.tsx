import React,{lazy,Suspense,useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {initSupabase} from './supabase';
import './style.css';
import './revamp.css';
import './marketing.css';
import './production.css';
const App=lazy(()=>import('./App'));
const Landing=lazy(()=>import('./Landing').then(m=>({default:m.Landing})));
const Marketing=lazy(()=>import('./Marketing').then(m=>({default:m.Marketing})));
const Legal=lazy(()=>import('./Legal').then(m=>({default:m.Legal})));
const Login=lazy(()=>import('./Login').then(m=>({default:m.Login})));
const authReady=initSupabase();
function Root(){
 const [route,setRoute]=useState(location.hash.slice(1)||'/'),[ready,setReady]=useState(false);
 const background=useRef('/');
 const publicPage=(path:string)=>path==='/'?<Landing/>:['/privacy','/terms','/refunds'].includes(path)?<Legal route={path}/>:<Marketing route={path}/>;
 useEffect(()=>{const change=()=>setRoute(location.hash.slice(1)||'/');window.addEventListener('hashchange',change);void authReady.finally(()=>{setReady(true);change();});return()=>window.removeEventListener('hashchange',change);},[]);
 const isPublic=route==='/'||['/privacy','/terms','/refunds','/pricing','/about'].includes(route)||route.startsWith('/features');
 if(isPublic)background.current=route;
 const loading=<main className="workspace-loading" role="status">Opening Mowr…</main>;
 return <Suspense fallback={loading}>{isPublic?publicPage(route):route.startsWith('/login')?<>{publicPage(background.current)}{ready?<Login key={route} onClose={()=>{location.hash=background.current}}/>:loading}</>:!ready?loading:<App/>}</Suspense>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
