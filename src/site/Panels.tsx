import {useState} from 'react';
import {Icon} from '../Icons';
import {ClaudeLogo,GeminiLogo,GrokLogo,OpenAILogo} from '../BrandLogos';

// The parts of the app the page wants to look at closely, rebuilt in HTML from the app's own strings, materials and scale
// (row 38, text 14, label 12). Real captures appear only as whole windows; anything smaller than a window is drawn here,
// so it stays sharp, sits on real glass over the orbit, and reflows on a phone.

const check=<Icon name="verify" size={16}/>;

export function ModelsPanel(){
  const tabs=[['ChatGPT',<OpenAILogo size={15}/>],['Claude',<ClaudeLogo size={15}/>],['Grok',<GrokLogo size={15}/>],['Gemini',<GeminiLogo size={15}/>]] as const;
  return <figure className="o-glass o-models" data-rise aria-label="Clem's Models settings: ChatGPT, Claude, Grok and Gemini, with one ChatGPT account connected">
    <h3>Models</h3>
    <div className="o-tabs" aria-hidden="true">{tabs.map(([name,logo],i)=><span key={name} className={i?'':'on'}>{logo}{name}</span>)}</div>
    <div className="o-row" aria-hidden="true"><OpenAILogo size={20}/><div><b>ChatGPT</b><small>1 account connected</small></div><em>Add account</em></div>
    <div className="o-row o-inset" aria-hidden="true"><i className="o-avatar">S</i><div><b>sam@example.com</b><small>Plus · In use</small></div></div>
    <div className="o-row" aria-hidden="true"><div><b>Switch accounts automatically</b><small>When one runs low.</small></div><i className="o-switch"/></div>
  </figure>;
}

export function ExamPanel(){
  return <figure className="o-glass o-exam" data-rise aria-label="Next exam: Biology 101 in 12 days, with 6 cards to review">
    <h3><Icon name="clock" size={15}/>Next exam</h3>
    <p className="o-big">12 days</p>
    <b>Biology 101</b><small>6 cards to review</small>
  </figure>;
}

const tasks:[string,string,boolean][]=[['Reread membranes and transport','Done',true],['Osmosis lab write-up','Tomorrow',false],['Practice quiz on respiration','Tue',false],['Genetics problem set','Fri',false]];
export function PlanPanel(){
  return <figure className="o-glass o-plan" data-rise aria-label="A midterm plan, a quarter done and on track, with the lab write-up due tomorrow">
    <div className="o-plan-head">
      <div><p className="o-plan-title">Midterm plan</p><small>Ready for the midterm on the 19th</small></div>
      <p className="o-big">25<sup>%</sup></p>
    </div>
    <div className="o-bar-track" aria-hidden="true"><i style={{width:'25%'}}/></div>
    <ul>{tasks.map(([title,when,done])=><li key={title} className={done?'done':''}><i aria-hidden="true"/><span>{title}</span><small>{when}</small></li>)}</ul>
  </figure>;
}

/** What each citation opens: the passage on that page of the lab handout. */
const pages:Record<number,{head:string;text:string}>={
  2:{head:'Background',text:'Plant cell membranes are selectively permeable: water crosses freely, while most solutes cannot. In pure water the cell sap holds more solute than its surroundings, so water enters the cells by osmosis.'},
  3:{head:'Expected results',text:'Tissue in a 0 mol/L solution should gain between 8 and 15% of its mass. In 0.8 mol/L it should lose between 12 and 20%.'},
  4:{head:'Marking scheme',text:'One point each for naming the membrane, the direction of water movement, and the concentration gradient.'},
};

/** A chat answer you can try: each citation is a real button that opens its page beside the answer, as it does in the app. */
export function AnswerPanel(){
  const [page,setPage]=useState(2);
  const Cite=({p}:{p:number})=><button type="button" className={`o-cite${page===p?' on':''}`} aria-pressed={page===p} onClick={()=>setPage(p)}><Icon name="files" size={12}/>Lab handout.pdf · p. {p}</button>;
  return <div className="o-answer">
    <figure className="o-glass o-chat" data-rise aria-label="A sample answer from Clem with citations and checked numbers">
      <p className="o-ask">Why did the potato gain mass in pure water? Use my lab handout, and check the percentage.</p>
      <div className="o-reply">
        <p>The potato gained mass because of <b>osmosis</b>. Its cells hold more solute than pure water does, so water crosses the selectively permeable membrane into the cells <Cite p={2}/></p>
        <p>The cylinder went from 4.20 g to 4.71 g, a gain of 12.1%. That matches the 8 to 15% the handout expects for pure water <Cite p={3}/></p>
        <p>For your write-up, name the membrane, the direction of water and the gradient. The marking scheme gives a point for each <Cite p={4}/></p>
      </div>
      <p className="o-verdict">{check}2 of 2 numbers recomputed and confirmed</p>
      <p className="o-verdict">{check}Source check<span>2 of 2 claims supported</span></p>
    </figure>
    <figure className="o-handout" data-rise aria-live="polite">
      <figcaption><Icon name="files" size={15}/>Lab handout.pdf<span>{page} of 4</span></figcaption>
      <div className="o-sheet" key={page}><h4>{pages[page].head}</h4><p>{pages[page].text}</p></div>
    </figure>
  </div>;
}
