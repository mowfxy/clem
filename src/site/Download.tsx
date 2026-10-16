import {useEffect,useRef,useState} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Icon,Logo} from '../Icons';
import {SecuritySettings} from '../AccountSettings';
import {REPO} from './sections';

type Release={url:string;version:string;signed:boolean;sha256?:string;size?:number;released?:string;notes?:string};

/** Where old "Setup" links, web sign-ins and the desktop return land: one button to get Mowr, and the account on the web. */
export function Download({account=false,returning=false}:{account?:boolean;returning?:boolean}){
  const [release,setRelease]=useState<Release|null>(null);
  const [failed,setFailed]=useState(false);
  const [started,setStarted]=useState(false);
  const link=release?.url;
  const wantsStart=()=>/[?&]start\b/.test(location.hash);
  const autostart=useRef(wantsStart()),releaseRef=useRef<Release|null>(null);
  // Older links end in "?start": they start the download right away.
  const begin=(url:string)=>{autostart.current=false;setStarted(true);history.replaceState(history.state,'',location.pathname+location.search+location.hash.replace(/[?&]start\b.*$/,''));location.href=url;};
  useEffect(()=>{document.title='Get Mowr for Windows';window.scrollTo(0,0);},[]);
  useEffect(()=>{
    const abort=new AbortController();
    void fetch('/desktop-release.json',{signal:abort.signal}).then(r=>r.ok?r.json():Promise.reject()).then((value:Release)=>{
      releaseRef.current=value;
      setRelease(value);
      if(autostart.current&&value.url)begin(value.url);
    }).catch(()=>{if(!abort.signal.aborted)setFailed(true);});
    const onHash=()=>{if(!wantsStart())return;const url=releaseRef.current?.url;if(url)begin(url);else autostart.current=true;};
    addEventListener('hashchange',onHash);
    return()=>{abort.abort();removeEventListener('hashchange',onHash);};
  },[]);
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-download-hero">
        <div className="sx-hero-glow" aria-hidden="true"/>
        <Logo size={64} thinking={started}/>
        {returning?<><h1>Welcome back.</h1><p className="sx-lede">Return to the Mowr app to finish. Your plan is confirmed securely by our account service, usually within a minute.</p></>:<>
          <span className="sx-eyebrow">Mowr for Windows</span>
          <h1>{started?'Your download has started.':'Get Mowr'}</h1>
          <p className="sx-lede">Free and open source, for Windows 10 and 11.</p>
          {link?<div className="sx-download-cta">
            <a className="sx-btn sx-btn-primary sx-btn-lg" href={link} onClick={()=>setStarted(true)}><Icon name="download" size={19}/>{started?'Download again':'Download for Windows'}</a>
            <p className="sx-download-meta">Windows 10 & 11 · 64-bit · {release!.version} · <a className="sx-link" href={REPO}>Source on GitHub</a></p>
          </div>:failed?<p role="alert" className="sx-download-meta">We couldn’t load the latest release. <a className="sx-link" href="/download/windows">Try the direct link</a> or email support@mowrai.com.</p>:<p role="status" className="sx-download-meta">Finding the latest version…</p>}
        </>}
      </section>
      {account&&<section className="sx-section sx-account"><SecuritySettings/></section>}
    </main>
    <SiteFooter/>
  </div>;
}
