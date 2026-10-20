import {useEffect,useRef} from 'react';
import {MARK_CURSOR} from '../../core/mark';

// Clem's mark drawn in characters, in the manner of m4labs.xyz: the C's arc and its cursor are sampled from the same
// geometry as core/mark.ts, shaded by distance to the stroke's edge. A slow shimmer runs through the arc and the cursor
// blinks like a terminal's. Motion stops for reduced-motion and while the page is hidden.
const RAMP=' .:-=+*#%@';
const R=30,HALF=6.5,NUDGE=3.8;
// The arc's ends, where the round caps sit; the opening is the wedge between them on the right.
const END=Math.atan2(20.07,22.29);
const C=MARK_CURSOR;

/** Signed coverage in [0,1] of the mark's arc at (x,y) in its 100-unit box. */
function arc(x:number,y:number){
  const dx=x-50-NUDGE,dy=y-50,a=Math.atan2(dy,dx);
  let d:number;
  if(Math.abs(a)>=END)d=Math.abs(Math.hypot(dx,dy)-R)-HALF;
  else{const ex=R*Math.cos(END),ey=R*Math.sin(END);d=Math.min(Math.hypot(dx-ex,dy-ey),Math.hypot(dx-ex,dy+ey))-HALF;}
  return Math.max(0,Math.min(1,.5-d/2.4));
}
function cursor(x:number,y:number){
  // Signed distance to the cursor's box: positive outside, negative (depth) inside.
  const cx=C.x+NUDGE,qx=Math.abs(x-cx-C.width/2)-C.width/2,qy=Math.abs(y-C.y-C.height/2)-C.height/2;
  const d=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0);
  return Math.max(0,Math.min(1,.5-d/2.4));
}

export function AsciiMark({className=''}:{className?:string}){
  const pre=useRef<HTMLPreElement>(null);
  useEffect(()=>{
    const el=pre.current!;
    const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols=0,rows=0,arcCells:Float32Array=new Float32Array(0),curCells:Float32Array=new Float32Array(0),raf=0,last=0;
    const measure=()=>{
      const probe=document.createElement('span');probe.textContent='M'.repeat(20);probe.style.cssText='position:absolute;visibility:hidden;white-space:pre';el.appendChild(probe);
      const cw=probe.getBoundingClientRect().width/20,ch=parseFloat(getComputedStyle(el).lineHeight)||12;probe.remove();
      const box=el.getBoundingClientRect();
      cols=Math.max(10,Math.floor(box.width/cw));rows=Math.max(6,Math.floor(box.height/ch));
      // Fit the 100-unit box into the grid, keeping it square on screen.
      const side=Math.min(box.width,box.height)*.94,ox=(box.width-side)/2,oy=(box.height-side)/2;
      arcCells=new Float32Array(cols*rows);curCells=new Float32Array(cols*rows);
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
        const x=((i+.5)*cw-ox)/side*100,y=((j+.5)*ch-oy)/side*100;
        arcCells[j*cols+i]=arc(x,y);curCells[j*cols+i]=cursor(x,y);
      }
    };
    const draw=(t:number)=>{
      const on=still||Math.floor(t/530)%2===0;
      let out='';
      for(let j=0;j<rows;j++){
        for(let i=0;i<cols;i++){
          const k=j*cols+i,a=arcCells[k],c=on?curCells[k]:0;
          // The shimmer: a soft band sweeping round the C, nudging each cell up or down the ramp.
          const wave=still?0:.18*Math.sin(t/900-(i*.11+j*.07));
          const v=Math.max(a?Math.min(1,a+wave*a):0,c);
          out+=RAMP[Math.round(v*(RAMP.length-1))];
        }
        out+='\n';
      }
      el.textContent=out;
    };
    const loop=(t:number)=>{raf=requestAnimationFrame(loop);if(t-last<80||document.hidden)return;last=t;draw(t);};
    measure();draw(0);
    if(!still)raf=requestAnimationFrame(loop);
    const ro=new ResizeObserver(()=>{measure();draw(performance.now());});ro.observe(el);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();};
  },[]);
  return <pre ref={pre} className={`cx-ascii ${className}`} aria-hidden="true"/>;
}
