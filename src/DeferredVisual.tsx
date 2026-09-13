import {lazy,Suspense,useEffect,useRef,useState} from 'react';
const Visual=lazy(()=>import('./Visual'));
export function DeferredVisual(){const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}},{rootMargin:'180px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);return <div ref={ref} style={{minHeight:430}}>{visible&&<Suspense fallback={<div className="scene"/>}><Visual compact/></Suspense>}</div>;}
