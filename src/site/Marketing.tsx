import {useEffect} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import {SupportPage} from './SupportPage';
import {Page} from './SiteHeader';
import {plates,shown} from './Landing';
import {Arrive} from './motion';
import {REPO} from './sections';

export function Marketing({route}:{route:string}){if(route==='/support'||route==='/pricing')return <SupportPage/>;return <MarketingPage route={route}/>;}

/** Breaks a short line in two at the word nearest its middle, so the title is written in two balanced lines. */
const halves=(s:string)=>{const w=s.split(' ');if(w.length<3)return [s];let best=1,diff=1e9;for(let i=1;i<w.length;i++){const d=Math.abs(w.slice(0,i).join(' ').length-w.slice(i).join(' ').length);if(d<diff){diff=d;best=i;}}return [w.slice(0,best).join(' '),w.slice(best).join(' ')];};

function MarketingPage({route}:{route:string}){
  const feature=shown.find(f=>route==='/features/'+f.id);
  useEffect(()=>{window.scrollTo(0,0);document.title=feature?`${feature.title}: Clem`:route==='/about'?'About Clem':'Clem features';},[route,feature]);
  if(route==='/about')return <Page title={['A place for','serious curiosity.']} scene="discover" lede="Clem is a calm desktop workspace for learning, research and professional work." next={['#/features','Features']}>
    <div className="cl-cols">
      <div className="cl-prose">
        <p>Subjects and projects hold your files, chats, flashcards and drafts together, and the AI you already pay for answers from them. It shows its work while it thinks, cites the page it read, and checks its own arithmetic.</p>
        <p>Your files stay yours, on your PC, and the code is open for anyone to read.</p>
      </div>
      <div className="cl-prose">
        <p>Clem is made by <a href="https://m4labs.xyz">M4 Labs</a>, an AI research lab that studies how AI can work alongside people. It is the lab’s first app, and it is free.</p>
        <div className="cl-actions"><a className="cl-btn" href="/download/windows"><Icon name="download" size={18}/>Download for Windows</a><a className="cl-link" href={REPO}><Icon name="github" size={18}/>View on GitHub</a></div>
      </div>
    </div>
  </Page>;
  if(feature){
    const i=shown.indexOf(feature),next=shown[(i+1)%shown.length];
    return <Page title={halves(feature.line)} lede={feature.intro} scene={plates[feature.id]} next={['#/features/'+next.id,next.title]}>
      <div className="cl-cols">
        <section><h2 className="cl-sub">How it works</h2><Arrive as="ol" className="cl-steps">{feature.steps.map(s=><li key={s}>{s}</li>)}</Arrive></section>
        <section><h2 className="cl-sub">What you get</h2><Arrive as="ul" className="cl-gets">{feature.outputs.map(x=><li key={x}>{x}</li>)}</Arrive></section>
      </div>
      {feature.note&&<p className="cl-note">{feature.note}</p>}
      <div className="cl-actions"><a className="cl-btn" href="/download/windows"><Icon name="download" size={18}/>Download for Windows</a><a className="cl-link" href="#/features">All features</a></div>
    </Page>;
  }
  return <Page title={['Everything happens','in one workspace.']} lede="Pick a kind of work to see how Clem handles it." next={['#/support','Support']}>
    <Arrive as="ul" className="cl-plates" step={60}>{shown.map((f,n)=><li key={f.id}><a href={'#/features/'+f.id}>
      <Illustration scene={plates[f.id]} className="cl-plate"/>
      <span className="cl-num">{String(n+1).padStart(2,'0')}</span><h3>{f.title}</h3><p>{f.line}</p>
      <span className="cl-more">Read more<Icon name="arrow" size={16}/></span>
    </a></li>)}</Arrive>
  </Page>;
}
