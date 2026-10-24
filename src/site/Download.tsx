import {useEffect,useRef,useState} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {Thinking} from './Landing';
import {Site} from './SiteHeader';
import {SecuritySettings} from '../AccountSettings';
import {getSupabase} from '../supabase';
import {REPO} from './sections';

type Release={url:string;version:string;signed:boolean;sha256?:string;size?:number;released?:string;notes?:string};

/** Where old "Setup" links, web sign-ins and the desktop return land: one button to get Clem, and the account on the web. */
export function Download({account=false,returning=false}:{account?:boolean;returning?:boolean}){
  const [release,setRelease]=useState<Release|null>(null);
  const [failed,setFailed]=useState(false);
  const [started,setStarted]=useState(false);
  // Account settings appear only for someone signed in on the web; a visitor sees the download alone.
  const [signedIn,setSignedIn]=useState(false);
  useEffect(()=>{
    if(!account){setSignedIn(false);return;}
    const client=getSupabase();
    if(!client)return;
    let live=true;
    void client.auth.getSession().then(({data})=>{if(live)setSignedIn(!!data.session);}).catch(()=>{});
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{if(live)setSignedIn(!!session);});
    return()=>{live=false;subscription.unsubscribe();};
  },[account]);
  const link=release?.url;
  const wantsStart=()=>/[?&]start\b/.test(location.hash);
  const autostart=useRef(wantsStart()),releaseRef=useRef<Release|null>(null);
  // Older links end in "?start": they start the download right away.
  const begin=(url:string)=>{autostart.current=false;setStarted(true);history.replaceState(history.state,'',location.pathname+location.search+location.hash.replace(/[?&]start\b.*$/,''));location.href=url;};
  useEffect(()=>{document.title='Get Clem for Windows';window.scrollTo(0,0);},[]);
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
  return <Site>
    <article className="cl-page"><div className="cl-wrap">
      <header className="cl-page-head">
        <div>{returning?<><h1>Welcome back.</h1><p className="cl-lede">Return to the Clem app to finish. Your plan is confirmed securely by our account service, usually within a minute.</p></>:<>
          <h1>{started?<>Your download<br/>has started.</>:<>Get Clem<br/>for Windows.</>}</h1>
          <p className="cl-lede">Free and open source, for Windows 10 and 11.</p>
          {link?<div className="cl-actions"><a className="cl-btn" href={link} onClick={()=>setStarted(true)}><Icon name="download" size={18}/>{started?'Download again':'Download for Windows'}</a><a className="cl-link" href={REPO}><Icon name="github" size={18}/>Source on GitHub</a></div>
          :failed?<p role="alert" className="cl-lede">We couldn’t load the latest release. <a href="/download/windows">Try the direct link</a> or email <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a>.</p>
          :<p className="cl-actions"><Thinking label="Finding the latest version"/></p>}
        </>}</div>
        <Illustration scene={returning?'door':started?'plane':'box'} className="cl-plate cl-page-plate"/>
      </header>
      {!returning&&link?<div className="cl-page-body"><ul className="cl-rows">
        <li><b>Version</b><span>{release!.version}</span></li>
        <li><b>System</b><span>Windows 10 and 11, 64-bit</span></li>
        {release!.size?<li><b>Size</b><span>{Math.round(release!.size/1048576)} MB</span></li>:null}
        {release!.sha256?<li><b>SHA-256</b><span className="cl-hash">{release!.sha256}</span></li>:null}
      </ul></div>:null}
      {account&&signedIn&&<div className="cl-account"><SecuritySettings/></div>}
    </div></article>
  </Site>;
}
