import {useId,useMemo,useRef,useState} from 'react';
import type {Chat,StoredFile,StudySet} from '../../core/types';

const DAY=86_400_000, DAYS=30;
const W=232, H=78, PAD_X=8, PAD_TOP=12, PAD_BOTTOM=12, GRID=8;

/** Every moment something happened in a space: chats, file edits, study sets, quiz attempts and card reviews. */
export function activityTimes(chats:Chat[],files:StoredFile[],sets:StudySet[]):number[]{
  return [
    ...chats.map(c=>c.updated),
    ...files.flatMap(f=>[f.created,...(f.updated?[f.updated]:[]),...(f.versions||[]).map(v=>v.at)]),
    ...sets.flatMap(s=>[s.created,...s.attempts.map(a=>a.at),...(s.cards||[]).flatMap(c=>c?.reps?[c.last]:[])]),
  ].filter(t=>Number.isFinite(t)&&t>0);
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

/** A thin line over a dotted grid, ending in a glowing dot. Hovering scrubs along it; there is no text on hover. */
export function ActivityGraph({chats,files,sets,tone}:{chats:Chat[];files:StoredFile[];sets:StudySet[];tone:'green'|'white'}){
  const id=useId().replace(/:/g,'');
  const svg=useRef<SVGSVGElement>(null);
  const [hover,setHover]=useState<number|null>(null);
  const points=useMemo(()=>{
    const raw=dailyActivity(activityTimes(chats,files,sets),Date.now());
    // A light rolling blend so the line reads as a trend rather than a row of spikes.
    const days=raw.map((_,i)=>[-2,-1,0,1,2].reduce((sum,d)=>sum+(raw[i+d]??0)*[1,2,4,2,1][d+2],0)/10);
    // Square root keeps one busy day from flattening the rest of the month.
    const top=Math.sqrt(Math.max(...days,1));
    const span=W-PAD_X*2, rise=H-PAD_TOP-PAD_BOTTOM;
    return days.map((n,i)=>({x:PAD_X+span*i/(DAYS-1),y:H-PAD_BOTTOM-rise*Math.sqrt(n)/top}));
  },[chats,files,sets]);
  const line=smooth(points);
  const area=`${line}L${points[points.length-1].x} ${H}L${points[0].x} ${H}Z`;
  const end=points[points.length-1];
  const curve=useRef<SVGPathElement>(null);
  const at=hover===null?null:pointAt(curve.current,hover);
  const move=(e:React.PointerEvent)=>{
    const box=svg.current?.getBoundingClientRect();if(!box)return;
    setHover(Math.min(W-PAD_X,Math.max(PAD_X,(e.clientX-box.left)/box.width*W)));
  };

  return <figure className={`sp-activity tone-${tone} ${at?'scrubbing':''}`} onPointerMove={move} onPointerLeave={()=>setHover(null)}>
    <figcaption>Activity graph</figcaption>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Activity graph for the last 30 days">
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
        <mask id={`near-${id}`}><rect width={W} height={H} fill="#000"/>{at&&<circle cx={at.x} cy={H/2} r="46" fill={`url(#lens-${id})`}/>}</mask>
      </defs>
      <rect width={W} height={H} fill={`url(#grid-${id})`} className="grid"/>
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
