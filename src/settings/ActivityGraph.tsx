import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import './activity-graph.css';

const DAY=86_400_000, DAYS=30;
const PAD_X=8, PAD_TOP=8, PAD_BOTTOM=8, GRID=8;

/** The grid's dots, each with a start offset: a slow wave that sweeps left to right, with a little
 * scatter so it shimmers instead of marching. Each also carries its feathered-edge strength, so the grid
 * fades out toward the sides. */
function gridDots(W:number,H:number){
  const dots:{x:number;y:number;delay:number;edge:number}[]=[];
  for(let y=3;y<H;y+=GRID)for(let x=PAD_X%GRID+1;x<W;x+=GRID){
    const scatter=Math.abs(Math.sin(x*12.9898+y*78.233)*43758.5453)%1;
    const r=Math.hypot(x/W-.5,(y/H-.5)/1.6)/.62;
    dots.push({x,y,delay:7-(x/W)*4.2-(y/H)*1.1-scatter*1.2,edge:r<.55?1:Math.max(0,1-(r-.55)/.45)});
  }
  return dots;
}

const TWINKLE=7, LENS=46;
const ease=(t:number)=>t*t*(3-2*t);
/** Opacity and scale of a grid dot `t` seconds into its 7s twinkle (the keyframes the grid used to run in CSS). */
function twinkle(t:number):[number,number]{
  const p=((t%TWINKLE)+TWINKLE)%TWINKLE/TWINKLE;
  const keys:[number,number,number][]=[[0,.11,1],[.32,0,.4],[.58,.36,1.3],[.78,.14,1],[1,.11,1]];
  let i=0;while(p>keys[i+1][0])i++;
  const [a,oa,sa]=keys[i],[b,ob,sb]=keys[i+1],k=ease((p-a)/(b-a));
  return [oa+(ob-oa)*k,sa+(sb-sa)*k];
}
const quiet=()=>document.documentElement.dataset.quiet==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Paints the twinkling grid on one canvas instead of thousands of animated SVG circles. It runs at 30fps only while
 * the graph is on screen and the window is visible, and lights the dots near `lensX` while the pointer is over it. */
function useGridCanvas(canvas:React.RefObject<HTMLCanvasElement|null>,W:number,H:number,lensX:React.RefObject<number|null>,poke:React.RefObject<()=>void>){
  useEffect(()=>{
    const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    el.width=Math.round(W*dpr);el.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#fff';
    const dots=gridDots(W,H),start=performance.now();
    let frame=0,last=0,prev=0,lens=0,lx=W/2,onScreen=true;
    const draw=(now:number)=>{
      frame=0;
      const still=quiet(),target=lensX.current===null?0:1;
      if(lensX.current!==null)lx=lensX.current;
      // The lens fades in and out over about a quarter second, like the CSS transition it replaces.
      lens+=Math.sign(target-lens)*Math.min(Math.abs(target-lens),(now-(prev||now))/250);prev=now;
      if(!still&&now-last<32&&lens===target){frame=requestAnimationFrame(draw);return;}
      last=now;
      ctx.clearRect(0,0,W,H);
      const t=(now-start)/1000;
      for(const d of dots){
        const [o,sc]=still?[.12,1]:twinkle(t+d.delay);
        const near=lens?Math.max(0,1-Math.hypot(d.x-lx,d.y-H/2)/LENS)*.5*lens:0;
        const a=o*d.edge+near;if(a<.01)continue;
        ctx.globalAlpha=Math.min(1,a);
        ctx.beginPath();ctx.arc(d.x,d.y,.7*(near>o*d.edge?1:sc),0,Math.PI*2);ctx.fill();
      }
      if(onScreen&&!document.hidden&&(!still||lens!==target))frame=requestAnimationFrame(draw);
    };
    const wake=()=>{if(!frame&&onScreen&&!document.hidden){last=prev=0;frame=requestAnimationFrame(draw);}};
    poke.current=wake;
    const io=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([e])=>{onScreen=e.isIntersecting;if(onScreen)wake();});
    io?.observe(el);
    document.addEventListener('visibilitychange',wake);
    wake();
    return()=>{cancelAnimationFrame(frame);io?.disconnect();document.removeEventListener('visibilitychange',wake);poke.current=()=>{};};
  },[W,H]);
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
 * container's width (down to 240px). Moving over it slides the dot along the line under the pointer and shows
 * that day's count above it. The grid is a canvas (see useGridCanvas). The dot, guide and label are moved directly on each pointer event; React only
 * re-renders when the day under the pointer changes. */
export function ActivityGraph({times,label='Activity graph',unit='thread',height=56}:{times:number[];label?:string;unit?:string;height?:number}){
  const id=useId().replace(/:/g,'');
  const box=useRef<HTMLElement>(null),svg=useRef<SVGSVGElement>(null),canvas=useRef<HTMLCanvasElement>(null),dot=useRef<SVGGElement>(null),guide=useRef<SVGLineElement>(null),tip=useRef<HTMLDivElement>(null);
  const lensX=useRef<number|null>(null),poke=useRef<()=>void>(()=>{});
  const [W,setW]=useState(240);
  const H=height;
  useEffect(()=>{
    const el=box.current;if(!el||typeof ResizeObserver==='undefined')return;
    const ro=new ResizeObserver(([e])=>setW(Math.max(240,Math.round(e.contentRect.width))));
    ro.observe(el);return()=>ro.disconnect();
  },[]);
  const raw=useMemo(()=>dailyActivity(times,Date.now()),[times]);
  const points=useMemo(()=>{
    // A light rolling blend so the line reads as a trend rather than a row of spikes.
    const days=raw.map((_,i)=>[-2,-1,0,1,2].reduce((sum,d)=>sum+(raw[i+d]??0)*[1,2,4,2,1][d+2],0)/10);
    // Square root keeps one busy day from flattening the rest of the month.
    const top=Math.sqrt(Math.max(...days,1));
    const span=W-PAD_X*2, rise=H-PAD_TOP-PAD_BOTTOM;
    return days.map((n,i)=>({x:PAD_X+span*i/(DAYS-1),y:H-PAD_BOTTOM-rise*Math.sqrt(n)/top}));
  },[raw,W,H]);
  const {path:line,yAt}=useMemo(()=>monotone(points),[points]);
  const area=`${line}L${points[points.length-1].x} ${H}L${points[0].x} ${H}Z`;
  const end=points[points.length-1];
  useGridCanvas(canvas,W,H,lensX,poke);

  const [day,setDay]=useState<number|null>(null),shown=useRef<number|null>(null),lastX=useRef<number|null>(null);
  const place=(x:number|null)=>{
    const fig=box.current,el=svg.current;if(!fig||!el)return;
    lastX.current=x;
    if(lensX.current!==x){lensX.current=x;poke.current();}
    fig.classList.toggle('scrubbing',x!==null);
    const px=x??end.x,py=x===null?end.y:yAt(px);
    if(dot.current)dot.current.style.transform=`translate(${px}px,${py}px)`;
    if(x===null)return;
    guide.current?.setAttribute('x1',String(px));guide.current?.setAttribute('x2',String(px));
    // The label rides above the dot, kept inside the graph's width.
    const t=tip.current;if(t){const f=fig.getBoundingClientRect(),g=el.getBoundingClientRect(),k=g.width/W,half=t.offsetWidth/2,left=Math.min(Math.max(g.left-f.left+px*k,half),f.width-half),dotY=g.top-f.top+py*k,above=dotY-t.offsetHeight-12;
      // Above the dot when it fits inside the graph's box; otherwise just below it, so it never covers what sits over the graph.
      t.style.transform=`translate(${left-half}px,${above>=0?above:dotY+12}px)`;}
    const i=Math.round((px-PAD_X)/(W-PAD_X*2)*(DAYS-1));
    if(i!==shown.current){shown.current=i;setDay(i);}
  };
  const move=(e:React.PointerEvent)=>{
    const r=svg.current?.getBoundingClientRect();if(!r)return;
    place(Math.min(W-PAD_X,Math.max(PAD_X,(e.clientX-r.left)/r.width*W)));
  };
  const leave=()=>{shown.current=null;setDay(null);place(null);};
  // After each render (a new day's text, or a new line), put the dot and label back where they belong.
  useLayoutEffect(()=>{place(lastX.current);});

  const at=day===null?null:new Date(new Date().setHours(0,0,0,0)-(DAYS-1-day)*DAY);
  const count=day===null?0:raw[day];
  return <figure ref={box} className="activity-graph" onPointerMove={move} onPointerLeave={leave}>
    <figcaption>{label}</figcaption>
    <div className="ag-plot">
    <canvas ref={canvas} className="ag-grid" style={{width:W,height:H}} aria-hidden="true"/>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label} for the last 30 days`}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="fill-top"/><stop offset="1" className="fill-bottom"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#fill-${id})`} className="area"/>
      <path d={line} className="line" pathLength={1}/>
      <line ref={guide} x1={end.x} x2={end.x} y1={PAD_TOP-6} y2={H} className="guide"/>
      <g ref={dot} className="end" style={{transform:`translate(${end.x}px,${end.y}px)`}}>
        <circle r="7" className="halo"/>
        <circle r="3.2" className="core"/>
      </g>
    </svg>
    </div>
    <div ref={tip} className="ag-tip" aria-hidden="true">
      <span className="ag-tip-count"><b>{count}</b>{count===1?unit:unit+'s'}</span>
      <span className="ag-tip-day">{at?at.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}):''}</span>
    </div>
  </figure>;
}

/** A monotone cubic through the points (Fritsch–Carlson), so the curve never overshoots below zero or above a
 * peak. Each segment's handles sit a third of the way along in x, so x runs evenly along it and the height at
 * any x is found exactly: `yAt`. */
function monotone(p:{x:number;y:number}[]){
  const n=p.length,d=p.slice(1).map((q,i)=>(q.y-p[i].y)/(q.x-p[i].x));
  const m=p.map((_,i)=>i===0?d[0]:i===n-1?d[n-2]:d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2);
  for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=m[i+1]=0;continue;}const a=m[i]/d[i],b=m[i+1]/d[i],h=Math.hypot(a,b);if(h>3){m[i]=3*a/h*d[i];m[i+1]=3*b/h*d[i];}}
  const f=(v:number)=>v.toFixed(1);
  const path=p.reduce((out,q,i)=>{if(!i)return `M${f(q.x)} ${f(q.y)}`;const a=p[i-1],dx=(q.x-a.x)/3;return out+`C${f(a.x+dx)} ${f(a.y+m[i-1]*dx)} ${f(q.x-dx)} ${f(q.y-m[i]*dx)} ${f(q.x)} ${f(q.y)}`;},'');
  const yAt=(x:number)=>{
    const i=Math.min(n-2,Math.max(0,Math.floor((x-p[0].x)/(p[n-1].x-p[0].x)*(n-1))));
    const a=p[i],b=p[i+1],dx=(b.x-a.x)/3,t=Math.min(1,Math.max(0,(x-a.x)/(b.x-a.x))),u=1-t;
    return u*u*u*a.y+3*u*u*t*(a.y+m[i]*dx)+3*u*t*t*(b.y-m[i+1]*dx)+t*t*t*b.y;
  };
  return {path,yAt};
}
