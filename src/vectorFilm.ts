/**
 * Mowr's illustrations: one simple object per scene, drawn with an even ivory line, flat grey fills and a few
 * small circles, and animated like a short film. Every frame is computed from time. From t=0 to 6 each scene plays
 * its own directed entrance (anticipation, overshoot, squash on landing, follow-through); from t=6 it runs a calm
 * loop in which something small happens every few seconds. A light line boil keeps the drawing hand-made.
 */
export type Scene='balance'|'untangle'|'build'|'discover'|'learn'|'orchestrate'|'sprout'|'kite'|'telescope'|'pencil'|'bridge'|'conversation'|'envelope'|'key'|'door'|'swap'|'invite'|'keypad'|'shield'|'lock'|'unlock'|'link'|'unlink'|'plane'|'hourglass'|'box'|'jar'|'folder'|'plug'|'house'|'lifebuoy'|'profile'|'safe'|'expired'|'wave';
type P=[number,number];
type Style={fill?:string;w?:number;smooth?:boolean;closed?:boolean;dash?:string;offset?:number;opacity?:number;k?:number};
const INK='#f3f2ec',GREY='#63635e',PAPER='#1a1a19',TAU=Math.PI*2,LINE=7;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{x=clamp(x);return x*x*(3-2*x)};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const n=(v:number)=>v.toFixed(1);

// Frame state: the scene's time and the boil clock (a still drawing passes its own).
let T=0,boil:number|null=null,seed=0;

// ---------- timing ----------
/** Eased 0→1 between two moments of the entrance. */
const at=(a:number,b:number)=>ease((T-a)/(b-a));
/** Linear 0→1 between two moments. */
const lin=(a:number,b:number)=>clamp((T-a)/(b-a));
/** Settles on 1 with an overshoot, from `t0`: a pop, a landing, a swing coming to rest. */
const spring=(t0:number,f=1.6,d=5.5,x=T-t0)=>x<=0?0:1-Math.exp(-d*x)*Math.cos(TAU*f*x);
/** A fall under gravity from `t0` that lands at `t1` (0 = start height, 1 = ground). */
const fall=(t0:number,t1:number)=>{const x=clamp((T-t0)/(t1-t0));return x*x;};
/** Time within the idle loop of `period` seconds, or -1 during the entrance. */
const loop=(period:number)=>T<6?-1:(T-6)%period;
/** Eased 0→1 across [a,b] of the loop. */
const win=(u:number,a:number,b:number)=>u<0?0:ease((u-a)/(b-a));
/** 0→1→0 across [a,b] (of the loop, or of the entrance when given T). */
const bump=(u:number,a:number,b:number)=>u<a||u>b?0:Math.sin(Math.PI*(u-a)/(b-a));
/** A dying wobble set off at `a`: starts at 0, swings to ±1 and settles. */
const shake=(u:number,a:number,f=1.8,d=3.2)=>u<a?0:Math.exp(-d*(u-a))*Math.sin(TAU*f*(u-a));
/** Squash `x` seconds after a landing: wider and shorter, then back. */
const squash=(x:number):[number,number]=>x<=0?[1,1]:[1+.16*Math.exp(-7*x)*Math.cos(TAU*2*x),1-.2*Math.exp(-7*x)*Math.cos(TAU*2*x)];
/** A slow breath after t=6, for things that should never freeze completely. */
const breathe=(speed=1,amp=1,phase=0)=>T>6?Math.sin((T-6)*speed+phase)*amp-Math.sin(phase)*amp:0;

// ---------- drawing ----------
function spline(pts:P[],closed:boolean):P[]{const out:P[]=[],N=pts.length;if(N<3)return pts;for(let i=0;i<(closed?N:N-1);i++){const a=pts[closed?(i-1+N)%N:Math.max(0,i-1)],b=pts[i],c=pts[(i+1)%N],d=pts[closed?(i+2)%N:Math.min(N-1,i+2)];for(let j=0;j<8;j++){const t=j/8,t2=t*t,t3=t2*t;out.push([0,1].map(k=>.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3)) as P);}}if(!closed)out.push(pts[N-1]);return out;}
function densify(pts:P[],closed:boolean):P[]{const out:P[]=[];const N=pts.length;for(let i=0;i<(closed?N:N-1);i++){const a=pts[i],b=pts[(i+1)%N],steps=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/24));for(let j=0;j<steps;j++)out.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);}if(!closed)out.push(pts[N-1]);return out;}
// The boil: a smooth, low field that shifts every point by under a pixel, stepping through four cels four times a second.
function wobble(pts:P[],s:number):P[]{const cel=Math.floor((boil??T)*4)%4;return pts.map(([x,y])=>[x+.9*Math.sin(y*.043+cel*1.9+s),y+.8*Math.sin(x*.039+cel*1.4+s*1.3)]);}
/** One element. `k` below 1 draws the line on partway; `opacity` fades it. */
function draw(pts:P[],{fill='none',w=LINE,smooth=false,closed=false,dash,offset=0,opacity=1,k=1}:Style={}):string{
 if(k<=0||opacity<=.01||pts.length<2)return '';
 const i=seed++,pts2=wobble(smooth?spline(pts,closed):densify(pts,closed),i);
 const d='M'+pts2.map(p=>n(p[0])+','+n(p[1])).join('L')+(closed?'Z':'');
 const on=k<1?` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1-k).toFixed(3)}"`:dash?` stroke-dasharray="${dash}" stroke-dashoffset="${offset.toFixed(1)}"`:'';
 const fillAlpha=fill!=='none'&&k<1?` fill-opacity="${k.toFixed(3)}"`:'';
 return `<path d="${d}" fill="${fill}"${fillAlpha} stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${on}${opacity<1?` opacity="${opacity.toFixed(3)}"`:''}/>`;
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
/** A point along a smooth path, 0→1. */
function along(pts:P[],f:number):P{const s=spline(pts,false),x=clamp(f)*(s.length-1),i=Math.min(s.length-2,Math.floor(x)),u=x-i;return [lerp(s[i][0],s[i+1][0],u),lerp(s[i][1],s[i+1][1],u)];}

// ---------- small effects ----------
const dot=(cx:number,cy:number,r:number,o=1)=>r>.3?shape(ellipse(cx,cy,r),{w:4.5,opacity:o}):'';
const bead=(cx:number,cy:number,r:number,o=1)=>r>.3?shape(ellipse(cx,cy,r),{fill:INK,w:2,opacity:o}):'';
/** A four-point glint; `s` scales it from nothing. */
const glint=(cx:number,cy:number,r:number,s=1,o=1)=>s<=.02?'':line([[cx,cy-r*s],[cx,cy+r*s]],{w:5,opacity:o})+line([[cx-r*s,cy],[cx+r*s,cy]],{w:5,opacity:o});
/** Short strokes flying out from a point, 0→1, over `spread` radians centred on `a0`. */
function burst(cx:number,cy:number,f:number,count=6,r0=18,r1=46,a0=-Math.PI/2,spread=TAU){if(f<=0||f>=1)return '';let s='';const full=spread>=TAU;for(let i=0;i<count;i++){const a=a0+(full?TAU*i/count:count===1?0:spread*(i/(count-1)-.5)),inner=lerp(r0,r1,ease(f)),outer=inner+14*(1-f);s+=line([[cx+Math.cos(a)*inner,cy+Math.sin(a)*inner],[cx+Math.cos(a)*outer,cy+Math.sin(a)*outer]],{w:5,opacity:1-f*f});}return s;}
/** A ring that grows and fades, 0→1. */
const ripple=(cx:number,cy:number,r0:number,r1:number,f:number)=>f<=0||f>=1?'':shape(ellipse(cx,cy,lerp(r0,r1,ease(f))),{w:4,opacity:(1-f)*.8});
const water=(y:number,x0:number,x1:number,ph:number,o:number,f:number)=>curve(Array.from({length:8},(_,i)=>[x0+(x1-x0)*i/7,y+Math.sin(i*1.3+f*1.5+ph)*3.5] as P),{w:5,opacity:o});

// ---------- scenes ----------
function sprout(){
 // A seed drops into the soil, a stem pushes up and two leaves unfurl. At rest a breeze passes now and then.
 const u=loop(7),gust=shake(u,1.2,1.1,1.6)*.9+breathe(1.2,.06);
 const soil=spring(0,1.4,6);let s=shape(X(arc(240,302,100,36,Math.PI,TAU,24),{sy:soil,sx:lerp(.6,1,soil),ox:240,oy:302}),{fill:PAPER});
 if(T>.3&&T<1.1)s+=shape(ellipse(240,lerp(40,292,fall(.3,1.05)),7,9),{fill:INK,w:3});
 s+=ripple(240,298,6,40,lin(1.05,1.6));
 const grow=at(1.1,2.3),tip:P=[240+gust*10,lerp(300,150,grow)];
 if(grow>0)s+=curve([[240,300],[237+gust,lerp(300,262,grow)],[243+gust*4,lerp(300,205,grow)],tip]);
 const leaf=(pts:P[],base:P,dir:number,t0:number)=>{const o=spring(t0,1.4,4.5);return o<=.02?'':blob(X(pts,{s:o,r:dir*gust*.22+(1-o)*dir*-.8,ox:base[0],oy:base[1],x:gust*3}),{fill:GREY});};
 s+=leaf([[239,232],[206,222],[172,196],[160,160],[198,164],[230,196]],[239,232],1,2.0);
 s+=leaf([[242,196],[258,158],[292,128],[330,122],[326,160],[286,186]],[242,196],-1,2.25);
 const bud=spring(2.6,1.6,5);if(bud>.02)s+=blob(X([[240,152],[230,128],[238,104],[250,126]],{s:bud,ox:240,oy:152,x:gust*10,r:gust*.3}));
 s+=dot(318,262,6*spring(3.0))+dot(166,278,4.5*spring(3.2));
 // A speck of pollen drifts across on the breeze.
 if(u>.8&&u<4.8){const f=(u-.8)/4;s+=bead(lerp(80,420,f),150-60*f+Math.sin(f*9)*10,3.5,Math.sin(Math.PI*f));}
 return s;
}
function kite(){
 // The kite swoops in on the wind and climbs; afterwards gusts lift it and whip its tail.
 const u=loop(7.5),gust=bump(u,1,3.2);
 const enter=at(0,2.2),[ex,ey]=enter<1?along([[40,360],[140,300],[200,120],[250,150]],enter):[250,150];
 const settle=shake(T,2.2,1.2,2.6);
 const cx=ex+breathe(.7,10)+gust*14,cy=ey+breathe(1.1,6,1)-gust*22-settle*8,tilt=(1-enter)*-.9+settle*.15+breathe(.9,.06)+gust*.18;
 const k=(pts:P[])=>X(pts,{x:cx-250,y:cy-150,r:tilt,ox:250,oy:150});
 const top:P=[250,62],right:P=[322,138],bottom:P=[256,246],left:P=[178,142];
 const [tb]=k([bottom]),whip=T*3+gust*u*4,amp=6+gust*14;
 const tail:P[]=[0,1,2,3].map(i=>[tb[0]-i*10+Math.sin(whip+i*1.3)*amp*(i/3),tb[1]+i*36] as P);
 let s=curve(tail,{w:5})+dot(tail[1][0],tail[1][1],6)+dot(tail[2][0],tail[2][1],6);
 s+=shape(k([top,right,bottom,left]),{fill:GREY})+line(k([top,bottom]),{w:5})+line(k([left,right]),{w:5});
 // Wind streaks sweep past on the way in and with each gust.
 const w=T<6?lin(.4,1.8):clamp((u-.8)/2),wo=T<6?bump(T,.4,1.8):bump(u,.8,2.8);
 if(wo>0)for(const [y,x0] of [[110,60],[176,30],[90,290]] as const){const x=x0+w*130;s+=curve([[x,y],[x+34,y-6],[x+64,y]],{w:5,opacity:wo});}
 return s+dot(384,96,5*spring(2.6));
}
function telescope(){
 // Legs plant, the tube swings up to the sky and the stars come out; now and then a shooting star crosses and
 // the tube turns to follow it.
 const u=loop(8),shoot=win(u,1.5,2.6),follow=bump(u,1.3,4.5)*.12;
 const legs=spring(0,1.4,6),tilt=lerp(.42,0,spring(.5,1.2,4.5))+follow;
 let s='';for(const [x,y] of [[196,322],[312,322],[256,330]] as const)s+=line([[252,182],[lerp(252,x,legs),lerp(182,y,legs)]]);
 const tube=(pts:P[])=>X(pts,{r:tilt,ox:236,oy:160});
 s+=shape(tube(pill(236,150,200,50,-.42)),{fill:GREY});
 s+=shape(tube(X(rounded(318,112,20,70,8),{r:-.42,ox:328,oy:147})),{fill:PAPER});
 s+=shape(tube(X(rounded(132,168,30,34,8),{r:-.42,ox:147,oy:185})),{fill:PAPER});
 const tw=(p:number)=>T>6?1+.28*Math.sin((T-6)*2.1+p):1;
 s+=glint(368,70,12,spring(1.5)*tw(0))+glint(412,138,8,spring(1.8)*tw(2))+dot(318,56,5*spring(2.1))+dot(430,82,4*spring(2.3));
 if(shoot>0&&shoot<1){const hx=lerp(460,300,shoot),hy=lerp(30,96,shoot),len=60*Math.sin(Math.PI*shoot);s+=line([[hx,hy],[hx+len*.92,hy-len*.38]],{w:5,opacity:Math.sin(Math.PI*shoot)});}
 return s;
}
function pencil(){
 // The pencil flies in, writes a line, lifts and dots it. At rest it hovers, and every so often underlines its work.
 const u=loop(7),write=at(.8,2.8),under=win(u,1.4,2.6),fade=1-win(u,4.8,5.8);
 const scribble:P[]=[[70,300],[104,278],[128,304],[158,282],[188,306],[220,290],[256,300]];
 const underline:P[]=[[80,332],[164,328],[248,334]];
 let tip:P;
 if(T<.8){const f=at(0,.8);tip=[lerp(460,70,f),lerp(40,300,f)];}
 else if(T<2.8)tip=along(scribble,write);
 else if(T<3.6){const f=at(2.8,3.2),g=at(3.2,3.6);tip=[lerp(256,272,f),300-30*f+26*g];}
 else{const rest:P=[272+breathe(1.1,4),296+breathe(1.4,5,1)];
  if(u>1.1&&u<1.4)tip=[lerp(rest[0],80,ease((u-1.1)/.3)),lerp(rest[1],332,ease((u-1.1)/.3))];
  else if(u>=1.4&&u<=2.6)tip=along(underline,(u-1.4)/1.2);
  else if(u>2.6&&u<3.1)tip=[lerp(248,rest[0],ease((u-2.6)/.5)),lerp(334,rest[1],ease((u-2.6)/.5))];
  else tip=rest;}
 const writing=(T>.8&&T<2.8)||(u>1.4&&u<2.6),lift=writing?0:10;
 const a=-.62+(writing?Math.sin(T*18)*.03:0);
 // The pencil is built around its point, so it always writes from the tip.
 const body=(pts:P[])=>X(pts,{r:a,s:.8,ox:0,oy:0,x:tip[0],y:tip[1]-lift});
 let s=curve(scribble,{w:6,k:write});
 if(T>3.2)s+=bead(272,300,4*spring(3.5));
 s+=curve(underline,{w:5,k:under,opacity:fade});
 s+=shape(body([[48,-22],[218,-22],[218,22],[48,22]]),{fill:GREY})
  +shape(body([[218,-22],[250,-22],[250,22],[218,22]]),{fill:PAPER})
  +shape(body([[48,-22],[0,0],[48,22]]),{fill:PAPER})
  +shape(body([[16,-8],[0,0],[16,8]]),{fill:INK,w:4})
  +line(body([[78,0],[198,0]]),{w:4.5});
 return s;
}
function bridge(){
 // The two halves of the deck slide in and meet with a knock; the arch rises under them and the water starts to
 // move. At rest the water flows and, now and then, a small boat passes under.
 const u=loop(11),meet=at(0,1.3),knock=lin(1.3,1.8),f=Math.max(0,T-1.5);
 const arch=(x:number)=>318-112*Math.sqrt(Math.max(0,1-((x-240)/124)**2));
 const rise=spring(1.5,1.3,5);
 let s=water(340,120,360,0,at(1.8,2.6),f)+water(362,170,310,1.7,at(2,2.8),f);
 if(u>0&&u<9.9){const b=u/9.9,bx=lerp(60,430,b),by=344+Math.sin(bx*.08-T*1.6)*1.5,o=Math.min(1,Math.sin(Math.PI*b)*4);
  s+=shape([[bx-16,by],[bx+16,by],[bx+10,by+10],[bx-10,by+10]],{fill:GREY,w:4.5,opacity:o})+line([[bx,by],[bx,by-18]],{w:4,opacity:o})+shape([[bx,by-18],[bx+12,by-6],[bx,by-4]],{fill:INK,w:3,opacity:o});}
 if(rise>.02){s+=line(X(arc(240,318,124,112,Math.PI,TAU,28),{sy:rise,ox:240,oy:318}));
  [150,184,218,262,296,330].forEach((x,i)=>{const o=spring(2+i*.08,1.6,6);if(o>.02)s+=line([[x,190],[x,lerp(190,arch(x)-4,o)]],{w:5});});}
 s+=line([[88,318],[118,318]])+line([[362,318],[392,318]]);
 const half=lerp(-190,0,meet);
 s+=shape(rounded(78+half,170,162,22,9),{fill:GREY})+shape(rounded(240-half,170,162,22,9),{fill:GREY});
 s+=burst(240,181,knock,6,16,40);
 return s+shape(ellipse(386,92+lerp(40,0,at(2.2,3.4)),16),{w:5,opacity:at(2.2,3)});
}
function conversation(){
 // A question pops up and its lines write in; a reply pops beside it and starts typing. At rest the reply keeps
 // typing, and now and then the question nods as a new line arrives.
 const u=loop(6.5),nod=shake(u,3.2,1.6,4);
 const a=spring(0,1.5,5),b=spring(1.4,1.5,5);let s='';
 if(a>.02){const q=(pts:P[])=>X(pts,{s:a*(1+nod*.03),ox:132,oy:200});
  s+=shape(q(rounded(92,82,210,118,30)),{fill:PAPER})+shape(q([[132,196],[116,234],[172,198]]),{fill:PAPER});
  s+=line(q([[124,126],[256,126]]),{w:5,k:at(.5,1)})+line(q([[124,156],[210,156]]),{w:5,k:at(.8,1.2)});}
 if(b>.02){const r=(pts:P[])=>X(pts,{s:b,ox:364,oy:296});
  s+=shape(r(rounded(196,186,196,110,30)),{fill:GREY})+shape(r([[346,290],[372,322],[364,288]]),{fill:GREY});
  // A typing indicator: each dot hops in turn.
  for(let i=0;i<3;i++){const t=T*1.6-i*.22,hop=T>2.2?Math.max(0,Math.sin((t%1)*TAU))**3:0,o=spring(1.9+i*.12);if(o>.02)s+=shape(r(ellipse(252+i*40,241-hop*10,8*o)),{fill:INK,w:3});}}
 return s;
}
function envelope(){
 // The envelope drops in and lands with a squash, its flap folds shut and a seal stamps down. At rest it
 // crouches and hops now and then, as if something inside is eager to get out.
 const u=loop(7),hop=bump(u,1,1.55),crouch=bump(u,.7,1),landAt=u>1.55?u-1.55:T<6?T-.7:-1;
 const drop=T<.7?lerp(-260,0,fall(0,.7)):0,[sx,sy]=squash(landAt);
 const e=(pts:P[])=>X(pts,{sx:sx+crouch*.06,sy:sy-crouch*.1,ox:240,oy:270,y:drop-hop*46});
 const apex=lerp(46,208,at(1.1,1.7))+shake(T,1.7,2,5)*6;
 let s=shape(e(rounded(128,118,224,152,16)),{fill:PAPER})
  +line(e([[136,272],[216,198]]),{w:5})+line(e([[344,272],[264,198]]),{w:5})
  +line(e([[134,126],[240,apex],[346,126]]));
 const seal=T<1.8?0:lerp(2.2,1,spring(1.8,1.3,6));
 if(seal>0)s+=shape(e(ellipse(240,208,18*seal)),{fill:GREY});
 s+=burst(240,208,lin(1.9,2.4),6,24,50)+burst(240,284,T>6?clamp(landAt/.5):0,4,20,44,Math.PI/2,Math.PI*1.2);
 return s+dot(384,104,7*spring(2.4))+dot(108,292,5*spring(2.6))+glint(96,110,10,spring(2.8)*(T>6?.8+.2*Math.sin(T*2.4):1));
}
function key(){
 // The key spins in from the left and settles; at rest it turns now and then as if in a lock, with a click.
 const u=loop(6.5),turn=bump(u,1.2,2.6)*.5,click=clamp((u-1.9)/.45);
 const enter=at(0,1.3),settle=shake(T,1.3,1.5,4);
 const k=(pts:P[])=>X(pts,{r:lerp(-TAU,0,enter)+settle*.2+turn+breathe(1,.03),x:lerp(-300,0,enter),ox:240,oy:200});
 let s=shape(k(ellipse(160,200,50)),{fill:GREY})+shape(k(ellipse(160,200,15)),{fill:PAPER})
  +shape(k(rounded(206,186,174,28,14)))
  +line(k([[318,212],[318,246],[340,246],[340,212]]))+line(k([[356,212],[356,236],[372,236],[372,212]]));
 s+=burst(392,200,T>6?click:0,3,14,34,0,Math.PI*.8);
 return s+dot(390,120,6*spring(1.6))+glint(110,112,10,spring(1.8)*(1+bump(u,2,3)*.5));
}
function door(){
 // The door swings open with a little overshoot and light spills out; at rest a draft moves it and the light breathes.
 const u=loop(8),draft=shake(u,1.5,.7,1.2)*10+breathe(.8,2);
 const open=lerp(174,272,spring(.5,1.1,3.6))+draft,light=clamp((open-180)/90)*(T>6?.75+.25*Math.sin((T-6)*1.3):1);
 let s=line([[110,332],[370,332]])+line([[152,330],[152,70],[330,70],[330,330]]);
 for(const [a,b] of [[[296,346],[344,368]],[[306,326],[370,334]],[[290,364],[316,384]]] as [P,P][])s+=line([a,b],{w:5,opacity:light*.8});
 s+=shape([[154,72],[open,94],[open,316],[154,330]],{fill:GREY});
 s+=shape(ellipse(open-20,210+shake(T,1.2,3,5)*3,8),{fill:PAPER,w:5});
 return s+dot(380,110,6*spring(1.8))+glint(390,160,9,bump(u,4,5));
}
function swap(){
 // Two cards pop in, then trade places along curved paths while the arrows turn with them, and trade back.
 const u=loop(9);
 const p=T<6?at(1.6,2.8)-at(3.6,4.8):win(u,1.5,2.7)-win(u,5.5,6.7);
 const card=(x0:number,y0:number,x1:number,y1:number,lift:number,fill:string,pop:number)=>{if(pop<=.02)return '';const x=lerp(x0,x1,p),y=lerp(y0,y1,p)+lift*Math.sin(Math.PI*p),r=Math.sin(Math.PI*p)*.14*Math.sign(lift);const c=(pts:P[])=>X(pts,{s:pop*(1+.06*Math.sin(Math.PI*p)),r,ox:x0+61,oy:y0+75,x:x-x0,y:y-y0});return shape(c(rounded(x0,y0,122,150,18)),{fill})+line(c([[x0+26,y0+40],[x0+92,y0+40]]),{w:5})+line(c([[x0+26,y0+68],[x0+74,y0+68]]),{w:5});};
 // The card travelling over the top is drawn last.
 let s=card(266,140,92,110,60,PAPER,spring(.2,1.5,5))+card(92,110,266,140,-70,GREY,spring(0,1.5,5));
 const ar=(pts:P[])=>X(pts,{r:p*.5,ox:240,oy:200});
 s+=curve(ar([[160,94],[240,62],[318,112]]),{k:at(.6,1.2)})+line(ar([[296,108],[320,114],[318,90]]),{opacity:at(1.1,1.3)});
 s+=curve(ar([[322,306],[240,338],[162,290]]),{k:at(.8,1.4)})+line(ar([[184,292],[160,288],[162,312]]),{opacity:at(1.3,1.5)});
 return s;
}
function invite(){
 // The envelope rises, the card slides up out of it with a spring and a little burst celebrates. At rest the card
 // peeks up and down, and now and then jumps out a little higher.
 const u=loop(7),env=spring(0,1.2,5),card=spring(.7,1.1,4);
 const lift=lerp(-40,0,card)+bump(u,2,3)*28+breathe(1.2,4);
 const e=(pts:P[])=>X(pts,{y:lerp(160,0,env)});
 let s=shape(e(rounded(138,176,204,130,14)),{fill:PAPER});
 if(T>.7){s+=shape(e(rounded(166,104-lift,148,140,12)),{fill:GREY});
  const face=spring(1.3,1.6,5);if(face>.02)s+=shape(e(ellipse(240,146-lift,16*face)),{fill:PAPER,w:5})+curve(e([[210,196-lift],[224,176-lift],[256,176-lift],[270,196-lift]]),{w:5,k:at(1.4,1.8)});}
 s+=shape(e([[138,206],[240,262],[342,206],[342,306],[138,306]]),{fill:PAPER});
 s+=burst(240,80,T<6?lin(1.6,2.3):clamp((u-2.3)/.6),7,40,90,-Math.PI/2,Math.PI*1.3);
 return s+glint(372,120,11,spring(1.8))+dot(108,150,6*spring(2))+dot(378,178,4*spring(2.2));
}
function keypad(){
 // The phone pops up and its keys appear one by one; a code is typed, dot by dot. At rest the same small ritual
 // repeats: three presses, three dots, a glint, and the dots clear.
 const u=loop(7),dev=spring(0,1.3,5),clock=T<6?T:u;
 const presses=T<6?[1.6,2.1,2.6]:[1,1.6,2.2],pressed=[4,0,8],clear=T<6?0:win(u,5.2,5.6);
 let s=shape(X(rounded(160,66,160,262,28),{s:dev,ox:240,oy:328}));
 if(dev<.3)return s;
 s+=shape(rounded(184,92,112,40,12),{fill:GREY});
 presses.forEach((p,i)=>{const o=clock>p+.12?spring(0,2,6,clock-p-.12)*(1-clear):0;if(o>.02)s+=shape(ellipse(214+i*26,112,4.5*o),{fill:INK,w:2});});
 for(let r=0;r<3;r++)for(let c=0;c<3;c++){const i=r*3+c,appear=spring(.4+i*.07,1.6,6);if(appear<.02)continue;
  const j=presses.findIndex((p,j)=>pressed[j]===i&&clock>p&&clock<p+.35),d=j>=0?Math.sin(Math.PI*(clock-presses[j])/.35):0;
  s+=shape(ellipse(204+c*36,172+r*44,13*appear*(1-.18*d)),{fill:d>.05?GREY:'none',w:5});}
 s+=line([[222,304],[258,304]],{w:5});
 return s+glint(342,96,9,bump(clock,T<6?3.2:2.8,T<6?4:3.6));
}
function shield(){
 // The shield grows from its centre, the check draws itself and a glint answers. At rest a ripple goes out from
 // it now and then, and the check is drawn again.
 const u=loop(7),grow=spring(0,1.3,5),pulse=shake(u,1.2,1.4,4)*.05;
 const m=(pts:P[])=>X(pts,{s:grow*(1+pulse),ox:240,oy:200});
 let s=ripple(240,195,90,150,T<6?lin(1.4,2.4):clamp((u-1.2)/1.2));
 s+=blob(m([[240,66],[290,86],[334,96],[332,170],[302,252],[240,318],[178,252],[148,170],[146,96],[190,86]]),{fill:GREY});
 const check=T<6?at(.8,1.4):u<1.1?1:u<1.25?1-(u-1.1)/.15:win(u,1.25,1.8);
 s+=line(m([[198,196],[230,230],[288,160]]),{w:10,k:check});
 return s+glint(376,108,11,spring(1.5)*(1+bump(u,1.6,2.4)*.6))+dot(104,130,6*spring(1.7))+dot(372,286,5*spring(1.9));
}
function padlock(open:boolean){
 const u=loop(7.5),body=T<.6?lerp(-250,0,fall(0,.6)):0,[sx,sy]=squash(T-.6);
 let lift:number,a=0,tug=0;
 if(open){
  // The shackle springs up and swings open; at rest it swings on its hinge now and then.
  lift=lerp(0,30,spring(1,1.3,4.5));a=lerp(0,-.32,spring(1.25,1.1,3.2))+shake(u,1.5,.9,1.4)*.18+breathe(.9,.02);
 }else{
  // The shackle drops into the body with a click; at rest someone tests it, and it holds.
  lift=T<1?60:lerp(60,0,fall(1,1.35));tug=shake(u,1.5,3,4)*.05;lift+=bump(u,1.5,1.8)*6;
 }
 const all=(pts:P[])=>X(pts,{sx,sy,ox:240,oy:302,y:body,r:tug});
 const shackle=X([[188,176],...arc(240,132,52,52,Math.PI,TAU,20),[292,176]],{y:-lift});
 let s=line(all(X(shackle,{r:a,ox:188,oy:176})),{w:9});
 s+=shape(all(rounded(160,170,160,132,22)),{fill:GREY})+shape(all(ellipse(240,226,13)),{fill:PAPER,w:5})+line(all([[240,238],[240,264]]),{w:8});
 s+=burst(open?292:240,open?150:176,open?lin(1.05,1.6):lin(1.35,1.9),5,16,42,-Math.PI/2,Math.PI*1.1);
 return s+(open?glint(356,112,10,spring(1.8))+dot(118,130,5*spring(2)):dot(362,118,6*spring(1.9))+dot(116,146,5*spring(2.1)));
}
function lock(){return padlock(false);}
function unlock(){return padlock(true);}
function links(joined:boolean){
 const u=loop(7),a=-.6;
 // Joined: two links fly in from opposite corners and hook together; at rest they tug apart and snap back.
 // Apart: the joined links pull apart with a spark; at rest they drift, almost meet, and part again.
 const gap=joined?lerp(170,0,spring(0,1.1,4.2))+bump(u,1.2,1.7)*16-shake(u,1.7,2,5)*6:lerp(0,34,spring(1,1.2,4))+breathe(.8,4)-bump(u,2,3.5)*16;
 let s=shape(pill(192-gap,212+gap*.5,160,64,a),{fill:GREY})+shape(pill(192-gap,212+gap*.5,96,10,a),{fill:PAPER,w:5});
 s+=shape(pill(290+gap,150-gap*.5,160,64,a))+shape(pill(290+gap,150-gap*.5,96,10,a),{fill:PAPER,w:5});
 if(joined)return s+burst(241,181,lin(.55,1.1),6,14,40)+glint(372,256,10,spring(1.2))+dot(128,120,6*spring(1.4));
 s+=burst(241,181,T<6?lin(1,1.6):clamp((u-3.3)/.6),5,10,36);
 if(T>1.5)[[[226,150],[210,128]],[[248,176],[276,172]],[[232,208],[244,232]]].forEach((pts,i)=>{s+=line(pts as P[],{w:5,opacity:.55+.45*Math.sin(T*3+i*2)});});
 return s;
}
function link(){return links(true);}
function unlink(){return links(false);}
function plane(){
 // The plane loops in, its dashed path appearing behind it, and levels out. At rest it glides and banks, and its
 // trail keeps flowing.
 const u=loop(8),fly=at(0,2.6);
 const path:P[]=[[30,330],[120,300],[150,220],[100,190],[110,250],[200,240],[300,160],[300,168]],rest:P=[300,168];
 const [px,py]=fly<1?along(path,fly):rest,[qx,qy]=fly<1?along(path,Math.min(1,fly+.02)):[rest[0]+1,rest[1]];
 const heading=fly<1?Math.atan2(qy-py,qx-px)+.46:0;
 const bank=breathe(1.1,.08)-bump(u,2,4)*.12,y=breathe(1.2,8)-bump(u,2,4)*20;
 const m=(pts:P[])=>X(pts,{r:heading+bank,ox:rest[0],oy:rest[1],x:px-rest[0],y:py-rest[1]+y});
 let s=curve([[196,246],[150,270],[110,252],[120,222],[152,236],[128,300],[84,330]],{w:5,dash:'14 16',offset:-Math.max(0,T-2.6)*30,opacity:at(2,2.8)});
 if(fly>.05&&fly<1){const [bx,by]=along(path,Math.max(0,fly-.08));s+=curve([[bx,by],along(path,Math.max(0,fly-.04)),[px,py]],{w:5,opacity:.6});}
 s+=shape(m([[368,98],[138,172],[210,196]]),{fill:PAPER})+shape(m([[368,98],[210,196],[238,252]]),{fill:GREY})+line(m([[210,196],[204,230]]),{w:5});
 return s+dot(390,168,6*spring(2.8))+glint(330,262,9,spring(3));
}
function hourglass(){
 // The hourglass lands, turns over and settles. At rest the sand runs down and, when the top is empty, the glass
 // turns over again.
 const u=loop(8.5),land=T<.6?lerp(-260,0,fall(0,.6)):0;
 let flip:number,left:number;
 if(T<6){flip=at(1.4,2.5)+shake(T,2.5,1.4,5)*.04;left=0;}
 else{left=u<6.9?1-u/6.8:0;flip=u>6.9?ease((u-6.9)/1.1)+shake(u,8,1.4,5)*.04:0;}
 const g=(pts:P[])=>X(pts,{r:flip*Math.PI,ox:240,oy:200,y:land});
 let s=curve(g([[184,90],[188,150],[232,200],[188,250],[184,310]]))+curve(g([[296,90],[292,150],[248,200],[292,250],[296,310]]));
 const top=Math.sqrt(clamp(left)),bot=Math.sqrt(1-clamp(left));
 if(top>.05)s+=shape(g(X([[200,136],[280,136],[242,188]],{s:top,ox:242,oy:188})),{fill:GREY,w:5});
 if(bot>.05)s+=shape(g(X([[194,304],[222,272],[240,266],[258,272],[286,304]],{s:bot,ox:240,oy:304})),{fill:GREY,w:5});
 if(left>0&&left<1&&flip===0)s+=line(g([[240,196],[240,300-38*bot]]),{w:3.5,dash:'6 10',offset:-T*60});
 return s+shape(g(rounded(164,70,152,20,10)),{fill:GREY})+shape(g(rounded(164,310,152,20,10)),{fill:GREY})+ripple(240,330,20,60,lin(.6,1.1));
}
function box(){
 // The box drops, its flaps spring open and a few bubbles float up. At rest it hops and something pops out,
 // turns over in the air and drops back in.
 const u=loop(7.5),hop=bump(u,1,1.5)*22,[sx,sy]=squash(u>1.5?u-1.5:T<6?T-.6:-1);
 const b=(pts:P[])=>X(pts,{sx,sy,ox:240,oy:322,y:(T<.6?lerp(-280,0,fall(0,.6)):0)-hop});
 const flapL=lerp(1.2,0,spring(.9,1.5,4.5)),flapR=lerp(-1.2,0,spring(1.05,1.5,4.5));
 let s=shape(b([[140,184],[172,150],[308,150],[340,184]]),{fill:GREY});
 const fly=clamp((u-1.2)/1.6);if(fly>0&&fly<1){const oy=184-Math.sin(Math.PI*fly)*150;s+=shape(X(rounded(226,oy-14,28,28,6),{r:fly*TAU,ox:240,oy}),{fill:INK,w:3});}
 s+=shape(b(X([[140,184],[96,146],[124,122],[172,150]],{r:flapL,ox:156,oy:167})),{fill:PAPER})+shape(b(X([[340,184],[384,146],[356,122],[308,150]],{r:flapR,ox:324,oy:167})),{fill:PAPER});
 s+=shape(b([[140,184],[340,184],[330,322],[150,322]]),{fill:PAPER})+shape(b(rounded(204,232,72,30,6)),{w:5});
 for(let i=0;i<3;i++){const f=T<6?clamp((T-1.4-i*.35)/2.2):((T-6)*.22+i*.33)%1;if(f>0&&f<1)s+=dot(200+i*40+Math.sin(f*7+i)*8,140-f*90,(4+i*1.5)*(1-f*.3),Math.sin(Math.PI*f));}
 return s;
}
function jar(){
 // The jar lands, fills up with a slosh and its lid screws on. At rest the liquid moves, bubbles rise, and now and
 // then the jar tips and the liquid follows a moment later.
 const u=loop(8),tip=bump(u,1.5,3)*.1,slosh=shake(u,2,1,1.6)*16+shake(T,1.8,1,1.8)*14+breathe(1.6,3);
 const [sx,sy]=squash(T-.6),j=(pts:P[])=>X(pts,{sx,sy,ox:240,oy:320,r:tip,y:T<.6?lerp(-250,0,fall(0,.6)):0});
 const level=lerp(306,206,at(.8,1.9));
 let s=shape(j(rounded(168,106,144,214,36)));
 if(level<304){const top:P[]=Array.from({length:9},(_,i)=>[182+i*14.5,level+Math.sin(i*.8+T*3)*3+(i-4)/4*slosh] as P);s+=blob(j([...top,[298,290],[276,308],[204,308],[182,290]]),{fill:GREY});}
 if(T>2)for(let i=0;i<3;i++){const f=((T-2)*.32+i*.33)%1;s+=dot(214+i*22+Math.sin(f*8+i)*5,lerp(290,level+8,f),4+i*1.3,Math.sin(Math.PI*f));}
 const lid=T<2?-90:lerp(-90,0,spring(2,1.4,5)),twist=T<2?0:(1-at(2,2.8))*.3*Math.sin(T*20);
 s+=shape(j(X(rounded(184,76,112,32,10),{y:lid,r:twist,ox:240,oy:92})),{fill:GREY});
 return s+glint(348,112,10,spring(2.6))+dot(126,150,5*spring(2.8));
}
function folder(){
 // The folder opens out, a sheet drops into it and the front closes over it. At rest another sheet drops in now
 // and then, the folder gives a little under it, and the sheet fades back into the pile.
 const u=loop(7.5),back=spring(0,1.3,5),front=spring(1.2,1.3,5);
 const sheet=T<.5?null:lerp(-260,0,fall(.5,1.2)),give=shake(u,1.6,1.8,4)*.05+shake(T,1.2,1.8,4)*.05;
 const extra=u>.8&&u<1.6?lerp(-260,0,((u-.8)/.8)**2):u>=1.6&&u<5.5?0:null,fade=1-win(u,4.5,5.5);
 let s=shape(X([[120,118],[196,118],[218,140],[360,140],[360,302],[120,302]],{sy:back*(1-give),ox:240,oy:302}),{fill:GREY});
 if(sheet!==null)s+=shape(rounded(150,104+sheet,178,130,10),{fill:PAPER})+line([[176,136+sheet],[284,136+sheet]],{w:5})+line([[176,162+sheet],[250,162+sheet]],{w:5});
 if(extra!==null)s+=shape(X(rounded(166,94+extra,160,120,10),{r:-.06,ox:246,oy:154}),{fill:PAPER,opacity:fade})+line([[190,124+extra],[276,120+extra]],{w:5,opacity:fade});
 s+=shape(X([[114,172],[366,172],[354,302],[126,302]],{sy:front*(1-give),ox:240,oy:302}),{fill:PAPER});
 return s+dot(392,110,6*spring(1.8));
}
function plug(){
 // The cable draws itself in and the plug swings up on it, then pushes into the socket with a spark. At rest it
 // pulls out now and then and pushes back in.
 const u=loop(8),cable=at(0,1.1),rise=spring(1,1.1,4),out=bump(u,1.2,2.4)*26;
 const y=lerp(160,20,rise)-44*at(2,2.4)+out,sway=shake(T,1,1,2.5)*.25*(1-at(2,2.4));
 const p=(pts:P[])=>X(pts,{y,r:sway,ox:240,oy:238});
 const sock=at(.6,1);
 const [ex,ey]=p([[240,238]])[0];
 let s=curve([[ex,ey],[ex,ey+38],[208,302],[160,300],[124,326],[104,346]],{k:cable});
 if(T>.9)s+=line(p([[214,122],[214,80]]),{w:9})+line(p([[266,122],[266,80]]),{w:9})+shape(p(rounded(186,118,108,120,24)),{fill:GREY})+line(p([[222,158],[258,158]]),{w:5});
 // The socket is drawn over the prongs, so they disappear into it.
 s+=shape(rounded(170,26,140,40,12),{fill:PAPER,opacity:sock})+line([[214,44],[214,52]],{w:6,opacity:sock})+line([[266,44],[266,52]],{w:6,opacity:sock});
 const spark=T<6?lin(2.4,3):clamp((u-2.4)/.6);
 return s+burst(196,70,spark,3,10,30,Math.PI*1.1,Math.PI*.5)+burst(284,70,spark,3,10,30,-Math.PI*.1,Math.PI*.5);
}
function house(){
 // Walls rise from the ground, the roof drops on with a bounce, the door and windows appear, the lights come on and
 // smoke starts to curl. At rest the smoke keeps curling and the lights go off and on again.
 const u=loop(10),walls=spring(.5,1.3,5),roof=T<1.2?null:lerp(-200,0,fall(1.2,1.6)),[sx,sy]=squash(T-1.6);
 const lit=T<6?T>2.6:!(u>4&&u<6.5);
 const puff=(i:number)=>{if(T<2.6+i*1.2)return '';const f=((T-2.6)*.28+i*.5)%1;return dot(302+f*20+Math.sin(f*6)*6,96-f*56,5+f*8,Math.sin(Math.PI*f));};
 let s=line([[96,322],[384,322]],{k:at(0,.5)});
 if(walls>.02)s+=shape(X([[160,196],[160,322],[320,322],[320,196]],{sy:walls,ox:240,oy:322}),{fill:PAPER});
 if(roof!==null){const r=(pts:P[])=>X(pts,{sx,sy,ox:240,oy:206,y:roof});s+=line(r([[290,156],[290,112],[312,112],[312,176]]))+shape(r([[132,206],[240,114],[348,206]]),{fill:GREY});}
 const d=spring(1.9,1.6,6),w1=spring(2.1,1.6,6),w2=spring(2.2,1.6,6);
 if(d>.02)s+=shape(X(rounded(220,252,42,70,10),{sy:d,ox:241,oy:322}),{fill:GREY});
 if(w1>.02)s+=shape(X(rounded(178,226,28,28,5),{s:w1,ox:192,oy:240}),{w:5,fill:lit?GREY:'none'});
 if(w2>.02)s+=shape(X(rounded(284,226,28,28,5),{s:w2,ox:298,oy:240}),{w:5,fill:lit?GREY:'none'});
 return s+puff(0)+puff(1);
}
function lifebuoy(){
 // The ring drops onto the water with a splash and bobs; at rest it rides the swell and turns slowly.
 const u=loop(9),f=Math.max(0,T-1);
 const cy=196+(T<.8?lerp(-320,0,fall(0,.8)):0)+shake(T,.8,.9,1.6)*18+breathe(1.1,6),a=breathe(.35,.25)+shake(T,.8,.5,1)*.4,cx=240;
 let s=water(318,110,370,0,at(.6,1),f)+water(342,160,330,1.4,at(.7,1.1),f);
 for(let i=0;i<4;i++){const b=a+i*Math.PI/2+Math.PI/4;s+=shape([...arc(cx,cy,100,100,b-.36,b+.36,8),...arc(cx,cy,50,50,b+.36,b-.36,8)],{fill:GREY,w:4.5});}
 s+=shape(ellipse(cx,cy,100))+shape(ellipse(cx,cy,50));
 s+=burst(130,300,lin(.8,1.4),3,6,34,-Math.PI*.75,Math.PI*.5)+burst(350,300,lin(.8,1.4),3,6,34,-Math.PI*.25,Math.PI*.5);
 return s+dot(372,86,6*spring(1.6))+glint(98,96,10,spring(1.8)*(1+bump(u,3,4)*.5));
}
function profile(){
 // The card swings in on its clip, the photo pops in and the details write themselves. At rest it sways on the
 // clip, and now and then the details are written out again.
 const u=loop(8),swing=lerp(-.5,0,spring(0,.9,2.6))+shake(u,2,.7,1)*.06+breathe(.8,.015);
 const c=(pts:P[])=>X(pts,{r:swing,ox:240,oy:96});
 let s=shape(c(rounded(110,112,260,176,22)),{fill:PAPER})+shape(c(rounded(214,96,52,26,9)),{fill:PAPER});
 const face=spring(1,1.6,5);if(face>.02)s+=shape(c(X(ellipse(180,178,30),{s:face,ox:180,oy:178})),{fill:GREY})+shape(c(X(arc(180,262,52,40,Math.PI,TAU,18),{sy:face,ox:180,oy:262})),{fill:GREY});
 const redo=(d:number)=>T<6?1:u<4.5?1:u<4.7?1-(u-4.5)/.2:win(u,4.7+d,5.3+d);
 s+=line(c([[248,168],[334,168]]),{w:5,k:Math.min(at(1.4,1.9),redo(0))})+line(c([[248,200],[316,200]]),{w:5,k:Math.min(at(1.7,2.2),redo(.2))})+line(c([[248,232],[292,232]]),{w:5,k:Math.min(at(2,2.4),redo(.4))});
 return s;
}
function safe(){
 // The safe lands, its dial turns through a combination with a click at each stop, and the handle turns. At rest
 // the combination is dialled again now and then.
 const u=loop(8.5),clock=T<6?T-1:u-1;
 const a=clock<0?0:ease(clock/.8)*2.4-ease((clock-.9)/.7)*3.4+ease((clock-1.8)/.6)*1.4;
 const handle=T<6?at(3.6,4)-at(5,5.4):win(u,3.2,3.5)-win(u,5.5,5.8);
 const land=T<.6?lerp(-280,0,fall(0,.6)):0,[sx,sy]=squash(T-.6);
 const b=(pts:P[])=>X(pts,{sx,sy,ox:240,oy:318,y:land}),cx=222,cy=196;
 let s=shape(b(rounded(128,88,224,214,20)),{fill:PAPER})+shape(b(rounded(150,110,180,170,12)),{fill:GREY});
 s+=shape(b(ellipse(cx,cy,38)),{fill:PAPER})+line(b([[cx,cy],[cx+Math.cos(a-Math.PI/2)*26,cy+Math.sin(a-Math.PI/2)*26]]),{w:6});
 s+=line(b(X([[296,168],[296,224]],{r:handle*Math.PI/2,ox:296,oy:196})),{w:10});
 s+=line(b([[158,302],[158,318]]))+line(b([[322,302],[322,318]]));
 for(const t of [.8,1.6,2.4])s+=burst(cx,cy+land,clamp((clock-t)/.35),2,44,62,-Math.PI/2,.8);
 return s+glint(372,100,10,bump(clock,2.6,3.4));
}
function expired(){
 // The clock pops in and its hands race round, then stop too late; a cross badge drops in and shakes its head.
 // At rest the minute hand ticks on, and the badge shakes now and then.
 const u=loop(7),face=spring(0,1.4,5),race=at(.5,2.4);
 const hour=-Math.PI/2+race*TAU*1.2;
 const minute=race*TAU*6+.5+(T>6?Math.floor(T-6)*.105+shake((T-6)%1,0,4,10)*.03:0);
 const cx=226,cy=208,c=(pts:P[])=>X(pts,{s:face,ox:cx,oy:cy});
 let s=shape(c(ellipse(cx,cy,98)),{fill:PAPER});
 for(let i=0;i<4;i++){const b=i*Math.PI/2;s+=line(c([[cx+Math.cos(b)*80,cy+Math.sin(b)*80],[cx+Math.cos(b)*88,cy+Math.sin(b)*88]]),{w:5});}
 s+=line(c([[cx,cy],[cx+Math.cos(hour)*56,cy+Math.sin(hour)*56]]))+line(c([[cx,cy],[cx+Math.cos(minute)*44,cy+Math.sin(minute)*44]]))+shape(c(ellipse(cx,cy,6)),{fill:INK,w:3});
 const badge=spring(2.6,1.5,4.5),no=shake(T,2.9,2.4,3.5)*.35+shake(u,2,2.4,3.5)*.3;
 if(badge>.02){const b=(pts:P[])=>X(pts,{s:badge,r:no,ox:318,oy:120});s+=shape(b(ellipse(318,120,30)),{fill:GREY})+line(b([[306,108],[330,132]]),{w:6})+line(b([[330,108],[306,132]]),{w:6});}
 return s;
}
function wave(){
 // A hand rises into view and waves hello, trailing motion marks; at rest it waves again now and then.
 const u=loop(6.5),rise=T<.9?lerp(220,0,ease(T/.9)):0,settle=-shake(T,.9,1.5,4)*8;
 const phase=T<6?T-1:u-1,len=T<6?3.2:1.6,amp=T<6?.3:.2,rate=T<6?.95:1.25;
 const on=phase>0&&phase<len,swing=Math.sin(phase*TAU*rate);
 const a=(on?swing*amp*(T<6?1-phase/len:Math.sin(Math.PI*phase/len)):0)+breathe(1.3,.02);
 const h=(pts:P[])=>X(pts,{r:a,ox:240,oy:340,y:rise+settle});
 let s=shape(h(rounded(206,292,68,52,8)),{fill:PAPER});
 for(const [x,top] of [[196,134],[222,112],[248,110],[274,128]] as const)s+=shape(h(rounded(x-12,top,26,130,13)),{fill:GREY});
 s+=shape(h(X(rounded(172,196,28,92,14),{r:-.55,ox:186,oy:282})),{fill:GREY});
 s+=shape(h(rounded(186,196,104,108,34)),{fill:GREY});
 // Motion marks on the side the hand is swinging towards, strongest at the end of each swing.
 const show=on?Math.abs(Math.cos(phase*TAU*rate))*Math.sin(Math.PI*phase/len):0;
 if(show>.05){const right=Math.cos(phase*TAU*rate)>0;s+=curve(right?[[330,98],[346,128],[338,160]]:[[150,98],[134,128],[142,160]],{w:5,opacity:show})+curve(right?[[358,112],[374,146],[364,180]]:[[122,112],[106,146],[116,180]],{w:5,opacity:show*.6});}
 return s;
}
function balance(){
 // The stand rises, the beam lands and two weights drop into the pans one after the other; the beam tips and finds
 // its balance. At rest a weight hops now and then and the beam rocks back to level.
 const u=loop(8),post=at(0,.6),beamIn=spring(.5,1.4,5);
 const tilt=T<6?-.16*spring(1.8,1.1,2.8)+.16*spring(3,1.1,2.8):shake(u,1.45,1,1.8)*-.08+shake(u,5.05,1,1.8)*.08;
 let s=line([[200,322],[280,322]])+line([[240,322],[240,lerp(322,112,post)]]);
 if(beamIn>.02){s+=line(X([[128,128],[352,128]],{s:beamIn,r:tilt,ox:240,oy:128}));
  X([[128,128],[352,128]],{r:tilt,ox:240,oy:128}).forEach(([x,y],i)=>{
   const py=y+86*spring(.8+i*.1,1.3,4.5),pan=(pts:P[])=>X(pts,{r:shake(T,.8+i*.1,.9,2)*.1,ox:x,oy:y});
   s+=line(pan([[x,y],[x-34,py]]),{w:4.5})+line(pan([[x,y],[x+34,py]]),{w:4.5})+shape(pan(arc(x,py,46,26,0,Math.PI,16)),{fill:GREY});
   const t0=i?3:1.8,hopAt=i?5.05:1.45;
   const by=(T<t0?lerp(-40,py-12,fall(t0-.6,t0)):py-12)-bump(u,hopAt-.55,hopAt)*40;
   if(T>t0-.6)s+=shape(pan(ellipse(x,by,12)),{fill:INK,w:3});});}
 return s+shape(ellipse(240,104,11*spring(.4)),{fill:GREY,w:5});
}
function untangle(){
 // A snarl of thread pulls itself straight as the ball rolls in; at rest the ball rocks and the loose end plays.
 const u=loop(7.5),roll=lerp(-240,0,spring(0,.9,3.4)),spin=roll/82+breathe(.8,.15)+bump(u,2,4)*.6;
 const tidy=at(1,2.8),w=breathe(1.4,6)+bump(u,2,4)*18;
 let s=shape(ellipse(206+roll,206,82),{fill:GREY});
 for(const pts of [[[146,160],[200,138],[258,168]],[[134,214],[206,184],[276,220]],[[156,262],[210,238],[262,268]]] as P[][])s+=curve(X(pts,{r:spin,ox:206,oy:206,x:roll}),{w:5});
 const neat:P[]=[[282,238],[326,272],[364,248],[346,220],[380,288],[410+w,312]];
 const messy:P[]=[[282,238],[340,300],[300,300],[360,210],[330,330],[410,312]];
 s+=curve(neat.map((p,i)=>[lerp(messy[i][0],p[0],tidy)+roll*(1-i/5),lerp(messy[i][1],p[1],tidy)] as P));
 return s+dot(372,118,6*spring(2.6))+glint(120,96,10,spring(2.8));
}
function build(){
 // Blocks drop in one after another and land with a squash; the top one gets its mark. At rest the top block
 // lifts, turns a quarter and drops back down.
 const u=loop(7.5);
 const block=(x:number,y:number,t0:number,fill:string,mark:(m:(p:P[])=>P[])=>string,lift=0,rot=0,landed=-1)=>{if(T<t0)return '';const [sx,sy]=squash(landed>=0?landed:T-t0-.5);const m=(pts:P[])=>X(X(pts,{r:rot,ox:x+47,oy:y+47}),{sx,sy,ox:x+47,oy:y+94,y:lerp(-320,0,fall(t0,t0+.5))-lift});return shape(m(rounded(x,y,94,94,12)),{fill})+mark(m);};
 let s=line([[96,322],[384,322]],{k:at(0,.4)});
 s+=block(142,228,.3,'none',m=>shape(m([[166,300],[189,254],[212,300]]),{w:5}));
 s+=block(244,228,.8,GREY,()=>'');
 s+=block(193,130,1.3,PAPER,m=>{const o=spring(2,1.6,5);return o>.02?shape(m(X(ellipse(240,177,20),{s:o,ox:240,oy:177})),{fill:GREY,w:5}):'';},bump(u,1.2,2.8)*70,win(u,1.5,2.5)*Math.PI/2,u>2.8?u-2.8:-1);
 return s+glint(344,112,11,spring(2.4))+dot(128,170,6*spring(2.6));
}
function discover(){
 // The magnifier sweeps in and stops over something; a glint answers. At rest it wanders slowly and, now and then,
 // leans in and finds another spark.
 const u=loop(8),enter=at(0,1.6);
 const [ex,ey]=enter<1?along([[480,380],[330,300],[160,160],[214,184]],enter):[214,184];
 const dx=ex-214+breathe(.6,18),dy=ey-184+breathe(.8,10,1);
 const zoom=1+bump(u,3.2,4.6)*.08+bump(T,1.6,2.2)*.08;
 const m=(pts:P[])=>X(pts,{s:zoom,ox:214,oy:184,x:dx,y:dy});
 let s=shape(m(pill(304,262,104,30,Math.PI/4)))+shape(m(ellipse(214,184,72)),{fill:GREY})+curve(m([[172,170],[180,146],[204,134]]),{w:6});
 s+=glint(214+dx,184+dy,14,Math.sin(Math.PI*(T<6?lin(1.8,2.6):clamp((u-3.4)/.9))));
 return s+glint(352,98,12,spring(2.2))+dot(384,152,5*spring(2.4))+dot(118,300,6*spring(2.6));
}
function learn(){
 // The closed book opens, its lines write in and the ribbon drops. At rest a page turns over now and then.
 const u=loop(7),open=spring(.3,1,3.6),turn=win(u,1.5,2.7);
 let s=blob([[240,132],[196,112],[140,112],[112,122],[112,292],[150,284],[198,288],[240,306]],{fill:GREY});
 const right=(pts:P[])=>pts.map(([x,y])=>[240+(x-240)*lerp(-1,1,open),y] as P);
 s+=blob(right([[240,132],[284,112],[340,112],[368,122],[368,292],[330,284],[282,288],[240,306]]),{fill:PAPER});
 s+=line([[240,132],[240,306]],{w:5});
 if(open>.9)s+=line([[268,160],[340,154]],{w:5,k:at(1.2,1.6)})+line([[268,190],[340,186]],{w:5,k:at(1.4,1.8)})+line([[268,220],[318,218]],{w:5,k:at(1.6,1.9)});
 if(turn>0&&turn<1){const f=Math.cos(Math.PI*turn),lift=Math.sin(Math.PI*turn)*22;s+=blob([[240,132],[240+100*f,112-lift],[240+128*f,122-lift*.6],[240+128*f,292-lift*.4],[240+90*f,284],[240,306]],{fill:turn<.5?PAPER:GREY});}
 if(T<2)return s;
 const rib=lerp(-60,0,spring(2,1.4,4));
 return s+shape([[296,292],[296,338+rib],[308,326+rib],[320,338+rib],[320,288]],{fill:GREY,w:5});
}
function orchestrate(){
 // The two gears pop in, catch each other and start turning together. At rest they run steadily and now and then
 // speed up for a moment, throwing off a spark where they mesh.
 const u=loop(8),a1=spring(0,1.4,5),a2=spring(.3,1.4,5);
 const spin=T<1.2?0:(T-1.2)*.45+(T>6?win(u,2,3.5)*1.4+Math.floor((T-6)/8)*1.4:0);
 let s='';
 if(a1>.02)s+=shape(X(gear(200,214,78,9,spin),{s:a1,ox:200,oy:214}),{fill:GREY})+shape(ellipse(200,214,22*a1),{fill:PAPER});
 if(a2>.02)s+=shape(X(gear(310,128,50,7,-spin*78/50+.2),{s:a2,ox:310,oy:128}),{fill:PAPER})+shape(ellipse(310,128,13*a2),{w:5});
 s+=burst(262,170,T<6?lin(1.1,1.6):clamp((u-2.6)/.6),3,10,34,-Math.PI*.2,Math.PI*.6);
 return s+dot(368,262,6*spring(1.8))+glint(116,104,10,spring(2));
}
const scenes:Record<Scene,()=>string>={balance,untangle,build,discover,learn,orchestrate,sprout,kite,telescope,pencil,bridge,conversation,envelope,key,door,swap,invite,keypad,shield,lock,unlock,link,unlink,plane,hourglass,box,jar,folder,plug,house,lifebuoy,profile,safe,expired,wave};
/** One frame of a scene as SVG markup for a 480×390 stage. `boilSeconds` drives only the line boil, for still drawings. */
export function filmFrame(scene:Scene,seconds:number,_id:string,boilSeconds:number|null=null){T=Math.max(0,seconds);boil=boilSeconds;seed=0;try{return scenes[scene]();}finally{boil=null}}
