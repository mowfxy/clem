import {useEffect,useRef,useState} from 'react';
import {Prompt,Site} from './SiteHeader';
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
    <section className="cx-cmd cx-page"><div className="cx-wrap">
      {returning?<><Prompt>clem --return</Prompt><h1>Welcome back.</h1><p className="cx-status">Return to the Clem app to finish. Your plan is confirmed securely by our account service, usually within a minute.</p></>:<>
        <Prompt>clem --download windows</Prompt>
        <h1>{started?'Your download has started.':'Get Clem for Windows.'}<span className="cx-caret" aria-hidden="true"/></h1>
        <p className="cx-status">Free and open source, for Windows 10 and 11.</p>
        {link?<>
          <div className="cx-actions"><a className="cx-btn" href={link} onClick={()=>setStarted(true)}>{started?'download again':'download for windows'}</a><a href={REPO}>source on github</a></div>
          <ul className="cx-out">
            <li><span>version</span><span>{release!.version}</span></li>
            <li><span>system</span><span>Windows 10 &amp; 11, 64-bit</span></li>
            {release!.size?<li><span>size</span><span>{Math.round(release!.size/1048576)} MB</span></li>:null}
            {release!.sha256?<li><span>sha256</span><span className="cx-hash">{release!.sha256}</span></li>:null}
          </ul>
        </>:failed?<p role="alert" className="cx-status">We couldn’t load the latest release. <a href="/download/windows">Try the direct link</a> or email <a href="mailto:support@m4labs.xyz">support@m4labs.xyz</a>.</p>:<p role="status" className="cx-status">finding the latest version<span className="cx-spin"/></p>}
      </>}
      {account&&signedIn&&<div className="cx-account"><SecuritySettings/></div>}
    </div></section>
  </Site>;
}
