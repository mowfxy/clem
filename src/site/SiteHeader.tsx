import {useEffect,useState} from 'react';
import {Icon,Logo} from '../Icons';
import './site.css';
import {REPO} from './sections';

const links=[['#/features','Features'],['#/#visuals','Visuals'],['#/support','Support'],['#/about','About']];

/** Shared site navigation: condenses on scroll and folds into a menu on phones. */
export function SiteHeader(){
  const [scrolled,setScrolled]=useState(false),[open,setOpen]=useState(false);
  useEffect(()=>{const on=()=>setScrolled(scrollY>12);on();addEventListener('scroll',on,{passive:true});return()=>removeEventListener('scroll',on);},[]);
  useEffect(()=>{const close=()=>setOpen(false);addEventListener('hashchange',close);return()=>removeEventListener('hashchange',close);},[]);
  return <header className={`sx-header ${scrolled?'scrolled':''} ${open?'open':''}`}>
    <a className="sx-brand" href="#/" aria-label="Mowr home"><Logo size={24}/><span>mowr</span></a>
    <nav aria-label="Site">{links.map(([href,label])=><a key={href} href={href} onClick={e=>{if(href.includes('#/#')){e.preventDefault();jump(href.split('#/#')[1]);}}}>{label}</a>)}</nav>
    <a className="sx-header-git" href={REPO} aria-label="Mowr on GitHub" title="Mowr is open source"><Icon name="github" size={18}/><span>GitHub</span></a>
    <a className="sx-btn sx-btn-primary sx-header-cta" href="/download/windows">Download</a>
    <button className="sx-menu" aria-label={open?'Close menu':'Open menu'} aria-expanded={open} onClick={()=>setOpen(!open)}><Icon name={open?'close':'menu'} size={20}/></button>
  </header>;
}

/** Scrolls to a landing section, loading the landing page first when needed. */
export function jump(id:string){
  const go=()=>document.getElementById(id)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(location.hash==='#/'||location.hash===''){go();return;}
  location.hash='/';setTimeout(go,350);
}

export function SiteFooter(){
  return <footer className="sx-footer">
    <div className="sx-footer-top">
      <a className="sx-brand" href="#/"><Logo size={24}/><span>mowr</span></a>
      <nav aria-label="Footer">
        <a href="#/features">Features</a><a href="/download/windows">Download</a><a href="#/support">Support</a><a href="#/about">About</a><a href={REPO}>GitHub</a>
        <a href="mailto:support@mowrai.com">Contact</a><a href="#/privacy">Privacy</a><a href="#/terms">Terms</a>
      </nav>
    </div>
    <div className="sx-footer-bottom"><span>© {new Date().getFullYear()} Mowr</span><span>Free and open source under the <a href={REPO+'/blob/main/LICENSE'}>MIT License</a>.</span></div>
  </footer>;
}
