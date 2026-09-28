import {useEffect,useId,useMemo,useRef,useState} from 'react';
import './activity-graph.css';

const DAY=86_400_000, DAYS=30;
const PAD_X=8, PAD_TOP=8, PAD_BOTTOM=8, GRID=8;

/** The grid's dots, each with a start offset: a slow wave that sweeps left to right, with a little
 * scatter so it shimmers instead of marching. Negative offsets start it mid-cycle on first paint. */
function gridDots(W:number,H:number){
  const dots:[number,number,number][]=[];
  for(let y=3;y<H;y+=GRID)for(let x=PAD_X%GRID+1;x<W;x+=GRID){
    const scatter=Math.abs(Math.sin(x*12.9898+y*78.233)*43758.5453)%1;
    dots.push([x,y,-(7-(x/W)*4.2-(y/H)*1.1-scatter*1.2)]);
  }
  return dots;
}

/** Counts per day for the last DAYS days, oldest first, ending today. */
export function dailyActivity(times:number[],now:number):number[]{
  const end=new Date(now);end.setHours(0,0,0,0);
  const start=end.getTime()-(DAYS-1)*DAY;
  const out=new Array(DAYS).fill(0);
  for(const t of times){
    const day=new Date(t);day.setHours(0,0,0,0);
    const i=Math.round((day.getTime()-start)/DAY);
    if(i>=0&&i<DAYS)out[i]++;
  }
  return out;
}

/** A thin line over a dotted grid, ending in a glowing dot, for the last 30 days of `times`. It fills its
 * container's width (down to 240px); hovering scrubs along it and reports the day under the pointer. */
export function ActivityGraph({times,tone,label='Activity graph',height=56,onScrub}:{times:number[];tone:'green'|'white';label?:string;height?:number;onScrub?:(day:{at:number;count:number}|null)=>void}){
  const id=useId().replace(/:/g,'');
  const box=useRef<HTMLElement>(null);
  const svg=useRef<SVGSVGElement>(null);
  const [W,setW]=useState(240);
  const H=height;
  useEffect(()=>{
    const el=box.current;if(!el||typeof ResizeObserver==='undefined')return;
    const ro=new ResizeObserver(([e])=>setW(Math.max(240,Math.round(e.contentRect.width))));
    ro.observe(el);return()=>ro.disconnect();
  },[]);
  const [hover,setHover]=useState<number|null>(null);
  const raw=useMemo(()=>dailyActivity(times,Date.now()),[times]);
  const dots=useMemo(()=>gridDots(W,H),[W,H]);
  const points=useMemo(()=>{
    // A light rolling blend so the line reads as a trend rather than a row of spikes.
    const days=raw.map((_,i)=>[-2,-1,0,1,2].reduce((sum,d)=>sum+(raw[i+d]??0)*[1,2,4,2,1][d+2],0)/10);
    // Square root keeps one busy day from flattening the rest of the month.
    const top=Math.sqrt(Math.max(...days,1));
    const span=W-PAD_X*2, rise=H-PAD_TOP-PAD_BOTTOM;
    return days.map((n,i)=>({x:PAD_X+span*i/(DAYS-1),y:H-PAD_BOTTOM-rise*Math.sqrt(n)/top}));
  },[raw,W,H]);
  const line=smooth(points);
  const area=`${line}L${points[points.length-1].x} ${H}L${points[0].x} ${H}Z`;
  const end=points[points.length-1];
  const curve=useRef<SVGPathElement>(null);
  const at=hover===null?null:pointAt(curve.current,hover);
  const move=(e:React.PointerEvent)=>{
    const r=svg.current?.getBoundingClientRect();if(!r)return;
    const x=Math.min(W-PAD_X,Math.max(PAD_X,(e.clientX-r.left)/r.width*W));
    setHover(x);
    if(onScrub){
      const i=Math.round((x-PAD_X)/(W-PAD_X*2)*(DAYS-1));
      const today=new Date();today.setHours(0,0,0,0);
      onScrub({at:today.getTime()-(DAYS-1-i)*DAY,count:raw[i]});
    }
  };

  return <figure ref={box} className={`activity-graph tone-${tone} ${at?'scrubbing':''}`} onPointerMove={move} onPointerLeave={()=>{setHover(null);onScrub?.(null);}}>
    <figcaption>{label}</figcaption>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label} for the last 30 days`}>
      <defs>
        <pattern id={`grid-${id}`} width={GRID} height={GRID} patternUnits="userSpaceOnUse" x={PAD_X%GRID} y="2">
          <circle cx="1" cy="1" r=".7" className="dot"/>
        </pattern>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="fill-top"/><stop offset="1" className="fill-bottom"/>
        </linearGradient>
        <radialGradient id={`lens-${id}`}>
          <stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id={`feather-${id}`} cx=".5" cy=".5" r=".62" gradientTransform="translate(.5 .5) scale(1 1.6) translate(-.5 -.5)">
          <stop offset=".55" stopColor="#fff"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
        <mask id={`edge-${id}`}><rect width={W} height={H} fill={`url(#feather-${id})`}/></mask>
        <mask id={`near-${id}`}><rect width={W} height={H} fill="#000"/>{at&&<circle cx={at.x} cy={H/2} r="46" fill={`url(#lens-${id})`}/>}</mask>
      </defs>
      <g className="grid" mask={`url(#edge-${id})`}>{dots.map(([x,y,d],i)=><circle key={i} cx={x} cy={y} r=".7" className="dot" style={{animationDelay:`${d}s`}}/>)}</g>
      <rect width={W} height={H} fill={`url(#grid-${id})`} className="grid-lit" mask={`url(#near-${id})`}/>
      <path d={area} fill={`url(#fill-${id})`} className="area"/>
      <path ref={curve} d={line} className="line" pathLength={1}/>
      {at&&<line x1={at.x} x2={at.x} y1={PAD_TOP-6} y2={H} className="guide"/>}
      <g className="end" style={{transform:`translate(${(at||end).x}px,${(at||end).y}px)`}}>
        <circle r="7" className="halo"/>
        <circle r="3.2" className="core"/>
      </g>
    </svg>
  </figure>;
}

/** A monotone cubic through the points (Fritsch–Carlson), so the curve never overshoots below zero or above a peak. */
function smooth(p:{x:number;y:number}[]){
  const n=p.length,d=p.slice(1).map((q,i)=>(q.y-p[i].y)/(q.x-p[i].x));
  const m=p.map((_,i)=>i===0?d[0]:i===n-1?d[n-2]:d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2);
  for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=m[i+1]=0;continue;}const a=m[i]/d[i],b=m[i+1]/d[i],h=Math.hypot(a,b);if(h>3){m[i]=3*a/h*d[i];m[i+1]=3*b/h*d[i];}}
  const f=(v:number)=>v.toFixed(1);
  return p.reduce((out,q,i)=>{if(!i)return `M${f(q.x)} ${f(q.y)}`;const a=p[i-1],dx=(q.x-a.x)/3;return out+`C${f(a.x+dx)} ${f(a.y+m[i-1]*dx)} ${f(q.x-dx)} ${f(q.y-m[i]*dx)} ${f(q.x)} ${f(q.y)}`;},'');
}

/** The point on the drawn curve at a given x, found by bisecting along the path. */
function pointAt(path:SVGPathElement|null,x:number){
  if(!path)return null;
  const total=path.getTotalLength();let lo=0,hi=total;
  for(let k=0;k<18;k++){const mid=(lo+hi)/2;if(path.getPointAtLength(mid).x<x)lo=mid;else hi=mid;}
  const q=path.getPointAtLength(hi);return {x:q.x,y:q.y};
}
