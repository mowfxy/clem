import {useEffect,useRef,useState} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Icon,Logo} from '../Icons';
import {SecuritySettings} from '../AccountSettings';
import {Reveal} from './Reveal';

type Release={url:string;version:string;signed:boolean;sha256?:string;size?:number;released?:string;notes?:string};

const troubles=[
  ['Windows says “Windows protected your PC”','Preview installers aren’t code-signed yet. Select More info, then Run anyway. If you want to be sure the file is ours, compare its SHA-256 checksum with the one on this page (PowerShell: Get-FileHash .\\Mowr-Setup-*.exe).'],
  ['My antivirus quarantined the installer','Some antivirus tools flag unsigned apps. Restore the file from quarantine or allow it, then run it again. Nothing is installed outside your user profile.'],
  ['Sign-in opened my browser but nothing happened','Finish signing in on mowrai.com, then return to Mowr — it checks again when the window regains focus. If it still waits, choose “Open browser again”.'],
  ['Connecting my AI asks for a code','That’s expected. Open the link Mowr shows, sign in and enter the one-time code.'],
  ['Where are my files?','Everything lives in Documents\\Mowr. Uninstalling keeps it unless you explicitly choose to remove your data.'],
];

export function Download({account=false,returning=false}:{account?:boolean;returning?:boolean}){
  const [release,setRelease]=useState<Release|null>(null);
  const [failed,setFailed]=useState(false);
  const [started,setStarted]=useState(false);
  const autostart=useRef(location.hash.includes('start'));
  useEffect(()=>{document.title='Download Mowr for Windows';window.scrollTo(0,0);},[]);
  useEffect(()=>{
    const abort=new AbortController();
    void fetch('/desktop-release.json',{signal:abort.signal}).then(r=>r.ok?r.json():Promise.reject()).then((value:Release)=>{
      setRelease(value);
      // Arriving from a "Download" button starts the file right away and keeps the guide on screen.
      if(autostart.current&&value.url){autostart.current=false;setStarted(true);location.href=value.url;}
    }).catch(()=>{if(!abort.signal.aborted)setFailed(true);});
    return()=>abort.abort();
  },[]);
  const size=release?.size?`${Math.round(release.size/1048576)} MB`:'';
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-download-hero">
        <div className="sx-hero-glow" aria-hidden="true"/>
        <Logo size={64} thinking={started}/>
        {returning?<><h1>Welcome back.</h1><p className="sx-lede">Return to the Mowr app to finish. Your plan is confirmed securely by our account service, usually within a minute.</p></>:<>
          <span className="sx-eyebrow">Mowr for Windows</span>
          <h1>{started?'Your download has started.':'Download Mowr'}</h1>
          <p className="sx-lede">{started?'Open the file when it finishes. The steps are below.':'Free to download. Set up in about three minutes.'}</p>
          {release?.url?<div className="sx-download-cta">
            <a className="sx-btn sx-btn-primary sx-btn-lg" href={release.url} onClick={()=>setStarted(true)}><Icon name="download" size={19}/>{started?'Download again':'Download for Windows'}</a>
            <p className="sx-download-meta">Windows 10 & 11 · 64-bit · {release.version}{size&&` · ${size}`}</p>
          </div>:failed?<p role="alert" className="sx-download-meta">We couldn’t load the latest release. <a className="sx-link" href="/download/windows">Try the direct download</a> or email support@mowrai.com.</p>:<p role="status" className="sx-download-meta">Finding the latest version…</p>}
        </>}
      </section>

      {!returning&&<>
        <section className="sx-section sx-install">
          <Reveal className="sx-head"><h2>Four steps.</h2></Reveal>
          <ol className="sx-install-steps">
            {[
              ['download','Open the installer','Double-click Mowr-Setup in Downloads.'],
              ['check','Allow the preview',release?.signed?'Confirm to continue.':'If Windows warns you, choose More info → Run anyway.'],
              ['account','Sign in','Your browser opens, then returns you to Mowr.'],
              ['connectors','Connect your AI','Settings → Models → Connect.'],
            ].map(([icon,title,body],i)=><Reveal as="li" key={title} delay={i*90}><span className="sx-install-n">{i+1}</span><Icon name={icon} size={22}/><h3>{title}</h3><p>{body}</p></Reveal>)}
          </ol>
          {!release?.signed&&<Reveal className="sx-smartscreen" delay={120}>
            <div className="sx-ss-window" aria-hidden="true"><div className="sx-ss-top">Windows protected your PC</div><p>Microsoft Defender SmartScreen prevented an unrecognised app from starting.</p><p className="sx-ss-link">More info</p><div className="sx-ss-actions"><span className="run">Run anyway</span><span>Don’t run</span></div></div>
            <div><h3>Seeing this screen?</h3><p>It’s normal for an unsigned preview. Click <strong>More info</strong>, check the app name says Mowr-Setup, then click <strong>Run anyway</strong>.</p>{release?.sha256&&<div className="sx-hash"><span>SHA-256</span><code>{release.sha256}</code><button onClick={()=>void navigator.clipboard.writeText(release.sha256!)} className="sx-btn sx-btn-ghost">Copy</button></div>}</div>
          </Reveal>}
        </section>

        <section className="sx-section sx-reqs">
          <Reveal className="sx-req-grid">
            <div><h3>You’ll need</h3><ul><li>Windows 10 or 11, 64-bit</li><li>About 1 GB of free disk space</li><li>An AI subscription: ChatGPT, Claude or SuperGrok / X Premium+</li><li>An internet connection to sign in and chat</li></ul></div>
            <div><h3>What gets installed</h3><ul><li>The Mowr app, in your user profile</li><li>The AI connector, bundled</li><li>Your workspace in Documents\Mowr</li><li>No background services or drivers</li></ul></div>
            <div><h3>Release</h3><ul><li>Version {release?.version||'—'}</li>{release?.released&&<li>Published {new Date(release.released).toLocaleDateString(undefined,{dateStyle:'long'})}</li>}<li>{release?.signed?'Signed installer':'Unsigned preview'}</li>{release?.notes&&<li><a className="sx-link" href={release.notes}>Release notes<Icon name="arrow" size={14}/></a></li>}</ul></div>
          </Reveal>
        </section>

        <section className="sx-section sx-faq">
          <Reveal className="sx-head"><h2>Troubleshooting</h2></Reveal>
          <div className="sx-faq-list">{troubles.map(([q,a])=><details key={q}><summary>{q}<Icon name="plus" size={18}/></summary><p>{a}</p></details>)}</div>
          <p className="sx-download-help">Still stuck? Email <a className="sx-link" href="mailto:support@mowrai.com">support@mowrai.com</a> — or, once you’re in, use Settings → Help & support.</p>
        </section>
      </>}
      {account&&<section className="sx-section sx-account"><SecuritySettings/></section>}
    </main>
    <SiteFooter/>
  </div>;
}
