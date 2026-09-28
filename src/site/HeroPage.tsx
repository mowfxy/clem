import {useEffect, useState} from 'react';
import {Icon} from '../Icons';

/** What Mowr does, shown as the page it gives back: the question in Sans, the answer in Serif, and the
 *  proof underneath. The examples are written for the website, not live answers. */
const pages=[
  {tab:'Study',where:'Biology 101',ask:'Why did the potato gain mass in pure water?',
   answer:'Water moved in by osmosis. The potato cells held more dissolved sugar than the water around them, so water crossed their membranes until the cylinders swelled.',
   foot:[['files','Osmosis lab.pdf · p. 2'],['subjects','Made 3 flashcards']]},
  {tab:'Numbers',where:'Savings plan',ask:'What does £2,000 become at 4% a year for ten years?',
   answer:'About £2,960. Growing by 4% each year for ten years multiplies it by 1.04¹⁰, so £2,000 × 1.4802 = £2,960.49.',
   foot:[['check','1 number checked'],['analysis','Second opinion ready']]},
  {tab:'Documents',where:'Thermodynamics',ask:'Turn my notes into a revision pack.',
   answer:'Done. Twelve pages: the key definitions first, worked examples in the middle and twenty practice questions at the end.',
   foot:[['files','Revision pack.docx · editable'],['check','Sources cited']]},
] as const;

export function HeroPage(){
  const [at,setAt]=useState(0),[held,setHeld]=useState(false);
  useEffect(()=>{if(held||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const t=setTimeout(()=>setAt(i=>(i+1)%pages.length),9000);return()=>clearTimeout(t);},[at,held]);
  const p=pages[at];
  return <figure className="sx-page" onMouseEnter={()=>setHeld(true)} onMouseLeave={()=>setHeld(false)}>
    <div className="sx-page-tabs" role="tablist" aria-label="Examples">
      {pages.map((x,i)=><button key={x.tab} role="tab" aria-selected={i===at} className={i===at?'on':''} onClick={()=>{setAt(i);setHeld(true);}}>{x.tab}{i===at&&!held&&<i key={at} className="sx-page-timer" aria-hidden="true"/>}</button>)}
    </div>
    <div className="sx-page-sheet" key={at} role="tabpanel" aria-label={p.tab+' example'}>
      <span className="sx-page-where">{p.where}</span>
      <p className="sx-page-ask">{p.ask}</p>
      <p className="sx-page-answer">{p.answer.split(' ').map((w,i)=><span key={i} style={{animationDelay:`${.25+i*.045}s`}}>{w} </span>)}</p>
      <div className="sx-page-foot" style={{animationDelay:`${.4+p.answer.split(' ').length*.045}s`}}>
        {p.foot.map(([icon,label])=><span key={label}><Icon name={icon} size={14}/>{label}</span>)}
      </div>
    </div>
  </figure>;
}
