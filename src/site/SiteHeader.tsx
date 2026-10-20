import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {Logo} from '../Icons';
import './site.css';
import {REPO} from './sections';

// The site's shell, in the manner of m4labs.xyz: a top bar of ./pages, each section opened by a typed command, and a
// plain footer. Clem is M4 Labs' first project, so the bar links back to the lab.
const links=[['#/features','features'],['#/#visuals','visuals'],['#/support','support'],['#/about','about']];
export const LAB='https://m4labs.xyz';

/** "clem" set as the identity's wordmark, beside the mark. */
export function Brand({size=22}:{size?:number}){return <span className="cx-brand"><Logo size={size} still/><span className="wordmark">clem</span></span>;}

export function SiteHeader(){
  const here=location.hash.slice(1)||'/';
  return <header className="cx-bar"><div className="cx-wrap">
    <a href="#/" aria-label="Clem home"><Brand/></a>
    <a className="cx-lab" href={LAB}>by M4 Labs</a>
    <nav aria-label="Site">{links.map(([href,label])=><a key={href} href={href} aria-current={here===href.slice(1)||here.startsWith(href.slice(1)+'/')?'page':undefined} onClick={e=>{if(href.includes('#/#')){e.preventDefault();jump(href.split('#/#')[1]);}}}>{label}</a>)}<a href={REPO}>github</a></nav>
    <a className="cx-btn cx-btn-sm" href="/download/windows">download</a>
  </div></header>;
}

/** Scrolls to a landing section, loading the landing page first when needed. */
export function jump(id:string){
  const go=()=>document.getElementById(id)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(location.hash==='#/'||location.hash===''){go();return;}
  location.hash='/';setTimeout(go,350);
}

export function SiteFooter(){
  return <footer className="cx-foot"><div className="cx-wrap">
    <span>© {new Date().getFullYear()} <a href={LAB}>M4 Labs</a> · Clem is free and open source under the <a href={REPO+'/blob/main/LICENSE'}>MIT License</a></span>
    <ul><li><a href="https://m4labs.xyz/privacy">privacy</a></li><li><a href="https://m4labs.xyz/terms">terms</a></li><li><a href="mailto:support@m4labs.xyz">contact</a></li><li><a href={REPO}>github</a></li></ul>
  </div></footer>;
}

/** A command line that types itself once when it scrolls into view. The text is in the markup from the start. */
export function Prompt({children}:{children:string}){
  const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const el=ref.current!,full=children;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window))return;
    el.style.visibility='hidden';
    let timer=0;
    const io=new IntersectionObserver(([e])=>{
      if(!e.isIntersecting)return;io.disconnect();
      let i=0;el.textContent='';el.style.visibility='';
      const step=()=>{i+=1+(Math.random()<.3?1:0);el.textContent=full.slice(0,i);if(i<full.length)timer=window.setTimeout(step,22+Math.random()*40);};
      step();
    },{threshold:.6});
    io.observe(el);
    return()=>{io.disconnect();clearTimeout(timer);el.textContent=full;el.style.visibility='';};
  },[children]);
  return <p className="cx-prompt"><span className="u">m4labs:~$</span> <span ref={ref}>{children}</span></p>;
}

/** Holds the page in the dark theme while it is shown: the site is dark only, like m4labs.xyz. */
export function useDarkOnly(){useLayoutEffect(()=>{const root=document.documentElement,was=root.dataset.theme;root.dataset.theme='dark';return()=>{if(was)root.dataset.theme=was;};},[]);}

/** The whole site frame. */
export function Site({children}:{children:ReactNode}){
  useDarkOnly();
  return <div className="cx-site"><a className="cx-skip" href="#cx-main" onClick={e=>{e.preventDefault();document.getElementById('cx-main')?.focus();}}>Skip to content</a><SiteHeader/><main id="cx-main" tabIndex={-1}>{children}</main><SiteFooter/></div>;
}

/** A page of its own: its command, its title, its content and the way home. */
export function Page({cmd,title,children,next}:{cmd:string;title:ReactNode;children?:ReactNode;next?:[string,string]}){
  return <Site><section className="cx-cmd cx-page"><div className="cx-wrap">
    <Prompt>{cmd}</Prompt>
    <h1>{title}</h1>
    {children}
    <p className="cx-pager"><a href="#/">cd ~</a>{next&&<a href={next[0]}>next: {next[1]} -&gt;</a>}</p>
  </div></section></Site>;
}
