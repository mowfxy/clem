import {SiteFooter,SiteHeader} from './SiteHeader';
import {PricingPage} from './PricingPage';
import {useEffect} from 'react';
import {Illustration} from '../Illustrations';
import type {Scene} from '../vectorFilm';
import {Icon} from '../Icons';
import {features} from '../features';
import {Reveal} from './Reveal';

const scenes:Record<string,Scene>={'financial-analysis':'balance','physics-diagrams':'telescope','technical-reports':'build',research:'discover',learning:'learn',presentations:'conversation','professional-documents':'pencil','connected-work':'folder'};
// Provider-specific pages are not part of the product story.
const shown=features.filter(f=>f.id!=='multi-model-work');
export function FeatureArt({kind}:{kind:string}){return <div className="sx-feature-art"><Illustration scene={scenes[kind]||'learn'} ambient/></div>;}

export function Marketing({route}:{route:string}){if(route==='/pricing')return <PricingPage/>;return <MarketingPage route={route}/>;}

function MarketingPage({route}:{route:string}){
  const feature=shown.find(f=>route==='/features/'+f.id);
  useEffect(()=>{window.scrollTo(0,0);document.title=feature?`${feature.title} — Mowr`:route==='/about'?'About Mowr':'Mowr features';},[route,feature]);
  return <div className="sx-site"><SiteHeader/><main>
    {route==='/about'?<section className="sx-page-hero">
      <Reveal><h1>A place for<br/>serious curiosity.</h1><p className="sx-lede">Mowr is a calm desktop workspace for learning, research and professional work. Your files stay yours.</p><a className="sx-btn sx-btn-primary sx-btn-lg" href="#/download?start">Download for Windows<Icon name="download" size={18}/></a></Reveal>
    </section>:feature?<>
      <section className="sx-feature-hero">
        <Reveal><a className="sx-back" href="#/features"><Icon name="arrow" size={14}/>Features</a><h1>{feature.line}</h1><p className="sx-lede">{feature.intro}</p><a className="sx-btn sx-btn-primary sx-btn-lg" href="#/download?start">Download for Windows<Icon name="download" size={18}/></a></Reveal>
        <Reveal delay={120}><FeatureArt kind={feature.id}/></Reveal>
      </section>
      <section className="sx-section sx-feature-detail">
        <Reveal><h2>How it works</h2><ol>{feature.steps.map((s,i)=><li key={s}><span>{i+1}</span>{s}</li>)}</ol></Reveal>
        <Reveal delay={100}><h2>What you get</h2><ul>{feature.outputs.map(x=><li key={x}><Icon name="check" size={16}/>{x}</li>)}</ul></Reveal>
      </section>
      <section className="sx-section"><div className="sx-related">{shown.filter(f=>f.id!==feature.id).slice(0,3).map(f=><a key={f.id} href={'#/features/'+f.id}><span>{f.title}</span><Icon name="arrow" size={16}/></a>)}</div></section>
    </>:<>
      <section className="sx-page-hero"><Reveal><h1>Features</h1><p className="sx-lede">Everything happens in one workspace.</p></Reveal></section>
      <section className="sx-section sx-section-tight"><div className="sx-feature-grid">{shown.map((f,i)=><Reveal key={f.id} delay={(i%3)*80}><a className="sx-feature-card" href={'#/features/'+f.id}><FeatureArt kind={f.id}/><span className="sx-feature-title">{f.title}</span><p>{f.line}</p><Icon name="arrow" size={16}/></a></Reveal>)}</div></section>
    </>}
  </main><SiteFooter/></div>;
}
