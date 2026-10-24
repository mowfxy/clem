import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Icon,Logo} from '../Icons';
import {greeting} from './clock';
import {still,useSeen} from './motion';

// One question followed through Clem, chapter by chapter: the Clem window rebuilt in HTML with the app's own strings
// and icons (a demonstration, not a capture). Each chapter plays its pose over a few seconds and hands on to the next;
// the reader can pick any chapter, and nothing plays by itself under reduced motion.

const QUESTION='why does my op-amp oscillate with a long cable?';
export const chapters=[
  {id:'ask',title:['Ask the way','you think.'],body:'Type the question as it comes to you, and drop in your notes. Clem reads what you give it.'},
  {id:'think',title:['Watch it','work.'],body:'While it thinks, Clem tells you what it is doing: which file it is reading, what it is checking, what it is working out again.'},
  {id:'answer',title:['Check every','claim.'],body:'Each citation opens your file at the right page. A calculation ends with a check Clem recomputes itself.'},
  {id:'keep',title:['Keep what','you learn.'],body:'The chat joins a subject: flashcards from the answer, a plan paced to your exam, and a memory of what you find hard.'},
  {id:'write',title:['Write it','up.'],body:'When it is time to hand something in, the work becomes a document you edit, then export to Word, PDF or PowerPoint.'},
  {id:'yours',title:['Keep it','yours.'],body:'Every chat, card and draft is a plain file in Documents\\Clem, on your PC. Only what you choose goes to the AI you choose.'},
] as const;
const titles=['New chat','Op-amp oscillation','Op-amp oscillation','Electronics II','Lab 3 report','Files'];
const navFor=['new','new','new','subjects','projects','files'];
const nav:[string,string][]=[['new','New chat'],['visuals','Visuals'],['projects','Projects'],['subjects','Subjects'],['files','Files']];

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
/** 0 → 1 across [a, b] of a chapter's progress. */
const span=(p:number,a:number,b:number)=>clamp((p-a)/(b-a));
const on=(b:boolean)=>b?' is-on':'';

/** The Clem window in one chapter's pose. `p` is how far through the chapter the reader is, 0 to 1. */
export function Window({step,p}:{step:number;p:number}){
  const show=(i:number)=>Math.abs(i-step)<=1;
  const state=(i:number)=>i===step?'on':i<step?'past':'next';
  return <div className="cl-win" data-step={chapters[step].id}>
    <aside className="cl-win-side" aria-hidden="true">
      <span className="cl-win-brand"><Logo size={20} still/><span className="wordmark">clem</span></span>
      <ul>{nav.map(([icon,label])=><li key={icon} className={on(navFor[step]===icon)}><Icon name={icon} size={17}/>{label}</li>)}</ul>
      <p className="cl-win-label">Recent thoughts</p>
      <ul className="cl-win-recent">
        <li className={'is-new'+on(step>=2)}>Op-amp oscillation</li>
        <li>Integration by parts</li>
        <li>Thesis: heat flow in rods</li>
      </ul>
    </aside>
    <div className="cl-win-main">
      <div className="cl-win-top"><span key={titles[step]}>{titles[step]}</span></div>
      <div className="cl-win-body">
        {show(0)&&<div className="cl-scene" data-state={state(0)}><Ask p={step===0?p:1}/></div>}
        {show(1)&&<div className="cl-scene" data-state={state(1)}><Think p={step===1?p:step>1?1:0}/></div>}
        {show(2)&&<div className="cl-scene" data-state={state(2)}><Answer p={step===2?p:step>2?1:0}/></div>}
        {show(3)&&<div className="cl-scene" data-state={state(3)}><Keep p={step===3?p:step>3?1:0}/></div>}
        {show(4)&&<div className="cl-scene" data-state={state(4)}><Write p={step===4?p:step>4?1:0}/></div>}
        {show(5)&&<div className="cl-scene" data-state={state(5)}><Yours p={step===5?p:0}/></div>}
      </div>
    </div>
  </div>;
}

function Ask({p}:{p:number}){
  const typed=QUESTION.slice(0,Math.round(span(p,.08,.75)*QUESTION.length)),done=p>.82;
  return <div className="cl-ask">
    <p className="cl-greet"><Logo size={30} still/>{greeting(new Date().getHours())}, thinker.</p>
    <div className={'cl-composer'+on(done)}>
      <span className={'cl-file'+on(p>.02)}><Icon name="files" size={16}/>lab-3-notes.pdf<small>4 pages</small></span>
      <p className="cl-typed">{typed||<span className="cl-ph">How can I help you today?</span>}{!done&&<i className="cl-caret"/>}</p>
      <div className="cl-composer-row"><Icon name="attach" size={18}/><span className="cl-model">Claude</span><span className={'cl-send'+on(done)}><Icon name="send" size={16}/></span></div>
    </div>
    <div className="cl-chips">{[['research','Research a question'],['subjects','Learn something'],['files','Make a document'],['visuals','See an idea']].map(([i,l])=><span key={l}><Icon name={i} size={15}/>{l}</span>)}</div>
  </div>;
}

const thinking=['Reading lab-3-notes.pdf','Finding the cable on page 4','Checking the phase margin','Recomputing the output pole'];
function Think({p}:{p:number}){
  const done=thinking.filter((_,k)=>p>(k+1)/5).length;
  return <div className="cl-chat">
    <p className="cl-bubble">{QUESTION}<span className="cl-bubble-file"><Icon name="files" size={14}/>lab-3-notes.pdf</span></p>
    <div className="cl-think">
      <p className="cl-think-now"><Logo size={22} thinking/><span key={done}>{done<thinking.length?thinking[done]:'Writing the answer'}</span></p>
      <ol>{thinking.map((s,k)=><li key={s} className={(k<done?' is-done':'')+(k===done?' is-now':'')}><i/>{s}</li>)}</ol>
    </div>
  </div>;
}

function Answer({p}:{p:number}){
  const page=p>.62;
  return <div className={'cl-chat cl-answering'+on(page)}>
    <div className="cl-answer">
      <p className="cl-bubble cl-bubble-sm">{QUESTION}</p>
      <p className={'cl-para'+on(p>.04)}>The cable is the load. Ten metres of coax adds about 1&nbsp;nF<button type="button" className={'cl-cite'+on(page)} tabIndex={-1}>lab-3-notes.pdf, p.&nbsp;4</button>, and with the op-amp’s 100&nbsp;Ω output resistance that puts a second pole inside the loop’s bandwidth.</p>
      <p className={'cl-para'+on(p>.2)}>That pole costs phase. The margin falls from about 70° to about 25°, so a step overshoots and rings. A little more cable and it oscillates.</p>
      <p className={'cl-para'+on(p>.34)}>Two fixes: a 50&nbsp;Ω resistor in series with the output, or a buffer rated for capacitive loads.</p>
      <p className={'cl-check'+on(p>.48)}><Icon name="verify" size={16}/><span>Recomputed: f = 1 / (2π × 100&nbsp;Ω × 1.01&nbsp;nF) = <b>1.58&nbsp;MHz</b></span></p>
    </div>
    <figure className={'cl-pdf'+on(page)} aria-hidden="true">
      <figcaption><Icon name="files" size={14}/>lab-3-notes.pdf<span>p. 4 of 4</span></figcaption>
      <div className="cl-pdf-page">
        <b>4 · Setup</b>
        <span>Supply ±12 V, gain +2, 10 kΩ feedback.</span>
        <span>Output resistance R<sub>o</sub> ≈ 100 Ω (datasheet).</span>
        <mark className={on(p>.72)}>Load: RG-58 coax, 10 m at 101 pF/m.</mark>
        <span>Scope on the far end of the cable.</span>
        <span className="cl-pdf-scrawl">rings at ~1.5 MHz?</span>
        <i/><i/><i/>
      </div>
    </figure>
  </div>;
}

const tabs=['Overview','Chats','Plan','Flashcards','Quizzes','Files','Visuals','Memory'];
function Keep({p}:{p:number}){
  const flipped=p>.38;
  return <div className="cl-subject">
    <div className="cl-subject-head"><span className="cl-subject-tile"><Icon name="subjects" size={22}/></span><h3>Electronics II</h3><span className={'cl-due'+on(p>.08)}>Exam · 12 Nov</span></div>
    <ul className="cl-tabs">{tabs.map(t=><li key={t} className={on(t==='Flashcards')}>{t}</li>)}</ul>
    <div className="cl-subject-grid">
      <div className={'cl-card'+(flipped?' is-flipped':'')}>
        <div className="cl-card-face"><small>Card 3 of 12 · from “Op-amp oscillation”</small><p>What does capacitance at an op-amp’s output do to the loop?</p><span className="cl-card-hint">Show answer</span></div>
        <div className="cl-card-face cl-card-back"><small>Answer</small><p>With the output resistance it adds a pole, which cuts the phase margin. The circuit rings, then oscillates.</p><span className="cl-card-grade"><b>Again</b><b>Hard</b><b className="is-on">Good</b><b>Easy</b></span></div>
      </div>
      <div className="cl-subject-side">
        <div className={'cl-plan'+on(p>.2)}><small>Plan</small><p><b>4</b> cards due today</p><div className="cl-meter"><i style={{width:`${30+span(p,.2,.8)*32}%`}}/></div><span>On pace for 12 Nov</span></div>
        <div className={'cl-memory'+on(p>.62)}><small>Clem remembers</small><p>You find phase margin hard.</p><span>Learned from a chat · today</span></div>
      </div>
    </div>
  </div>;
}

function Write({p}:{p:number}){
  const saved=p>.78;
  return <div className="cl-doc">
    <div className="cl-doc-sheet">
      <p className="cl-doc-kicker">Electronics II · Lab 3</p>
      <h3>Driving a capacitive load</h3>
      <p className={'cl-doc-p'+on(p>.06)}><b>Aim.</b> Find why the amplifier rings when it drives 10&nbsp;m of coax, and fix it.</p>
      <figure className={'cl-doc-fig'+on(p>.16)}>
        <svg viewBox="0 0 300 92" aria-hidden="true"><path className="axis" d="M8 84H292M8 84V6"/><path className="step" d="M8 50H292"/><path className="ring" pathLength={1} style={{strokeDashoffset:1-span(p,.18,.56)}} d="M8 84C30 84 34 18 48 18S64 70 78 70 92 34 104 34 118 60 130 60 142 42 154 42 166 54 178 54 190 47 202 47 214 51 226 51 240 49 252 49 270 50 292 50"/></svg>
        <figcaption>Figure 1. Output for a 1 V step, 10 m of cable.</figcaption>
      </figure>
      <p className={'cl-doc-p'+on(p>.42)}><b>Findings.</b> The cable’s 1.01&nbsp;nF and the 100&nbsp;Ω output resistance place a pole at 1.58&nbsp;MHz, leaving about 25° of phase margin.</p>
      <p className={'cl-doc-p'+on(p>.56)}><b>Fix.</b> A 50&nbsp;Ω series resistor restores about 60°.</p>
    </div>
    <div className="cl-export">
      {['Word','PDF','PowerPoint'].map((f,i)=><span key={f} className={on(i===0&&p>.66)}><Icon name="download" size={15}/>{f}</span>)}
      <span className={'cl-saved'+on(saved)}><Icon name="verify" size={15}/>Saved Lab 3 report.docx</span>
    </div>
  </div>;
}

const tree:[number,string,string,boolean?][]=[
  [0,'folder','Documents\\Clem'],
  [1,'folder','Electronics II'],
  [2,'chat','Op-amp oscillation'],
  [2,'files','lab-3-notes.pdf'],
  [2,'files','Lab 3 report.docx',true],
  [2,'visuals','Why a long cable rings.svg'],
  [2,'subjects','Flashcards · 12 cards'],
  [1,'folder','Calculus'],
  [1,'folder','Thesis'],
  [1,'folder','Backups'],
];
function Yours({p}:{p:number}){
  return <div className="cl-yours">
    <div className="cl-explorer">
      <p className="cl-explorer-path"><Icon name="folder" size={16}/>This PC › Documents › Clem</p>
      <ul>{tree.map(([d,i,name,fresh],k)=><li key={name} className={on(p>k*.06)+(fresh&&p>.7?' is-fresh':'')} style={{'--d':d} as CSSProperties}><Icon name={i} size={16}/>{name}</li>)}</ul>
    </div>
    <ul className={'cl-sent'+on(p>.55)}>
      <li><Icon name="lock" size={15}/>Kept on this PC</li>
      <li><Icon name="send" size={15}/>Sent only to the AI you pick</li>
      <li><Icon name="files" size={15}/>Plain files you can move or back up</li>
    </ul>
  </div>;
}

const CHAPTER=6.5;
/** The demo: chapters on one side, the window on the other. It plays while in view, once through; a chapter can be picked. */
export function Demo(){
  const [ref,seen]=useSeen<HTMLDivElement>('0px 0px -30% 0px');
  const [pos,setPos]=useState({step:0,p:still()?1:0}),[playing,setPlaying]=useState(false);
  const clock=useRef(0),visible=useRef(false),wrap=useRef<HTMLDivElement>(null),N=chapters.length;
  const {step,p}=pos,list=useRef<HTMLOListElement>(null);
  useEffect(()=>{if(seen&&!still())setPlaying(true);},[seen]);
  // On a phone the chapters are a row of chips: keep the current one in view without moving the page.
  useEffect(()=>{const ol=list.current,li=ol?.children[step] as HTMLElement|undefined;if(ol&&li&&ol.scrollWidth>ol.clientWidth)ol.scrollTo({left:li.offsetLeft-ol.clientWidth/2+li.offsetWidth/2,behavior:'smooth'});},[step]);
  useEffect(()=>{const io=new IntersectionObserver(([e])=>{visible.current=e.isIntersecting;});if(wrap.current)io.observe(wrap.current);return()=>io.disconnect();},[]);
  // One clock in chapter-seconds runs the whole demo; it only moves while the demo is on screen.
  useEffect(()=>{
    if(!playing)return;
    let raf=0,last=performance.now();
    const f=(t:number)=>{
      // A frame's timestamp can be a hair before the performance.now() taken above; never run the clock backwards.
      const dt=Math.max(0,Math.min(t-last,100))/1000;last=t;
      if(visible.current&&!document.hidden)clock.current=Math.min(N,clock.current+dt/CHAPTER);
      const s=Math.min(N-1,Math.floor(clock.current)),q=clock.current>=N?1:clock.current-s;
      setPos(o=>o.step===s&&Math.abs(o.p-q)<.004?o:{step:s,p:q});
      if(clock.current>=N){setPlaying(false);return;}
      raf=requestAnimationFrame(f);
    };
    raf=requestAnimationFrame(f);return()=>cancelAnimationFrame(raf);
  },[playing,N]);
  const pick=(i:number)=>{clock.current=still()?i+.999:i;setPos({step:i,p:still()?1:0});if(!still())setPlaying(true);};
  return <div className="cl-demo" ref={wrap}><div ref={ref} className="cl-demo-grid">
    <ol className="cl-demo-list" ref={list}>{chapters.map((c,i)=><li key={c.id} className={(i===step?'is-on':'')+(i<step?' is-past':'')}>
      <button type="button" onClick={()=>pick(i)} aria-pressed={i===step}>
        <span className="cl-num">{String(i+1).padStart(2,'0')}</span>
        <span className="cl-demo-title">{c.title.join(' ')}</span>
      </button>
      <p className="cl-demo-body">{c.body}</p>
      <i className="cl-demo-meter" style={{'--p':i<step?1:i===step?p:0} as CSSProperties}/>
    </li>)}</ol>
    <div className="cl-demo-stage">
      <Window step={step} p={p}/>
      <p className="cl-demo-now" key={step}>{chapters[step].body}</p>
    </div>
  </div></div>;
}
