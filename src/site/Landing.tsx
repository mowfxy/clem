import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Logo} from '../Icons';
import {features} from '../features';
import {AsciiMark} from './AsciiMark';
import {Prompt,Site} from './SiteHeader';
import {Faq,OpenSource,REPO} from './sections';

const SpecDemo=lazy(()=>import('./SpecDemo'));

// Provider-specific pages are not part of the product story.
export const shown=features.filter(f=>f.id!=='multi-model-work');
// Each demo is the words someone typed, drawn from the app's visual descriptions.
const demos:{ask:string;spec:string;doing:string}[]=[
  {ask:'partial derivatives in 3D',spec:'partials',doing:'drawing the surface'},
  {ask:'a methane molecule',spec:'methane',doing:'placing the atoms'},
];
// What Clem says it is doing while it thinks, as in the app.
const steps=['reading your notes','checking the phase margin','recomputing the gain','writing the answer'];

/** Clem's thinking: three cursors hopping in turn, with what it is doing beside them. */
export function Thinking({label}:{label:string}){return <span className="cx-thinking" role="status"><Logo size={22} thinking/><span>{label}</span></span>;}

/** Loads the live visual only when its section approaches the viewport. */
function VisualDemo(){
  const ref=useRef<HTMLDivElement>(null),[near,setNear]=useState(false),[pick,setPick]=useState(0);
  useEffect(()=>{const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setNear(true);io.disconnect();}},{rootMargin:'300px'});if(ref.current)io.observe(ref.current);return()=>io.disconnect();},[]);
  const demo=demos[pick];
  return <div ref={ref} className="cx-demo">
    <div className="cx-chips" role="tablist" aria-label="Choose a visual">{demos.map((d,i)=><button key={d.ask} role="tab" aria-selected={pick===i} onClick={()=>setPick(i)}>/visual {d.ask}</button>)}</div>
    <div className="cx-screen cx-demo-stage">{near?<Suspense fallback={<div className="cx-demo-wait"><Thinking label={demo.doing}/></div>}><SpecDemo key={demo.ask} name={demo.spec}/></Suspense>:<div className="cx-demo-wait"><Thinking label={demo.doing}/></div>}</div>
  </div>;
}

/** A short exchange that shows how Clem thinks: the question, the hopping cursors and what it is doing. */
function Exchange(){
  const [step,setStep]=useState(0);
  useEffect(()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const t=setInterval(()=>setStep(s=>(s+1)%steps.length),2200);return()=>clearInterval(t);},[]);
  return <div className="cx-screen cx-exchange">
    <p className="cx-bubble">why does my op-amp oscillate with a long cable?</p>
    <Thinking label={steps[step]}/>
  </div>;
}

export function Landing(){
  useEffect(()=>{document.title='Clem: your space to think';},[]);
  return <Site>
    <section className="cx-hero"><div className="cx-wrap">
      <div className="cx-hero-mark"><AsciiMark/></div>
      <Prompt>clem --about</Prompt>
      <h1>Your space to think.<span className="cx-caret" aria-hidden="true"/></h1>
      <p className="cx-status">One calm place for your projects, study and documents, on your PC, with the AI plan you already have.</p>
      <div className="cx-actions"><a className="cx-btn" href="/download/windows">download for windows</a><a href={REPO}>view source</a></div>
      <p className="cx-fine">free · open source · windows 10 &amp; 11 · an <a href="https://m4labs.xyz">M4 Labs</a> project</p>
    </div></section>

    <section className="cx-cmd" id="features"><div className="cx-wrap">
      <Prompt>ls features/</Prompt>
      <h2>Bring any kind of work.</h2>
      <ul className="cx-dir">{shown.map(f=><li key={f.id}><a href={'#/features/'+f.id}><span>{f.id}/</span><span className="dim">{f.line}</span></a></li>)}</ul>
    </div></section>

    <section className="cx-cmd" id="thinking"><div className="cx-wrap cx-split">
      <div><Prompt>clem "why does my op-amp oscillate?"</Prompt><h2>It shows its work.</h2><p className="cx-body">While Clem thinks, it tells you what it is doing. Citations open your file at the right page, calculations end with a check Clem recomputes, and any answer can get a second opinion.</p></div>
      <Exchange/>
    </div></section>

    <section className="cx-cmd" id="visuals"><div className="cx-wrap">
      <Prompt>clem /visual</Prompt>
      <h2>See it move.</h2>
      <p className="cx-body">Ask for any idea. Play with the answer: sliders, 3D you can turn, steps you can replay.</p>
      <VisualDemo/>
    </div></section>

    <section className="cx-cmd"><div className="cx-wrap">
      <Prompt>cat ~/Documents/Clem/README</Prompt>
      <h2>Yours. On your PC.</h2>
      <ul className="cx-out">
        <li><span>where</span><span>Documents\Clem, on your PC</span></li>
        <li><span>format</span><span>plain files you can open, move or back up</span></li>
        <li><span>sent</span><span>only what you choose, to the AI you choose</span></li>
        <li><span>ai</span><span>ChatGPT, Claude, Grok or Gemini: the plan you already pay for</span></li>
      </ul>
    </div></section>

    <section className="cx-cmd" id="open-source"><div className="cx-wrap"><OpenSource/></div></section>

    <section className="cx-cmd" id="faq"><div className="cx-wrap">
      <Prompt>clem --help</Prompt>
      <h2>Questions.</h2>
      <Faq/>
    </div></section>

    <section className="cx-cmd cx-final"><div className="cx-wrap">
      <Prompt>clem</Prompt>
      <h2>What’s on your mind?<span className="cx-caret" aria-hidden="true"/></h2>
      <div className="cx-actions"><a className="cx-btn" href="/download/windows">download for windows</a></div>
    </div></section>
  </Site>;
}
