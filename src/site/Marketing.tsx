import {useEffect} from 'react';
import {SupportPage} from './SupportPage';
import {Page} from './SiteHeader';
import {shown} from './Landing';
import {REPO} from './sections';

export function Marketing({route}:{route:string}){if(route==='/support'||route==='/pricing')return <SupportPage/>;return <MarketingPage route={route}/>;}

function MarketingPage({route}:{route:string}){
  const feature=shown.find(f=>route==='/features/'+f.id);
  useEffect(()=>{window.scrollTo(0,0);document.title=feature?`${feature.title}: Clem`:route==='/about'?'About Clem':'Clem features';},[route,feature]);
  if(route==='/about')return <Page cmd="cat about.txt" title="A place for serious curiosity." next={['#/features','features']}>
    <div className="cx-body">
      <p>Clem is a calm desktop workspace for learning, research and professional work. Subjects and projects hold your files, chats, flashcards and drafts together, and the AI you already pay for answers from them.</p>
      <p>Your files stay yours, on your PC, and the code is open for anyone to read. Clem is the first app from <a href="https://m4labs.xyz">M4 Labs</a>, an AI research lab that studies how AI can work alongside people.</p>
    </div>
    <div className="cx-actions"><a className="cx-btn" href="/download/windows">download for windows</a><a href={REPO}>view on github</a></div>
  </Page>;
  if(feature){
    const i=shown.indexOf(feature),next=shown[(i+1)%shown.length];
    return <Page cmd={`cat features/${feature.id}.txt`} title={feature.line} next={['#/features/'+next.id,next.id]}>
      <div className="cx-body"><p>{feature.intro}</p></div>
      <h2 className="cx-sub">how it works</h2>
      <ol className="cx-out cx-steps">{feature.steps.map((s,n)=><li key={s}><span>{String(n+1).padStart(2,'0')}</span><span>{s}</span></li>)}</ol>
      <h2 className="cx-sub">what you get</h2>
      <ul className="cx-out">{feature.outputs.map(x=><li key={x}><span>+</span><span>{x}</span></li>)}</ul>
      {feature.note&&<p className="cx-fine cx-note"># {feature.note}</p>}
      <div className="cx-actions"><a className="cx-btn" href="/download/windows">download for windows</a><a href="#/features">all features</a></div>
    </Page>;
  }
  return <Page cmd="ls features/" title="Everything happens in one workspace." next={['#/support','support']}>
    <ul className="cx-dir">{shown.map(f=><li key={f.id}><a href={'#/features/'+f.id}><span>{f.id}/</span><span className="dim">{f.line}</span></a></li>)}</ul>
  </Page>;
}
