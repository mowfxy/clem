/**
 * Mowr's illustrations: each scene is a small metaphor told in two or three things, drawn with an even ivory pen
 * line that wanders a little and leaves its ends open, set small in a lot of empty space. Colour sits on one small
 * element only (a keystone, a keyhole, a tab) and often carries a few thin lines of its own over it; everything else
 * is bare line.
 *
 * Every scene is a short loop animated pose to pose, like cel animation: it holds, then snaps to its next pose in a
 * few drawings with a small overshoot, and holds again, while the line boils on twos. Motion is cause and effect:
 * something moves, and the thing it reaches takes the colour (the shackle clicks shut and the keyhole fills, the lens
 * finds the gem). Each loop starts on its finished pose, so a single painted frame is always the complete drawing.
 */
export type Scene='balance'|'untangle'|'build'|'discover'|'learn'|'orchestrate'|'sprout'|'kite'|'telescope'|'pencil'|'bridge'|'conversation'|'envelope'|'key'|'door'|'swap'|'invite'|'keypad'|'shield'|'lock'|'unlock'|'link'|'unlink'|'plane'|'hourglass'|'box'|'jar'|'folder'|'plug'|'house'|'lifebuoy'|'profile'|'safe'|'expired'|'wave'|'cards'|'checklist'|'calendar'|'steps'|'bell'|'alarm';
/** How long each scene's loop runs, in seconds. A loop's first frame is its finished pose. */
export const loopSeconds:Readonly<Record<Scene,number>>={balance:5,untangle:5,build:5.5,discover:6,learn:5,orchestrate:7,sprout:6,kite:6,telescope:6,pencil:5.5,bridge:5.5,conversation:5,envelope:5,key:5,door:5.5,swap:5,invite:5,keypad:4.5,shield:5,lock:5,unlock:5,link:5,unlink:5,plane:5,hourglass:7,box:5,jar:5.5,folder:5,plug:5,house:5.5,lifebuoy:5,profile:5,safe:5,expired:5.5,wave:4,cards:5,checklist:5,calendar:5.5,steps:5.5,bell:5,alarm:5};
/** Scenes that move: all of them now, each on its own loop. */
export const animated:ReadonlySet<Scene>=new Set(Object.keys(loopSeconds) as Scene[]);
type P=[number,number];
type Style={fill?:string;w?:number;smooth?:boolean;closed?:boolean;opacity?:number;k?:number;holes?:P[][]};
const INK='currentColor',TAU=Math.PI*2,LINE=4.8,FINE=3.8,THIN=3;
// The palette: one of these per drawing, on one small element.
const BLUE='#6a9bcc',GREEN='#8fae8e',LILAC='#cbcadb',PINK='#c46686',SAND='#c8b48c',CLAY='#c27a5f';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const n=(v:number)=>v.toFixed(1);

// Frame state: the scene's time, where it is in its loop, a counter that gives each line its own hand, and which of
// three drawings the boiling line is on.
let T=0,U=0,seed=0,boil=0;

// ---------- timing ----------
/** Arrives with a small overshoot and settles, the snap at the end of a pose-to-pose move. */
const back=(x:number)=>{x=clamp(x);const c=1.5;return 1+(c+1)*(x-1)**3+c*(x-1)**2;};
/** Holds vals[0]; at each key time snaps to the next value over `dur` seconds, overshooting a touch. */
function pose(u:number,keys:number[],vals:number[],dur=.3){let v=vals[0];keys.forEach((k,i)=>{v+=(vals[i+1]-vals[i])*back((u-k)/dur);});return v;}
/** 0 before t0, then pops up to 1 with an overshoot: something appearing. */
const pop=(u:number,t0:number,dur=.3)=>u<t0?0:back((u-t0)/dur);

// ---------- the pen ----------
function spline(pts:P[],closed:boolean):P[]{const out:P[]=[],N=pts.length;if(N<3)return pts;for(let i=0;i<(closed?N:N-1);i++){const a=pts[closed?(i-1+N)%N:Math.max(0,i-1)],b=pts[i],c=pts[(i+1)%N],d=pts[closed?(i+2)%N:Math.min(N-1,i+2)];for(let j=0;j<8;j++){const t=j/8,t2=t*t,t3=t2*t;out.push([0,1].map(k=>.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3)) as P);}}if(!closed)out.push(pts[N-1]);return out;}
function densify(pts:P[],closed:boolean,step=8):P[]{const out:P[]=[];const N=pts.length;for(let i=0;i<(closed?N:N-1);i++){const a=pts[i],b=pts[(i+1)%N],steps=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let j=0;j<steps;j++)out.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);}if(!closed)out.push(pts[N-1]);return out;}
// The hand: a slow, low wander of about a pixel, different for every line. Moving scenes step it through three
// drawings, six times a second, so their line boils.
function hand(pts:P[],s:number):P[]{const f=s*2.39+boil*1.9,A=1.15;return pts.map(([x,y])=>[x+A*(.7*Math.sin(y*.031+f)+.3*Math.sin(y*.083+x*.021+f*1.7)),y+A*(.7*Math.sin(x*.029+f*1.3)+.3*Math.sin(x*.077-y*.019+f*2.1))]);}
const perimeter=(pts:P[])=>pts.reduce((sum,p,i)=>i?sum+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):0,0);
const svgPath=(pts:P[],close=false)=>'M'+pts.map(p=>n(p[0])+','+n(p[1])).join('L')+(close?'Z':'');
/** One element: a flat colour under it (optional), then the pen line. `k` below 1 draws the line on partway. */
function draw(pts:P[],{fill,w=LINE,smooth=false,closed=false,opacity=1,k=1,holes}:Style={}):string{
 if(k<=0||opacity<=.01||pts.length<2)return '';
 const s=seed++,trace=(p:P[])=>hand(smooth?spline(p,closed):densify(p,closed),s);
 const o=opacity<1?` opacity="${opacity.toFixed(3)}"`:'';
 let out='';
 const rings=[pts,...(holes||[])].map(trace);
 // The colour is laid in a hair off the line, the way a wash never quite meets the ink.
 if(fill&&closed)out+=`<path d="${rings.map(r=>svgPath(r.map(([x,y])=>[x+.9,y+.7] as P),true)).join('')}" fill="${fill}" fill-rule="evenodd"${k<1?` fill-opacity="${k.toFixed(3)}"`:''}${o}/>`;
 for(const ring of w?rings:[]){
  let line=ring;
  if(closed&&ring.length>4){
   // A closed shape is one stroke that starts somewhere along it, drifts a touch and just meets its start again.
   const L=ring.length,start=Math.floor(((s*0.618)%1)*L),r=[...ring.slice(start),...ring.slice(0,start)];
   const a=s*1.7,len=perimeter(ring),dx=Math.cos(a)*1.4,dy=Math.sin(a)*1.4,over=len>160?Math.ceil(L*5/len):0;
   line=[...r,...r.slice(0,over+1)].map(([x,y],i)=>[x+dx*i/L,y+dy*i/L] as P);
  }
  const on=k<1?` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1-k).toFixed(3)}"`:'';
  out+=`<path d="${svgPath(line)}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${on}${o}/>`;
 }
 return out;
}
const line=(pts:P[],s:Style={})=>draw(pts,s);
const curve=(pts:P[],s:Style={})=>draw(pts,{smooth:true,...s});
const shape=(pts:P[],s:Style={})=>draw(pts,{closed:true,...s});
const blob=(pts:P[],s:Style={})=>draw(pts,{closed:true,smooth:true,...s});

// ---------- geometry ----------
const arc=(cx:number,cy:number,rx:number,ry:number,a0:number,a1:number,steps=36):P[]=>Array.from({length:steps+1},(_,i)=>{const a=a0+(a1-a0)*i/steps;return [cx+Math.cos(a)*rx,cy+Math.sin(a)*ry] as P;});
const ellipse=(cx:number,cy:number,rx:number,ry=rx):P[]=>arc(cx,cy,rx,ry,0,TAU,40).slice(0,-1);
function rounded(x:number,y:number,w:number,h:number,r:number):P[]{r=Math.min(r,w/2,h/2);return [...arc(x+w-r,y+r,r,r,-Math.PI/2,0,6),...arc(x+w-r,y+h-r,r,r,0,Math.PI/2,6),...arc(x+r,y+h-r,r,r,Math.PI/2,Math.PI,6),...arc(x+r,y+r,r,r,Math.PI,Math.PI*1.5,6)];}
type Move={x?:number;y?:number;r?:number;s?:number;sx?:number;sy?:number;ox?:number;oy?:number};
/** Scales and turns points about (ox,oy), then moves them. */
function X(pts:P[],{x=0,y=0,r=0,s=1,sx=s,sy=s,ox=240,oy=200}:Move):P[]{const c=Math.cos(r),si=Math.sin(r);return pts.map(([px,py])=>{const dx=(px-ox)*sx,dy=(py-oy)*sy;return [ox+dx*c-dy*si+x,oy+dx*si+dy*c+y];});}
const pill=(cx:number,cy:number,len:number,h:number,a=0)=>X(rounded(cx-len/2,cy-h/2,len,h,h/2),{r:a,ox:cx,oy:cy});
function gear(cx:number,cy:number,r:number,teeth:number,a:number):P[]{const out:P[]=[];for(let i=0;i<teeth;i++){const b=a+i*TAU/teeth,s=TAU/teeth;for(const [f,rr] of [[0,r*.8],[.18,r*.8],[.3,r],[.7,r],[.82,r*.8]] as const)out.push([cx+Math.cos(b+s*f)*rr,cy+Math.sin(b+s*f)*rr]);}return out;}
/** A pointed leaf from its base to its tip. */
function leaf(b:P,t:P,w:number):P[]{const dx=t[0]-b[0],dy=t[1]-b[1],l=Math.hypot(dx,dy),px=-dy/l*w,py=dx/l*w,out:P[]=[];for(let i=0;i<=12;i++){const u=i/12,h=Math.sin(Math.PI*u)**.8;out.push([b[0]+dx*u+px*h,b[1]+dy*u+py*h]);}for(let i=11;i>0;i--){const u=i/12,h=Math.sin(Math.PI*u)**.8;out.push([b[0]+dx*u-px*h*.85,b[1]+dy*u-py*h*.85]);}return out;}
const inside=(poly:P[],[x,y]:P)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
/** The parts of the segment a–b that fall inside the polygon, each pulled in a hair from the edge. */
function clipSeg(poly:P[],a:P,b:P):[P,P][]{
 const ts=[0,1],dx=b[0]-a[0],dy=b[1]-a[1];
 poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length],ex=q[0]-p[0],ey=q[1]-p[1],den=dx*ey-dy*ex;if(Math.abs(den)<1e-9)return;const t=((p[0]-a[0])*ey-(p[1]-a[1])*ex)/den,u=((p[0]-a[0])*dy-(p[1]-a[1])*dx)/den;if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);});
 ts.sort((m,k)=>m-k);const len=Math.hypot(dx,dy),pad=1.6/len,out:[P,P][]=[];
 for(let i=0;i<ts.length-1;i++){const m=(ts[i]+ts[i+1])/2;if(ts[i+1]-ts[i]>pad*3&&inside(poly,[a[0]+dx*m,a[1]+dy*m])){const t0=ts[i]+(ts[i]>0?pad:0),t1=ts[i+1]-(ts[i+1]<1?pad:0);out.push([[a[0]+dx*t0,a[1]+dy*t0],[a[0]+dx*t1,a[1]+dy*t1]]);}}
 return out;
}
/** Thin parallel lines over a coloured shape, at angle `a`, `gap` apart, in the pen's fine line. */
function stripes(poly:P[],a:number,gap:number,w=THIN):string{
 const cx=poly.reduce((s,p)=>s+p[0],0)/poly.length,cy=poly.reduce((s,p)=>s+p[1],0)/poly.length;
 const R=Math.max(...poly.map(p=>Math.hypot(p[0]-cx,p[1]-cy)))+4,ux=Math.cos(a),uy=Math.sin(a),vx=-uy,vy=ux;
 let s='';for(let o=-Math.floor(R/gap)*gap+gap/2*((Math.floor(R/gap)%2)?1:0);o<=R;o+=gap)for(const [p,q] of clipSeg(poly,[cx+vx*o-ux*R,cy+vy*o-uy*R],[cx+vx*o+ux*R,cy+vy*o+uy*R]))s+=line([p,q],{w});
 return s;
}
/** The parts of a closed outline that fall outside the given shapes: what shows of something lying behind them. */
function behind(outline:P[],covers:P[][],s:Style={}):string{
 const pts=densify(outline,true,4),runs:P[][]=[];let run:P[]=[];
 const hidden=(p:P)=>covers.some(c=>inside(c,p));
 pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],m:P=[(p[0]+q[0])/2,(p[1]+q[1])/2];if(hidden(m)){if(run.length>1)runs.push(run);run=[];}else{if(!run.length)run.push(p);run.push(q);}});
 if(run.length>1){if(runs.length&&!hidden(pts[0])&&runs[0][0]===pts[0])runs[0]=[...run,...runs[0].slice(1)];else runs.push(run);}
 return runs.map(r=>line(r,s)).join('');
}
/** A point part way along a polyline, by length. */
function along(pts:P[],k:number):P{let d=clamp(k)*perimeter(pts);for(let i=1;i<pts.length;i++){const s=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(d<=s){const t=s?d/s:0;return [lerp(pts[i-1][0],pts[i][0],t),lerp(pts[i-1][1],pts[i][1],t)];}d-=s;}return pts[pts.length-1];}
/** The end of a segment pulled back by `by`, so a line stops short of whatever sits at its end. */
const short=(a:P,b:P,by:number):P=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return [b[0]-(b[0]-a[0])/l*by,b[1]-(b[1]-a[1])/l*by];};

// ---------- small marks ----------
/** A small open circle: the end of a line, a bead. */
const ring=(cx:number,cy:number,r:number,s:Style={})=>shape(ellipse(cx,cy,r),{w:FINE,...s});
const wavy=(y:number,x0:number,x1:number,ph=0,amp=4)=>curve(Array.from({length:9},(_,i)=>[x0+(x1-x0)*i/8,y+Math.sin(i*1.3+ph)*amp] as P),{w:FINE});

// ---------- scenes ----------
function balance(){
 // A ring and a square level on a beam. The square is lifted off and the ring's end drops; it is set back and the beam levels.
 const tilt=pose(U,[2.3,3.5],[0,-.13,0]),lift=pose(U,[2.2,3.4],[0,-90,0],.32);
 const b=(pts:P[])=>X(pts,{r:tilt,ox:240,oy:200});
 const fulcrum:P[]=[[240,204],[268,256],[212,256]];
 let s=shape(fulcrum,{fill:BLUE})+stripes(fulcrum,0,16);
 s+=line(b([[136,201],[344,199]]));
 const [rc]=b([[178,177]]);s+=ring(rc[0],rc[1],22,{w:LINE});
 if(lift>-60)s+=shape(X(b(rounded(288,157,42,42,5)),{y:lift}));
 return s;
}
function untangle(){
 // A snarled thread is pulled straight through its bead in two tugs, held, then let go so it snarls again.
 const A=pose(U,[2.3,2.9,4.2],[1,.45,0,1]);
 const pts:P[]=[];
 for(let i=0;i<=120;i++){const t=i/120*TAU*2.5,b=(40*(1-i/120)**1.2+1)*A;pts.push([150+t*8.3-b*Math.sin(t)*.95,204-b*(1-Math.cos(t))*.8]);}
 let s=ring(143,204,6)+curve(pts.filter((_,i)=>i%3===0||i===120),{w:FINE});
 const bead=ellipse(300,204,15);
 s+=line([pts[120],[284,204]],{w:FINE})+shape(bead,{fill:PINK})+stripes(bead,Math.PI/2,10);
 return s+line([[316,204],[344,204]],{w:FINE})+ring(351,204,6);
}
function build(){
 // Two blocks and a roof. The top two are cleared away, then dropped back on, one after the other.
 const gone=U>=2.6,yU=gone?-90*(1-pop(U,3.4)):0,yR=gone?-90*(1-pop(U,4.0)):0;
 let s=line([[150,300],[330,300]],{w:FINE})+shape(rounded(194,224,92,76,6));
 const upper=(pts:P[],y:number)=>X(X(pts,{r:-.07,ox:236,oy:224}),{y});
 if(!gone||U>=3.4)s+=shape(upper(rounded(204,166,64,58,6),yU));
 if(!gone||U>=4.0){const roof=upper([[236,118],[268,164],[204,164]],yR);s+=shape(roof,{fill:CLAY})+stripes(roof,-.07,15);}
 return s;
}
function discover(){
 // A magnifier looks in two empty places, then comes back to the gem, which takes its colour as the lens arrives.
 const keys=[2.4,3.3,4.3],dx=pose(U,keys,[0,-80,58,0]),dy=pose(U,keys,[0,30,-70,0]);
 const found=Math.hypot(dx,dy)<6;
 const gem:P[]=[[222,182],[246,182],[256,193],[234,218],[212,193]];
 let s=shape(gem,{fill:found?BLUE:undefined});
 s+=line([[214,193],[254,193]],{w:THIN})+line([[228,194],[234,214]],{w:THIN})+line([[241,194],[235,214]],{w:THIN});
 const c:P=[234+dx,198+dy],r=48,e=r*Math.SQRT1_2;
 s+=shape(ellipse(c[0],c[1],r));
 return s+shape(pill(c[0]+e+26,c[1]+e+26,56,19,Math.PI/4));
}
function learn(){
 // An open book; a page lifts and turns over to the left, and the ribbon flicks.
 let s=blob([[240,148],[208,134],[166,134],[146,142],[146,256],[176,250],[212,254],[240,266]]);
 s+=blob([[240,148],[272,134],[314,134],[334,142],[334,256],[304,250],[268,254],[240,266]]);
 s+=line([[240,150],[240,264]],{w:FINE});
 s+=line([[166,170],[218,168]],{w:FINE})+line([[166,194],[206,193]],{w:FINE});
 if(U>2.35&&U<3.4){
  const w=pose(U,[2.4,2.7,3.0],[94,34,-34,-94],.25),lift=(1-Math.abs(w)/94)*16;
  if(Math.abs(w)<90)s+=blob([[240,148],[240+w*.55,136-lift],[240+w,140-lift*.6],[240+w,254-lift*.6],[240+w*.55,250-lift],[240,266]],{w:FINE});
 }
 const flick=pose(U,[2.6,3.0],[0,.28,0],.25);
 return s+shape(X([[278,256],[278,302],[287,292],[296,302],[296,254]],{r:flick,ox:287,oy:256}),{fill:PINK,w:FINE});
}
function orchestrate(){
 // Two gears in mesh, ticking round a tooth at a time; the small one in colour with its spokes over it.
 const k=T/.7,b0=Math.floor(k),a=(b0+back((k-b0)/.35))*TAU/10;
 const r1=60,r2=36,d=.92*(r1+r2),th=-.62;
 const c1:P=[208,214],c2:P=[c1[0]+Math.cos(th)*d,c1[1]+Math.sin(th)*d];
 const a2=-a*r1/r2+th+Math.PI;
 let s=shape(gear(c2[0],c2[1],r2,6,a2),{fill:LILAC});
 for(let i=0;i<3;i++){const b=a2+i*TAU/3+Math.PI/6;s+=line([[c2[0]+Math.cos(b)*9,c2[1]+Math.sin(b)*9],[c2[0]+Math.cos(b)*24,c2[1]+Math.sin(b)*24]],{w:THIN});}
 s+=ring(c2[0],c2[1],6,{w:THIN});
 return s+shape(gear(c1[0],c1[1],r1,10,a+th-.5*TAU/10))+ring(c1[0],c1[1],12);
}
function sprout(){
 // A seedling sways left and right; then it grows again from the soil, stem first, a bare leaf, then the green one.
 const grow=U>=3.2,g=grow?pose(U,[3.4,3.9],[.15,.55,1]):1;
 const sway=grow?0:pose(U,[.8,1.8,2.6],[0,.07,-.05,0],.35);
 const small=grow?pop(U,3.7):1,big=grow?pop(U,4.2):1;
 const m=(pts:P[])=>X(pts,{r:sway,ox:240,oy:290});
 let s=curve([[176,292],[208,284],[272,284],[304,292]],{w:FINE});
 s+=curve(m([[240,286],[236,246],[244,200],[240,164]]),{k:clamp(g)});
 if(small>.05)s+=shape(m(X(leaf([238,236],[184,206],15),{s:small,ox:238,oy:236})),{w:FINE});
 if(big>.05){const leafPts=m(X(leaf([241,196],[312,150],24),{s:big,ox:241,oy:196}));s+=shape(leafPts,{fill:GREEN});const [b0,b1]=m(X([[244,194],[296,161]],{s:big,ox:241,oy:196}));s+=line([b0,b1],{w:THIN});}
 return s;
}
function kite(){
 // A small delta kite caught by gusts: it holds, jumps to a new lean, holds again; the string follows to its ring.
 const ks=[1.2,2.4,3.6,4.8];
 const cx=286+pose(U,ks,[0,14,-8,10,0],.35),cy=124+pose(U,ks,[0,-10,6,-4,0],.35),tilt=pose(U,ks,[.12,.26,-.02,.2,.12],.35);
 const k=(pts:P[])=>X(pts,{x:cx-286,y:cy-124,r:tilt,ox:286,oy:124});
 const body=k([[286,76],[330,150],[288,138],[244,150]]);
 let s=shape(body,{fill:CLAY});
 for(const [p,q] of [...clipSeg(body,k([[286,76]])[0],k([[287,140]])[0]),...clipSeg(body,k([[256,124]])[0],k([[316,124]])[0])])s+=line([p,q],{w:THIN});
 const [st]=k([[287,140]]);
 s+=curve([st,[lerp(st[0],252,.3),st[1]+40],[252,234],[214,246],[204,224],[226,214],[236,240],[206,280],[164,302]],{w:FINE});
 return s+ring(157,305,6);
}
function telescope(){
 // A telescope looks low, then too high, then finds the moon, which lights up.
 const aim=pose(U,[2.4,3.2,4.2],[0,.34,-.34,0]),found=Math.abs(aim)<.02;
 const t=(pts:P[])=>X(pts,{r:aim,ox:234,oy:212});
 const a=-.5;
 let s=shape(t(pill(226,196,132,28,a)));
 s+=shape(t(X(rounded(278,152,16,44,5),{r:a,ox:286,oy:174})))+shape(t(X(rounded(152,222,14,22,4),{r:a,ox:159,oy:233})));
 for(const f of [[188,304],[282,304],[240,310]] as P[])s+=line([[234,212],f]);
 // The moon: a crescent cut from one circle by another.
 const c:P=[338,98],r=22,o:P=[9,-7],r2=19,d=Math.hypot(...o),phi=Math.atan2(o[1],o[0]);
 const al=Math.acos((r*r+d*d-r2*r2)/(2*r*d)),ga=Math.acos((r2*r2+d*d-r*r)/(2*r2*d));
 const outer=arc(c[0],c[1],r,r,phi+al,phi+TAU-al,30);let inner=arc(c[0]+o[0],c[1]+o[1],r2,r2,phi+Math.PI-ga,phi+Math.PI+ga,20);
 const last=outer[outer.length-1];if(Math.hypot(inner[0][0]-last[0],inner[0][1]-last[1])>Math.hypot(inner[inner.length-1][0]-last[0],inner[inner.length-1][1]-last[1]))inner=inner.reverse();
 return s+shape([...outer,...inner.slice(1,-1)],{fill:found?SAND:undefined,w:FINE});
}
function pencil(){
 // A pencil writes a word in four strokes, rests at the end of it, and starts over.
 const writing:P[]=[[110,262],[132,250],[150,232],[146,218],[136,230],[146,252],[170,250],[186,226],[180,214],[170,228],[180,250],[204,248],[216,240]];
 const path=spline(writing,false);
 const k=U<2.5?1:clamp(pose(U,[2.8,3.3,3.8,4.3],[0,.3,.55,.8,1],.28));
 const tip=along(path,k);
 const body=(pts:P[])=>X(pts,{r:-.72,ox:0,oy:0,x:tip[0]+12,y:tip[1]-2});
 let s=k>.01?curve(writing,{w:FINE,k}):'';
 s+=shape(body([[30,-13],[150,-13],[150,13],[30,13]]));
 s+=shape(body([[30,-13],[0,0],[30,13]]))+shape(body([[9,-4],[0,0],[9,4]]),{fill:INK,w:0});
 s+=shape(body([[150,-13],[160,-13],[160,13],[150,13]]),{w:FINE});
 return s+shape(body([[160,-13],[182,-13],[186,-8],[186,8],[182,13],[160,13]]),{fill:PINK});
}
function bridge(){
 // The keystone is lifted out of the arch, held, and dropped back into place.
 const c:P=[240,276],rx=92,ry=58,deck=184,top=c[1]-ry,ky=pose(U,[2.6,3.8],[0,-64,0],.32);
 const key=X([[225,deck],[255,deck],[249,top+2],[231,top+2]],{y:ky});
 const off=Math.asin(10/rx);
 let s=line([[124,276],[148,276]],{w:FINE})+line([[332,276],[356,276]],{w:FINE});
 s+=line([[136,deck],[226,deck]])+line([[254,deck],[344,deck]]);
 s+=line(arc(c[0],c[1],rx,ry,Math.PI,Math.PI*1.5-off,18))+line(arc(c[0],c[1],rx,ry,Math.PI*1.5+off,TAU,18));
 s+=shape(key,{fill:GREEN})+stripes(key,Math.PI/2,10);
 return s+wavy(298,196,284,0,3);
}
function conversation(){
 // A question, and a small reply that pops up and types: its three dots rise in turn.
 let s=shape(rounded(130,104,152,82,26))+line([[156,186],[146,212],[178,186]]);
 s+=line([[158,134],[252,134]],{w:FINE})+line([[158,158],[220,158]],{w:FINE});
 const sc=U<3?1:pop(U,3.4);
 if(sc>.05){
  const r=(pts:P[])=>X(pts,{s:sc,ox:336,oy:262});
  s+=shape(r(rounded(234,204,116,58,24)),{fill:LILAC})+line(r([[318,262],[338,282],[332,260]]));
  if(sc>.9){const hop=Math.floor(T*5)%5;for(let i=0;i<3;i++)s+=shape(ellipse(268+i*24,233-(hop===i?6:0),4.6),{fill:INK,w:0});}
 }
 return s;
}
function envelope(){
 // A sealed envelope: the seal lifts away and the flap opens; the flap closes and the seal is stamped back on.
 const e=(pts:P[])=>X(pts,{r:-.05,ox:240,oy:200});
 const apex=pose(U,[2.6,3.6],[199,84,199]),sealS=U<2.6?1:pop(U,3.9,.25),sealed=sealS>.05;
 const tip:P=[240,apex];
 let s=shape(e(rounded(150,138,180,124,10)));
 for(const corner of [[152,142],[328,142]] as P[])s+=line(e([corner,sealed?short(corner,tip,14):tip]));
 if(sealed){const seal=e(X(ellipse(240,206,14),{s:sealS,ox:240,oy:206}));s+=shape(seal,{fill:PINK})+curve(e(X([[233,207],[240,201],[247,207]],{s:sealS,ox:240,oy:206})),{w:THIN});}
 return s;
}
function key(){
 // A key turns over in a lock and back, its tag swinging a beat behind.
 const turn=pose(U,[2.4,3.4],[0,1,0],.35),c=Math.cos(Math.PI*turn),sq=Math.max(.12,Math.abs(c));
 const k=(pts:P[])=>X(pts,{r:-.32,ox:196,oy:184});
 let s=shape(k(ellipse(196,184,30,30*sq)),{holes:[k(ellipse(196,184,9,9*sq))]});
 s+=line(k([[226,184],[344,184]]))+line(k([[310,184],[310,184+28*c]]))+line(k([[332,184],[332,184+20*c]]));
 const [knot]=k([[184,184+27*sq]]),swing=pose(U,[2.5,3.5],[.22,-.12,.22],.4);
 const top:P=[knot[0]-22,knot[1]+34],t=(pts:P[])=>X(pts,{r:swing,ox:158,oy:244,x:top[0]-158,y:top[1]-244});
 s+=curve([knot,[knot[0]-12,knot[1]+16],t([[158,244]])[0]],{w:FINE});
 return s+shape(t(rounded(138,244,40,54,8)),{fill:SAND})+ring(...t([[158,256]])[0],4,{w:THIN})+line(t([[148,276],[168,276]]),{w:THIN});
}
function door(){
 // A door ajar: it shuts, the light goes; it swings wide, and settles back ajar with its sliver of light.
 const ex=pose(U,[2.4,3.4,4.4],[276,295,250,276]),d=(298-ex)/22*8,top=108+d,bot=298-d;
 let s='';
 if(ex<292)s+=shape([[ex,top],[298,108],[298,298],[ex,bot]],{fill:SAND,w:0});
 s+=line([[136,298],[344,298]],{w:FINE})+line([[182,298],[182,108],[298,108],[298,298]]);
 s+=shape([[182,108],[ex,top],[ex,bot],[182,298]]);
 return s+ring(ex-18,206,5);
}
function swap(){
 // A circle and a square trade places, each along its own arrow, and later trade back.
 const L:P=[174,200],R:P=[304,200],go=pose(U,[2.4],[0,1],.45),ret=pose(U,[3.8],[0,1],.45);
 const pos=(from:P,to:P,t:number,h:number):P=>[lerp(from[0],to[0],t),lerp(from[1],to[1],t)+h*Math.sin(Math.PI*clamp(t))];
 // Going, the circle rides the top arrow to the right and the square the bottom one to the left; coming back, the other way round.
 const circle=U<3.8?pos(L,R,go,-30):pos(R,L,ret,30),square=U<3.8?pos(R,L,go,30):pos(L,R,ret,-30);
 const sq=rounded(square[0]-26,square[1]-26,52,52,6);
 let s=ring(circle[0],circle[1],26,{w:LINE})+shape(sq,{fill:BLUE})+stripes(sq,Math.PI/4,17);
 s+=curve([[180,160],[240,126],[296,160]])+line([[280,158],[298,162],[300,144]]);
 return s+curve([[300,242],[240,276],[178,242]])+line([[196,244],[178,240],[176,258]]);
}
function invite(){
 // A card sinks into its envelope, then rises out again.
 const v=(x:number)=>190+50*(1-Math.abs(x-240)/80),dy=pose(U,[2.6,3.4],[0,74,0]),top=136+dy;
 let s='';
 if(top<204){
  s+=shape([[200,v(200)],[200,top],[280,top],[280,v(280)],[240,240]],{fill:LILAC});
  for(const [y,x1] of [[160,262],[180,246]] as const)if(y+dy<200)s+=line([[216,y+dy],[x1,y+dy]],{w:THIN});
 }
 s+=line([[200,190],[160,190],[160,294],[320,294],[320,190],[280,190]]);
 return s+line([[162,192],[240,240],[318,192]]);
}
function keypad(){
 // A code is typed: the colour hops from key to key, each one pressing in as it lights.
 const seq=[4,0,8,2,4],keys=[1.0,1.5,2.0,2.5];
 const i=keys.filter(k=>U>=k).length,lit=seq[i],press=i?.8+.2*pop(U,keys[i-1]+.04,.22):1;
 let s=shape(rounded(184,92,112,208,22))+line([[226,114],[254,114]],{w:FINE});
 for(let r=0;r<3;r++)for(let c=0;c<3;c++){const x=212+c*28,y=166+r*32;s+=r*3+c===lit?shape(ellipse(x,y,10*press),{fill:GREEN,w:FINE}):ring(x,y,10);}
 return s+line([[226,276],[254,276]],{w:FINE});
}
function shield(){
 // A shield: the boss pops away, comes back in colour, and the tick is drawn on over it.
 let s=draw([[240,104],[276,118],[310,122],[308,186],[286,244],[240,292],[194,244],[172,186],[170,122],[204,118]],{closed:true,smooth:true});
 const bs=U<2.8?1:pop(U,3.4),tk=U<2.8?1:clamp(pose(U,[3.8,4.0],[0,.5,1],.2));
 if(bs>.05)s+=shape(X(ellipse(240,186,22),{s:bs,ox:240,oy:186}),{fill:BLUE});
 if(bs>.9&&tk>.02)s+=line([[229,187],[237,195],[252,178]],{w:THIN,k:tk});
 return s;
}
function padlock(o:number,colour:string,on:boolean){
 const shackle=X([[206,184],...arc(240,150,34,34,Math.PI,TAU,20),[274,184]],{y:-24*o});
 let s=line(X(shackle,{r:-.36*o,ox:206,oy:184}))+shape(rounded(184,184,112,96,14));
 return s+shape(ellipse(240,226,14),{fill:on?colour:undefined})+line([[240,224],[240,236]],{w:THIN})+shape(ellipse(240,221,3.2),{fill:INK,w:0});
}
// The shackle clicks shut and the keyhole fills; unlocking is the same click the other way.
function lock(){return padlock(pose(U,[2.4,3.6],[0,1,0]),SAND,U<2.4||U>=3.75);}
function unlock(){return padlock(pose(U,[2.4,3.6],[1,0,1]),GREEN,U<2.4||U>=3.75);}
function links(gap:number){
 // Two rings: overlapping, the part they share is in colour; pulled apart, that shared part splits between them.
 const R=46,h=28,th=Math.acos(h/R);
 const g=(pts:P[])=>X(pts,{r:-.28,ox:240,oy:198});
 const a:P=[212-gap,198],b:P=[268+gap,198];
 let s='';
 if(Math.abs(gap)<2){
  const lens=g([...arc(a[0],a[1],R,R,-th,th,14),...arc(b[0],b[1],R,R,Math.PI-th,Math.PI+th,14).slice(1,-1)]);
  s+=shape(lens,{fill:LILAC,w:0})+stripes(lens,-.28+Math.PI/2,9);
 }else if(gap>27)s+=shape(g(arc(a[0],a[1],R,R,-th,th,14)),{fill:LILAC})+shape(g(arc(b[0],b[1],R,R,Math.PI-th,Math.PI+th,14)),{fill:LILAC});
 return s+shape(g(ellipse(a[0],a[1],R)))+shape(g(ellipse(b[0],b[1],R)));
}
function link(){return links(pose(U,[2.4,3.6],[0,30,0],.35));}
function unlink(){return links(pose(U,[2.4,3.6],[30,0,30],.35));}
function plane(){
 // A paper plane rides the air in little jumps, its looping trail behind it.
 const ks=[1.2,2.4,3.6],ox=pose(U,ks,[0,8,-5,0],.35),oy=pose(U,ks,[0,-10,6,0],.35),r=pose(U,ks,[0,-.06,.05,0],.35);
 const p=(pts:P[])=>X(pts,{x:ox,y:oy,r,ox:270,oy:160});
 const [N,L,F,B]=p([[338,112],[210,150],[252,170],[270,210]]);
 let s=shape([N,L,F])+shape([N,F,B],{fill:BLUE});
 s+=curve([p([[240,182]])[0],[206+ox*.5,202+oy*.5],[178,236],[188,262],[212,250],[204,224],[170,246],[146,282],[132,296]],{w:FINE});
 return s+ring(126,301,6);
}
function hourglass(){
 // The sand runs down in ticks; when the top is empty the glass snaps over and it starts again.
 const run=clamp(pose(U,[.8,1.6,2.4,3.2,4.0,4.8],[0,1/6,2/6,3/6,4/6,5/6,1],.25)),flip=U<5.4?0:back((U-5.4)/.6);
 const g=(pts:P[])=>X(X(pts,{s:.78,ox:240,oy:200}),{r:flip*Math.PI,ox:240,oy:200});
 let s='';
 const top=Math.sqrt(1-run),bot=Math.sqrt(run);
 if(top>.06)s+=shape(g(X([[204,128],[276,128],[262,160],[240,186],[218,160]],{s:top,ox:240,oy:186})),{fill:SAND,w:FINE});
 if(bot>.06)s+=shape(g(X([[202,300],[214,276],[240,262],[266,276],[278,300]],{s:bot,ox:240,oy:300})),{fill:SAND,w:FINE});
 if(run<1&&flip===0)s+=line(g([[240,194],[240,lerp(258,294,1-bot)]]),{w:2.4});
 s+=curve(g([[190,100],[192,150],[232,198],[192,250],[190,300]]))+curve(g([[290,100],[288,150],[248,198],[288,250],[290,300]]));
 return s+line(g([[170,92],[310,92]]))+line(g([[170,308],[310,308]]));
}
function box(){
 // An open box folds its flaps shut, then they spring open again.
 const o=pose(U,[2.4,3.4],[1,0,1]);
 const flap=(h0:P,p1:P,p2:P,h3:P):P[]=>[h0,[lerp(h0[0],p1[0],o),lerp(h0[1],p1[1],o)],[lerp(h3[0],p2[0],o),lerp(h3[1],p2[1],o)],h3];
 let s='';
 if(o>.08)s+=shape(flap([176,200],[150,166],[214,166],[240,200]),{w:FINE})+shape(flap([240,200],[266,166],[330,166],[304,200]),{w:FINE});
 s+=shape([[176,200],[304,200],[304,292],[176,292]]);
 return s+shape(rounded(210,226,60,34,5),{fill:SAND})+line([[222,238],[256,238]],{w:THIN})+line([[222,249],[244,249]],{w:THIN});
}
function jar(){
 // The lid lifts, a bean drops in, the level rises, and the lid goes back on.
 const re=U>=2.4,fillTop=re?pose(U,[3.3],[272,254]):254,lid=pose(U,[2.4,3.8],[0,1,0]);
 const body=rounded(184,142,112,150,28),keep:P[]=[];
 body.forEach((p,i)=>{const q=body[(i+1)%body.length];if(p[1]>=fillTop)keep.push(p);if((p[1]-fillTop)*(q[1]-fillTop)<0){const t=(fillTop-p[1])/(q[1]-p[1]);keep.push([p[0]+(q[0]-p[0])*t,fillTop]);}});
 let s=shape(X(keep,{s:.9,ox:240,oy:286}),{fill:GREEN,w:FINE})+wavy(fillTop+18,216,264,.6,2.5);
 if(U>=2.8&&U<3.3){const t=clamp((U-2.8)/.45);s+=shape(ellipse(240,lerp(112,fillTop-4,t*t),7,5),{w:THIN});}
 s+=shape(body)+shape(X(rounded(198,116,84,22,7),{x:36*lid,y:-34*lid,r:.35*lid,ox:282,oy:127}));
 return s;
}
function folder(){
 // A sheet rises out of the folder, held up for a moment, then slips back in.
 const sy=pose(U,[2.4,3.8],[0,1,0]),top=170-62*sy;
 const tab:P[]=[[160,146],[166,128],[212,128],[222,146]];
 const sheet:P[]=[[232,170],[232,top],[306,top],[306,170]];
 let s=shape(tab,{fill:BLUE})+line([[160,146],[160,170]]);
 if(sy>.05){
  s+=behind([[222,146],[320,146],[320,170],[222,170]],[sheet]);
  s+=line(sheet);
  for(const [y,x1] of [[top+18,286],[top+34,272]] as const)if(y<164)s+=line([[246,y],[x1,y]],{w:THIN});
 }else s+=line([[222,146],[320,146],[320,170]]);
 return s+shape([[152,170],[328,170],[318,284],[162,284]]);
}
function plug(){
 // A plug pulls out of the socket, then pushes home, and its collar lights up.
 const d=pose(U,[2.4,3.6],[0,24,0]),on=U<2.4||U>=3.75;
 let s=line([[196,104],[284,104]]);
 s+=line([[222,136+d],[222,106+d*.9]])+line([[258,136+d],[258,106+d*.9]]);
 s+=shape(rounded(200,136+d,80,74,18));
 const collar=rounded(222,210+d,36,20,4);
 s+=shape(collar,{fill:on?LILAC:undefined})+(on?stripes(collar,Math.PI/2,9):'');
 s+=curve([[240,230+d],[240,258],[218,278],[180,276],[160,292]],{w:FINE});
 return s+ring(154,296,6);
}
function house(){
 // A small house: its door swings open, held, and shuts again.
 const c=pose(U,[2.4,3.8],[1,.22,1]);
 let s=shape([[164,206],[240,132],[316,206]])+line([[180,206],[180,292],[300,292],[300,206]]);
 if(c<.95)s+=line([[225,292],...arc(231,252,6,6,Math.PI,Math.PI*1.5,4),...arc(249,252,6,6,Math.PI*1.5,TAU,4),[255,292]],{w:FINE});
 s+=shape(rounded(225,246,30*c,46,Math.min(6,15*c)),{fill:CLAY})+shape(ellipse(225+30*c-6,270,2.6),{fill:INK,w:0});
 return s+ring(240,182,9);
}
function lifebuoy(){
 // A ring buoy bobbing on the water in little jumps.
 const ks=[1,2,3,4],dy=pose(U,ks,[0,-7,4,-4,0],.35),rot=pose(U,ks,[0,.12,-.08,.05,0],.35),ph=pose(U,ks,[0,1.3,2.6,1.3,0],.35);
 const cx=240,cy=188+dy,R=62,r=32,b=.3;
 let s='';
 for(const q of [Math.PI/4+rot,Math.PI*5/4+rot])s+=shape([...arc(cx,cy,R,R,q-b,q+b,8),...arc(cx,cy,r,r,q+b,q-b,8)],{fill:PINK,w:0});
 for(let i=0;i<4;i++){const q=Math.PI/4+i*Math.PI/2+rot;for(const f of [-b,b])s+=line([[cx+Math.cos(q+f)*r,cy+Math.sin(q+f)*r],[cx+Math.cos(q+f)*R,cy+Math.sin(q+f)*R]],{w:FINE});}
 return s+shape(ellipse(cx,cy,R))+shape(ellipse(cx,cy,r))+wavy(276,150,330,ph,4);
}
function profile(){
 // An ID card fills itself in: the portrait pops in, then its lines are written.
 const re=U>=2.8,as=re?pop(U,3.2):1,k1=re?clamp((U-3.7)/.25):1,k2=re?clamp((U-4.1)/.25):1;
 let s=shape(rounded(146,136,188,122,14));
 if(as>.05){const a=(pts:P[])=>X(pts,{s:as,ox:196,oy:196});s+=shape(a(ellipse(196,196,30)),{fill:LILAC})+shape(a(ellipse(196,186,9)),{w:THIN})+line(a(arc(196,218,16,12,Math.PI,TAU,10)),{w:THIN});}
 return s+line([[248,182],[306,182]],{w:FINE,k:k1})+line([[248,208],[288,208]],{w:FINE,k:k2});
}
function safe(){
 // A safe's dial spins left, right, left to its number; then the handle turns.
 const dial=pose(U,[1.4,2.0,2.6,3.2],[0,1.5,-.9,.7,0],.28),hd=pose(U,[3.6,4.4],[0,1,0]);
 let s=shape(rounded(168,120,144,140,14))+line([[186,260],[186,274]])+line([[294,260],[294,274]]);
 const a=-.86+dial;
 s+=shape(ellipse(228,190,22),{fill:SAND})+line([[228,190],[228+Math.cos(a)*18,190+Math.sin(a)*18]],{w:THIN})+shape(ellipse(228,190,3),{fill:INK,w:0});
 const h=Math.PI/2-hd*Math.PI/2;
 return s+line([[282-Math.cos(h)*18,190-Math.sin(h)*18],[282+Math.cos(h)*18,190+Math.sin(h)*18]]);
}
function expired(){
 // A clock ticks its last few steps to twelve, and the slice of time just gone turns pink.
 const cx=240,cy=196,R=62,edge=-Math.PI/2-.52,re=U>=2.4;
 const ang=re?edge+pose(U,[2.9,3.4,3.9],[0,.52/3,.52*2/3,.52],.25):-Math.PI/2,lit=!re||U>=4.0;
 let s='';
 if(lit)s+=shape([[cx,cy],...arc(cx,cy,50,50,edge,-Math.PI/2,10)],{fill:PINK,w:0})+line([[cx,cy],[cx+Math.cos(edge)*50,cy+Math.sin(edge)*50]],{w:THIN});
 s+=shape(ellipse(cx,cy,R));
 for(const a of [0,Math.PI/2,Math.PI])s+=line([[cx+Math.cos(a)*52,cy+Math.sin(a)*52],[cx+Math.cos(a)*58,cy+Math.sin(a)*58]],{w:FINE});
 s+=line([[cx,cy],[cx+Math.cos(ang)*50,cy+Math.sin(ang)*50]])+line([[cx,cy],[cx,cy-30]]);
 return s+ring(cx,cy,4,{fill:INK,w:2});
}
function wave(){
 // A hand raised to say hello, waving in three quick strokes.
 const r=pose(U,[1.4,1.75,2.1,2.45],[-.14,-.34,.04,-.3,-.14],.22);
 const h=(pts:P[])=>X(pts,{r,ox:248,oy:300});
 const finger=(l:number,rr:number,base:number,tip:number):P[]=>[[l,base],[l,tip+10],[l+2,tip+2],[(l+rr)/2,tip-1],[rr-2,tip+2],[rr,tip+10],[rr,base]];
 const outline:P[]=[[214,300],[208,262],[196,242],[176,222],[168,206],[176,198],[190,204],[210,224],...finger(210,232,212,136),...finger(234,256,206,122),...finger(258,280,210,132),...finger(282,302,222,156),[302,250],[296,276],[284,300]];
 const cuff=h(rounded(206,300,86,22,4));
 return curve(h(outline))+shape(cuff,{fill:BLUE})+stripes(cuff,r+Math.PI/2,19);
}
function cards(){
 // A small stack of cards: the front one slides out to show itself, then tucks back in.
 const o=pose(U,[2.4,3.6],[0,1,0],.32);
 const front=X(rounded(174,158,104,120,10),{x:-56*o,y:-6*o,r:-.1*o,ox:226,oy:218});
 const second=rounded(186,146,104,120,10),third=rounded(198,134,104,120,10);
 let s=behind(third,[front,second],{w:FINE})+behind(second,[front])+shape(front);
 const f=(pts:P[])=>X(pts,{x:-56*o,y:-6*o,r:-.1*o,ox:226,oy:218});
 s+=shape(f(rounded(190,174,26,26,5)),{fill:GREEN});
 return s+line(f([[226,182],[260,182]]),{w:FINE})+line(f([[190,226],[260,226]]),{w:FINE})+line(f([[190,248],[240,248]]),{w:FINE});
}
function checklist(){
 // A short list on a clipboard: the last box empties, a tick is drawn into it, and the box takes the colour.
 const re=U>=2.4,k=re?clamp((U-3.0)/.3):1,fillS=re?pop(U,3.35,.25):1;
 const clip=rounded(214,96,52,22,7);
 let s=behind(rounded(176,108,128,180,14),[clip])+shape(clip,{w:FINE});
 [150,196,242].forEach((y,i)=>{
  const box=rounded(198,y-12,24,24,5),last=i===2;
  s+=last&&fillS>.05?shape(X(box,{s:fillS,ox:210,oy:y}),{fill:GREEN,w:FINE}):shape(box,{w:FINE});
  if(!last||k>0)s+=line([[203,y],[209,y+6],[220,y-7]],{w:THIN,k:last?k:1});
  s+=line([[236,y],[i===1?266:284,y]],{w:FINE});
 });
 return s;
}
function calendar(){
 // A desk calendar: its page flips up over the binding and falls back, and the day that was marked takes the colour.
 const sy=pose(U,[2.4,3.3],[1,-.12,1],.34),lit=U<2.4||U>=3.55;
 const page=(pts:P[])=>X(pts,{sy,ox:240,oy:124});
 let s=line([[168,124],[196,124]])+line([[212,124],[268,124]])+line([[284,124],[312,124]]);
 if(Math.abs(sy)>.05){
  s+=line(page([[168,124],[168,276],[312,276],[312,124]]));
  s+=line(page([[184,152],[296,152]]),{w:THIN});
  for(let r=0;r<3;r++)for(let c=0;c<4;c++){
   const [p]=page([[198+c*28,182+r*30]]);
   if(r===1&&c===2){const day=page(rounded(242,201,24,22,5));s+=shape(day,{fill:lit?CLAY:undefined,w:FINE});}
   else s+=shape(X(ellipse(p[0],p[1],3.4),{sy:Math.max(.2,sy),ox:p[0],oy:p[1]}),{fill:INK,w:0});
  }
 }
 for(const x of [204,276])s+=shape(rounded(x-6,108,12,28,6),{w:FINE});
 return s;
}
function steps(){
 // Three steps with a flag on the top one: a bead hops up them one at a time, and the flag fills when it arrives.
 const at:P[]=[[184,241],[234,201],[272,161]];
 const hop=U<2.2?2:U<2.5?0:pose(U,[2.9,3.6],[0,1,2],.3),i=Math.min(1,Math.floor(hop)),t=hop-i;
 const appear=U<2.2?1:U<2.5?0:pop(U,2.5,.25),arrived=U<2.2||U>=3.85;
 const p:P=[lerp(at[i][0],at[i+1][0],t),lerp(at[i][1],at[i+1][1],t)-Math.sin(Math.PI*clamp(t))*22];
 let s=line([[150,290],[330,290]],{w:FINE});
 s+=line([[164,290],[164,250],[212,250],[212,210],[260,210],[260,170],[316,170],[316,290]]);
 s+=line([[298,170],[298,108]]);
 const flag:P[]=[[298,108],[336,119],[298,132]];
 s+=shape(flag,{fill:arrived?GREEN:undefined})+(arrived?stripes(flag,Math.PI/2,10):'');
 if(appear>.05)s+=shape(ellipse(p[0],p[1],8*appear),{fill:INK,w:0});
 return s;
}
function bell(){
 // A bell rings: it swings out and back in three strokes, its clapper a beat behind, and settles still.
 const r=pose(U,[2.2,2.55,2.9,3.25],[0,.32,-.26,.14,0],.22),lag=pose(U,[2.32,2.67,3.02,3.37],[0,-.3,.26,-.12,0],.22);
 const b=(pts:P[])=>X(pts,{r,ox:240,oy:122});
 let s=ring(...b([[240,122]])[0],8,{w:FINE});
 s+=curve(b([[192,252],[200,212],[204,170],[222,140],[240,134],[258,140],[276,170],[280,212],[288,252]]));
 s+=line(b([[178,256],[302,256]]));
 const [pivot]=b([[240,256]]),c:P=[pivot[0]+Math.sin(-lag)*20,pivot[1]+Math.cos(-lag)*20];
 s+=line([pivot,short(pivot,c,9)],{w:THIN});
 return s+shape(ellipse(c[0],c[1],10),{fill:SAND,w:FINE});
}
function alarm(){
 // An alarm clock goes off: it hops on its feet three times, then the striker between its bells lights up.
 const ks=[2.2,2.5,2.8,3.1],dy=pose(U,ks,[0,-12,0,-10,0],.16),tilt=pose(U,ks,[0,-.1,.08,-.06,0],.16),lit=U<2.2||U>=3.35;
 const a=(pts:P[])=>X(pts,{r:tilt,y:dy,ox:240,oy:290});
 let s=shape(a(ellipse(240,210,58)));
 for(const side of [-1,1]){
  // Each bell is a dome turned away from the face, closed by a flat rim toward it.
  const cx=240+side*50,cy=144,toward=Math.atan2(210-cy,240-cx);
  s+=shape(a(arc(cx,cy,21,21,toward+Math.PI/2,toward+Math.PI*1.5,16)),{w:FINE});
  s+=line(a([[240+side*40,262],[240+side*52,288]]),{w:FINE});
 }
 s+=line(a([[240,210],[240,172]]))+line(a([[240,210],[266,224]]),{w:FINE})+ring(...a([[240,210]])[0],4,{fill:INK,w:2});
 const striker=a(rounded(230,128,20,14,4));
 return s+line(a([[240,142],[240,151]]),{w:FINE})+shape(striker,{fill:lit?CLAY:undefined,w:FINE});
}
const scenes:Record<Scene,()=>string>={balance,untangle,build,discover,learn,orchestrate,sprout,kite,telescope,pencil,bridge,conversation,envelope,key,door,swap,invite,keypad,shield,lock,unlock,link,unlink,plane,hourglass,box,jar,folder,plug,house,lifebuoy,profile,safe,expired,wave,cards,checklist,calendar,steps,bell,alarm};
/** One frame of a scene as SVG markup for a 480×390 stage. At 0 seconds every scene shows its finished pose. */
export function filmFrame(scene:Scene,seconds:number,_id:string){
 T=Math.max(0,seconds);U=T%loopSeconds[scene];boil=Math.floor(T*6)%3;seed=0;
 return scenes[scene]();
}
