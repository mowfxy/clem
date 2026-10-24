import {createElement,useEffect,useRef,useState,type ReactNode} from 'react';

// The site's motion, from the app's own physics: ink is written left to right, drawings snap pose to pose with a small
// overshoot, and nothing moves that the reader can't see. Everything is visible without JavaScript: the hidden first
// pose is only set once the script has marked the page as `is-live`.
export const still=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has come into view (and stays true). */
export function useSeen<T extends Element>(margin='0px 0px -12% 0px'){
  const ref=useRef<T>(null),[seen,setSeen]=useState(false);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    if(!('IntersectionObserver' in window)){setSeen(true);return;}
    const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setSeen(true);io.disconnect();}},{rootMargin:margin});
    io.observe(el);return()=>io.disconnect();
  },[margin]);
  return [ref,seen] as const;
}

/** A heading written line by line: each line rises out of its own baseline, the way a pen fills a page. The breaks
 *  are chosen by hand so no heading ends on one word. */
export function Written({as='h2',lines,className='',delay=0}:{as?:'h1'|'h2'|'h3'|'p';lines:ReactNode[];className?:string;delay?:number}){
  const [ref,seen]=useSeen<HTMLElement>();
  return createElement(as,{ref,className:`cl-written ${seen?'is-seen':''} ${className}`},lines.map((l,i)=><span key={i} className="cl-line"><span style={{transitionDelay:`${delay+i*90}ms`}}>{l}</span></span>));
}

/** Children that arrive one after another once the group is in view: rows of a list, plates of a set. */
export function Arrive({as='div',className='',children,step=70}:{as?:keyof HTMLElementTagNameMap;className?:string;children:ReactNode;step?:number}){
  const [ref,seen]=useSeen<HTMLElement>();
  return createElement(as,{ref,className:`cl-arrive ${seen?'is-seen':''} ${className}`,style:{'--step':`${step}ms`}},children);
}

/** A pen stroke under a word: drawn once when it comes into view, wavering like the ink films' line. */
export function Underline({children}:{children:ReactNode}){
  const [ref,seen]=useSeen<HTMLSpanElement>();
  return <span ref={ref} className={`cl-underline ${seen?'is-seen':''}`}>{children}<svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true"><path pathLength={1} d="M4 15.5C38 10.8 71 9.4 104 11.2c27 1.5 52 4.6 83 3.9 33-.8 63-5.9 96-7.4 5-.2 9 0 13 .5"/></svg></span>;
}

/** A value from 0 to 1 that runs once over `ms` after `start` turns true: chapters that play by themselves where the
 *  reader isn't scrolling them (phones and reduced motion jump straight to 1). */
export function useRun(start:boolean,ms=2600){
  const [p,setP]=useState(0);
  useEffect(()=>{
    if(!start)return;
    if(still()){setP(1);return;}
    let raf=0;const t0=performance.now();
    const f=(t:number)=>{const x=Math.min(1,(t-t0)/ms);setP(x);if(x<1)raf=requestAnimationFrame(f);};
    raf=requestAnimationFrame(f);return()=>cancelAnimationFrame(raf);
  },[start,ms]);
  return p;
}
