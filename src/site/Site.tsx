import {useEffect,useLayoutEffect,useState,type ReactNode} from 'react';
import {Icon,Logo} from '../Icons';
import {applyTheme} from '../theme/theme';
import {Orbit} from './Orbit';
import './site.css';

export const REPO='https://github.com/mowfxy/clem';
export const LAB='https://m4labs.xyz';
const links:[string,string][]=[['#/features','Features'],['#/about','About'],['#/support','Support'],[REPO,'GitHub']];

/** The mark and the name, as the app's sidebar sets them. */
export function Brand({size=22}:{size?:number}){return <span className="o-brand" style={{fontSize:size*1.1}}><Logo size={size}/>clem</span>;}

/** The primary action, named for what it does, with Windows' own four panes beside it. */
export function DownloadButton({label='Download for Windows',small=false}:{label?:string;small?:boolean}){
  return <a className={`o-btn${small?' o-btn-s':''}`} href="/download/windows"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2.6 6.6 1.8v5.4H1zM7.4 1.7 15 .6v6.6H7.4zM1 8h5.6v5.4L1 12.6zm6.4 0H15v6.6l-7.6-1.1z"/></svg>{label}</a>;
}

function Header(){
  const here=location.hash.slice(1)||'/',[open,setOpen]=useState(false);
  useEffect(()=>{if(!open)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};addEventListener('keydown',esc);return()=>removeEventListener('keydown',esc);},[open]);
  return <header className={`o-bar${open?' is-open':''}`}>
    <a href="#/" className="o-home" aria-label="Clem home" onClick={()=>setOpen(false)}><Brand/></a>
    <nav id="o-nav" aria-label="Site">{links.map(([href,label])=><a key={href} href={href} onClick={()=>setOpen(false)} aria-current={here===href.slice(1)||here.startsWith(href.slice(1)+'/')?'page':undefined}>{label}</a>)}</nav>
    <DownloadButton small label="Download"/>
    <button type="button" className="o-menu" aria-expanded={open} aria-controls="o-nav" aria-label={open?'Close menu':'Menu'} onClick={()=>setOpen(o=>!o)}><i/><i/></button>
  </header>;
}

function Footer(){
  return <footer className="o-foot">
    <nav aria-label="More">
      <a href="#/features">Features</a><a href="#/about">About</a><a href="#/support">Support</a><a href={REPO}>GitHub</a><a href={REPO+'/blob/main/LICENSE'}>MIT License</a><a href={LAB+'/privacy'}>Privacy</a><a href={LAB+'/terms'}>Terms</a>
    </nav>
    <p>Made by <a href={LAB}>M4 Labs</a></p>
  </footer>;
}

/** Things rise into view once, as if over the horizon: a pane or sheet carries its own motion, never a parent of glass. */
function useRise(key:string){
  useEffect(()=>{
    const items=[...document.querySelectorAll<HTMLElement>('[data-rise]:not(.is-up)')];
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window)){items.forEach(el=>el.classList.add('is-up'));return;}
    const seen=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('is-up');seen.unobserve(e.target);}},{rootMargin:'0px 0px -8% 0px',threshold:.04});
    items.forEach(el=>seen.observe(el));
    return()=>seen.disconnect();
  },[key]);
}

/** The frame of every public page. The site is always in the orbit, so it holds the dark theme for the app's shared
 *  styles and hands the visitor's theme back when they leave for the app. */
export function Site({children,page}:{children:ReactNode;page:string}){
  useLayoutEffect(()=>{document.documentElement.dataset.theme='dark';document.documentElement.classList.add('o-live');return()=>{document.documentElement.classList.remove('o-live');applyTheme();};},[]);
  useRise(page);
  return <div className="o-site">
    <a className="o-skip" href="#o-main" onClick={e=>{e.preventDefault();document.getElementById('o-main')?.focus();}}>Skip to content</a>
    <Orbit/><Header/>
    <main id="o-main" tabIndex={-1}>{children}</main>
    <Footer/>
  </div>;
}

/** A real capture of the app, always the whole window and never cropped. Anything smaller is drawn in Panels.tsx. */
export function Shot({name,alt,className='',eager=false}:{name:string;alt:string;className?:string;eager?:boolean}){
  return <figure className={`o-pane ${className}`} data-rise><img src={`/site/${name}-1440.webp`} srcSet={`/site/${name}-1440.webp 1440w, /site/${name}.webp 2878w`} sizes="(max-width:760px) 100vw, 92vw" width={2878} height={1704} alt={alt} loading={eager?'eager':'lazy'} decoding="async"/></figure>;
}

/** A page of its own: one sheet of glass over the horizon, as the app's sign-in and setup are. */
export function Card({title,children,wide=false}:{title:string;children?:ReactNode;wide?:boolean}){
  return <div className="o-sheet-page"><article className={`o-card${wide?' o-card-wide':''}`}><Logo size={36}/><h1>{title}</h1>{children}</article></div>;
}
