import {useEffect,useRef,useState} from 'react';
import {VIEW,filmFrame,filmSeconds,shotAt,shots} from './film-script';
import {still} from './motion';

// Played a little faster than the drawings were timed, so the story moves at a reader's pace.
const SPEED=1.35;
// The finished first pose: what shows before the film starts, and all that shows under reduced motion.
const POSTER=3.4;
// The last drawing holds a moment before the film starts again.
const HOLD=1.6;

/** Clem's ink film, shown like a muted video with no controls: it plays while it is on screen and loops, drawn on
 *  twos. Under reduced motion it stays on its first finished drawing. */
export function InkFilm(){
  const svg=useRef<SVGSVGElement>(null),box=useRef<HTMLElement>(null);
  const time=useRef(POSTER),timer=useRef(0),lastCel=useRef(-1),visible=useRef(false),started=useRef(false);
  const [shot,setShot]=useState(0);

  useEffect(()=>{
    const paint=(t:number)=>{const at=Math.min(t,filmSeconds-.001);if(svg.current)svg.current.innerHTML=filmFrame(at);setShot(shotAt(at));};
    const stop=()=>{clearTimeout(timer.current);timer.current=0;};
    const run=()=>{
      stop();
      if(!visible.current||document.hidden||still())return;
      let last=performance.now();
      const tick=()=>{
        const now=performance.now();time.current+=Math.min(now-last,100)/1000*SPEED;last=now;
        // At the end: rest on the last drawing, then begin again from the first.
        if(time.current>=filmSeconds+HOLD*SPEED)time.current=0;
        const cel=Math.floor(Math.min(time.current,filmSeconds-.001)*12);
        if(cel!==lastCel.current){lastCel.current=cel;paint(time.current);}
        timer.current=window.setTimeout(tick,Math.max(1,((cel+1)/12-time.current)*1000/SPEED));
      };
      tick();
    };
    paint(POSTER);
    const io=new IntersectionObserver(([e])=>{
      visible.current=e.isIntersecting;
      if(e.isIntersecting&&!started.current&&!still()){started.current=true;time.current=0;}
      if(e.isIntersecting)run();else stop();
    },{threshold:.35});
    const el=box.current!;
    io.observe(el);
    const vis=()=>document.hidden?stop():run();
    document.addEventListener('visibilitychange',vis);
    return()=>{io.disconnect();stop();document.removeEventListener('visibilitychange',vis);};
  },[]);

  return <figure className="cl-film" ref={box} aria-label="Clem, a short film drawn in ink">
    <div className="cl-film-frame">
      <svg ref={svg} viewBox={VIEW} aria-hidden="true"/>
    </div>
    <p className="cl-film-caption" aria-hidden="true"><span key={shot}>{shots[shot].caption}</span></p>
    <figcaption className="cl-sr">An animated film in Clem’s ink drawing style. {shots.map(s=>s.caption).join(' ')}</figcaption>
  </figure>;
}
