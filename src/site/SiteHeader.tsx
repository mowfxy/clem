import {useEffect,useLayoutEffect,useState,type ReactNode} from 'react';
import {Icon,Logo} from '../Icons';
import {applyTheme} from '../theme/theme';
import {Illustration} from '../Illustrations';
import type {Scene} from '../vectorFilm';
import {paintTheme,useClock} from './clock';
import {Written} from './motion';
import {REPO} from './sections';
import './site.css';

// The site's frame, in Clem's own voice: the app's paper and ink, kept by the visitor's clock, its wordmark and drawn
// icons, and one quiet credit to the lab that makes it.
export const LAB='https://m4labs.xyz';
const links:[string,string][]=[['#/features','Features'],['#/#story','How it works'],['#/support','Support'],['#/about','About']];

/** "clem" set as the identity's wordmark, beside the mark. */
export function Brand({size=24}:{size?:number}){return <span className="cl-brand"><Logo size={size} still/><span className="wordmark">clem</span></span>;}

/** Day and night drawn in the ink line: a sun whose rays turn into the moon's crescent. */
function SkyToggle({theme,flip}:{theme:'light'|'dark';flip:()=>void}){
  const night=theme==='dark';
  return <button type="button" className="cl-sky" onClick={flip} aria-label={night?'Switch to paper (day)':'Switch to ink (night)'} title={night?'Paper':'Ink'}>
    <svg viewBox="0 0 24 24" aria-hidden="true" className={night?'is-night':''}>
      <mask id="cl-moon-bite"><rect width="24" height="24" fill="#fff"/><circle className="bite" cx="17" cy="7" r="5.6" fill="#000"/></mask>
      <circle cx="12" cy="12" r="5.2" mask="url(#cl-moon-bite)" className="disc"/>
      <g className="rays">{[0,45,90,135,180,225,270,315].map(a=><line key={a} x1="12" y1="2.6" x2="12" y2="4.4" transform={`rotate(${a} 12 12)`}/>)}</g>
    </svg>
  </button>;
}

export function SiteHeader(){
  const here=location.hash.slice(1)||'/',{theme,flip}=useClock();
  const [scrolled,setScrolled]=useState(false),[open,setOpen]=useState(false);
  useEffect(()=>{const on=()=>setScrolled(scrollY>8);on();addEventListener('scroll',on,{passive:true});return()=>removeEventListener('scroll',on);},[]);
  useEffect(()=>{if(!open)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};addEventListener('keydown',esc);return()=>removeEventListener('keydown',esc);},[open]);
  const go=(href:string)=>(e:React.MouseEvent)=>{setOpen(false);if(href.includes('#/#')){e.preventDefault();jump(href.split('#/#')[1]);}};
  return <header className={`cl-bar${scrolled?' is-scrolled':''}${open?' is-open':''}`}><div className="cl-wrap">
    <a href="#/" className="cl-home" aria-label="Clem home"><Brand/></a>
    <nav id="cl-nav" aria-label="Site">
      {links.map(([href,label])=><a key={href} href={href} onClick={go(href)} aria-current={here===href.slice(1)||here.startsWith(href.slice(1)+'/')?'page':undefined}>{label}</a>)}
      <a href={REPO} className="cl-ext">GitHub</a>
    </nav>
    <SkyToggle theme={theme} flip={flip}/>
    <a className="cl-btn cl-btn-sm" href="/download/windows"><Icon name="download" size={18}/>Download</a>
    <button type="button" className="cl-menu" aria-expanded={open} aria-controls="cl-nav" aria-label={open?'Close menu':'Menu'} onClick={()=>setOpen(o=>!o)}><i/><i/></button>
  </div></header>;
}

/** Scrolls to a landing section, loading the landing page first when needed. */
export function jump(id:string){
  const go=()=>{const el=document.getElementById(id);if(!el)return;scrollTo({top:el.getBoundingClientRect().top+scrollY-64,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
  if(location.hash==='#/'||location.hash===''){go();return;}
  location.hash='/';setTimeout(go,400);
}

export function SiteFooter(){
  const year=new Date().getFullYear();
  return <footer className="cl-foot"><div className="cl-wrap">
    <div className="cl-foot-top">
      <a href="#/" className="cl-foot-brand" aria-label="Clem home"><Brand size={40}/></a>
      <div className="cl-foot-cols">
        <div><h2>Clem</h2><ul><li><a href="#/features">Features</a></li><li><a href="#/#story" onClick={e=>{e.preventDefault();jump('story');}}>How it works</a></li><li><a href="/download/windows">Download for Windows</a></li><li><a href="#/support">Support</a></li></ul></div>
        <div><h2>Open source</h2><ul><li><a href={REPO}>Source on GitHub</a></li><li><a href={REPO+'/blob/main/LICENSE'}>MIT License</a></li><li><a href={REPO+'/issues/new/choose'}>Report a bug</a></li></ul></div>
        <div><h2>Legal</h2><ul><li><a href={LAB+'/privacy'}>Privacy</a></li><li><a href={LAB+'/terms'}>Terms</a></li><li><a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a></li></ul></div>
      </div>
    </div>
    <p className="cl-foot-line"><span>© {year} M4 Labs. Clem is free and open source.</span><a href={LAB} className="cl-credit">Made by M4 Labs</a></p>
  </div></footer>;
}

/** Holds the page in the dark theme while it is shown (the lab admin uses it). */
export function useDarkOnly(){useLayoutEffect(()=>{const root=document.documentElement,was=root.dataset.theme;root.dataset.theme='dark';return()=>{if(was)root.dataset.theme=was;};},[]);}

/** The whole site frame. The site keeps the visitor's hour; leaving it for the app hands the theme back to the app. */
export function Site({children}:{children:ReactNode}){
  useLayoutEffect(()=>{paintTheme();document.documentElement.classList.add('cl-live');return()=>{document.documentElement.classList.remove('cl-live');applyTheme();};},[]);
  return <div className="cl-site"><a className="cl-skip" href="#cl-main" onClick={e=>{e.preventDefault();document.getElementById('cl-main')?.focus();}}>Skip to content</a><SiteHeader/><main id="cl-main" tabIndex={-1}>{children}</main><SiteFooter/></div>;
}

/** A page of its own: a drawing, its title written in, its content and the way on. */
export function Page({title,lede,scene,children,next}:{title:ReactNode[];lede?:ReactNode;scene?:Scene;children?:ReactNode;next?:[string,string]}){
  return <Site><article className="cl-page"><div className="cl-wrap">
    <header className="cl-page-head">
      <div><Written as="h1" lines={title}/>{lede&&<p className="cl-lede">{lede}</p>}</div>
      {scene&&<Illustration scene={scene} className="cl-plate cl-page-plate"/>}
    </header>
    <div className="cl-page-body">{children}</div>
    <nav className="cl-pager" aria-label="More"><a href="#/"><Icon name="arrow" size={18} className="flip"/>Home</a>{next&&<a href={next[0]}>Next: {next[1]}<Icon name="arrow" size={18}/></a>}</nav>
  </div></article></Site>;
}
