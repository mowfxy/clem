import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {SiteFooter,SiteHeader} from './SiteHeader';
import {Icon,Logo} from '../Icons';
import {Illustration} from '../Illustrations';
import type {Scene} from '../vectorFilm';
import {HeroPage} from './HeroPage';
import {Reveal} from './Reveal';
import {Faq,PayPalCard} from './sections';

const Visual=lazy(()=>import('../Visual'));
const SpecDemo=lazy(()=>import('./SpecDemo'));

const features:[Scene,string,string][]=[
  ['folder','Projects','Sources, notes and chats in one place.'],
  ['learn','Study','Flashcards that return before you forget.'],
  ['build','Documents','Real Word, PowerPoint and Excel files.'],
  ['orchestrate','Tasks','Hand over multi-step work.'],
  ['discover','Research','Every claim links to its page.'],
  ['balance','Checked','Numbers recomputed. A second opinion on call.'],
];
// Each demo is the words someone typed; some use a ready-made model, others are drawn on request.
const demos:{ask:string;scene?:string;spec?:string}[]=[
  {ask:'a thrown ball',scene:'projectile'},
  {ask:'partial derivatives in 3D',spec:'partials'},
  {ask:'photosynthesis',spec:'photosynthesis'},
  {ask:'a methane molecule',spec:'methane'},
  {ask:'supply and demand',spec:'market'},
  {ask:'a standing wave',spec:'wave'},
  {ask:'compound interest',spec:'savings'},
  {ask:'planet orbits',scene:'orbit'},
];

/** Loads the live visual only when its section approaches the viewport. */
function VisualDemo(){
  const ref=useRef<HTMLDivElement>(null),[near,setNear]=useState(false),[pick,setPick]=useState(0);
  useEffect(()=>{const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setNear(true);io.disconnect();}},{rootMargin:'300px'});if(ref.current)io.observe(ref.current);return()=>io.disconnect();},[]);
  const demo=demos[pick];
  return <div ref={ref} className="sx-demo">
    <div className="sx-ask" aria-hidden="true"><span className="sx-ask-cmd">/visual</span><span key={demo.ask} className="sx-ask-text">{demo.ask}</span><b>↑</b></div>
    <div className="sx-chips" role="tablist" aria-label="Choose a visual">{demos.map((d,i)=><button key={d.ask} role="tab" aria-selected={pick===i} className={pick===i?'on':''} onClick={()=>setPick(i)}>{d.ask}</button>)}</div>
    <div className="sx-demo-stage">{near?<Suspense fallback={<div className="sx-demo-wait"/>}>{demo.scene?<Visual key={demo.ask} scene={demo.scene} compact/>:<SpecDemo key={demo.ask} name={demo.spec!}/>}</Suspense>:<div className="sx-demo-wait"/>}</div>
  </div>;
}

export function Landing(){
  useEffect(()=>{document.title='Mowr — Your space to think';},[]);
  return <div className="sx-site">
    <SiteHeader/>
    <main>
      <section className="sx-hero">
        <div className="sx-hero-glow" aria-hidden="true"/>
        <div className="sx-hero-copy">
          <Logo size={44} thinking/>
          <h1>Your space<br/>to think.</h1>
          <p className="sx-lede">One calm place for your projects, study and documents.</p>
          <div className="sx-cta-row">
            <a className="sx-btn sx-btn-primary sx-btn-lg" href="/download/windows">Download for Windows<Icon name="download" size={18}/></a>
            <a className="sx-btn sx-btn-ghost sx-btn-lg" href="#/features">Explore</a>
          </div>
          <p className="sx-fine">Free to download · Free to use</p>
        </div>
        <Reveal className="sx-hero-art"><HeroPage/></Reveal>
      </section>

      <section className="sx-section" id="features">
        <Reveal className="sx-head"><h2>Bring any kind of work.</h2></Reveal>
        <div className="sx-bento">{features.map(([scene,title,body],i)=><Reveal key={title} className="sx-tile" delay={(i%3)*90}>
          <div className="sx-tile-art"><Illustration scene={scene} ambient/></div>
          <h3>{title}</h3><p>{body}</p>
        </Reveal>)}</div>
      </section>

      <section className="sx-section" id="visuals">
        <Reveal className="sx-head sx-head-row"><div><h2>See it move.</h2><p>Ask for any idea. Play with the answer.</p></div></Reveal>
        <Reveal><VisualDemo/></Reveal>
      </section>

      <section className="sx-section">
        <Reveal className="sx-local">
          <div className="sx-local-art"><Illustration scene="house" ambient/></div>
          <div>
            <h2>Yours. On your PC.</h2>
            <ul className="sx-checks">
              <li><Icon name="check" size={17}/>Files live in Documents\Mowr.</li>
              <li><Icon name="check" size={17}/>Plain files. No lock-in.</li>
              <li><Icon name="check" size={17}/>Only what you choose is sent.</li>
            </ul>
          </div>
        </Reveal>
      </section>

      <section className="sx-section" id="support">
        <Reveal className="sx-head"><h2>Support</h2></Reveal>
        <PayPalCard/>
      </section>

      <section className="sx-section" id="faq">
        <Reveal className="sx-head"><h2>Questions.</h2></Reveal>
        <Faq/>
      </section>

      <section className="sx-final">
        <Reveal><Logo size={52} thinking/><h2>What’s on your mind?</h2><a className="sx-btn sx-btn-primary sx-btn-lg" href="/download/windows">Download for Windows<Icon name="download" size={18}/></a></Reveal>
      </section>
    </main>
    <SiteFooter/>
  </div>;
}
