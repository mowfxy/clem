/**
 * Mowr's illustrations: one simple object per scene, drawn with an even ivory line, flat grey fills and a few
 * small circles. Each frame is computed from time: the lines draw themselves on over the first seconds, and from
 * t=6 a slow idle loop takes over. A light line boil (a few sub-pixel cels a second) keeps them hand-drawn.
 */
export type Scene='balance'|'untangle'|'build'|'discover'|'learn'|'orchestrate'|'sprout'|'kite'|'telescope'|'pencil'|'bridge'|'conversation'|'envelope'|'key'|'door'|'swap'|'invite'|'keypad'|'shield'|'lock'|'unlock'|'link'|'unlink'|'plane'|'hourglass'|'box'|'jar'|'folder'|'plug'|'house'|'lifebuoy'|'profile'|'safe'|'expired'|'wave';
type P=[number,number];
type Style={fill?:string;w?:number;smooth?:boolean;closed?:boolean;dash?:string;opacity?:number};
const INK='#f3f2ec',GREY='#63635e',PAPER='#1a1a19',TAU=Math.PI*2,LINE=7;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{x=clamp(x);return x*x*(3-2*x)};
const n=(v:number)=>v.toFixed(1);

// Frame state: the scene's time, the boil clock (a still drawing passes its own) and the draw-on order.
let T=0,boil:number|null=null,order=0;
/** 0 before the idle loop starts at t=6, then a slow sine. */
const idle=(speed=1,amp=1,offset=0)=>T>6?Math.sin((T-6)*speed+offset)*amp-Math.sin(offset)*amp:0;

// Catmull-Rom through the control points, for the soft curves.
function spline(pts:P[],closed:boolean):P[]{const out:P[]=[],N=pts.length;if(N<3)return pts;for(let i=0;i<(closed?N:N-1);i++){const a=pts[closed?(i-1+N)%N:Math.max(0,i-1)],b=pts[i],c=pts[(i+1)%N],d=pts[closed?(i+2)%N:Math.min(N-1,i+2)];for(let j=0;j<8;j++){const t=j/8,t2=t*t,t3=t2*t;out.push([0,1].map(k=>.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3)) as P);}}if(!closed)out.push(pts[N-1]);return out;}
// Straight runs get extra points so the boil bends them very slightly, as a pen line would.
function densify(pts:P[],closed:boolean):P[]{const out:P[]=[];const N=pts.length;for(let i=0;i<(closed?N:N-1);i++){const a=pts[i],b=pts[(i+1)%N],steps=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/24));for(let j=0;j<steps;j++)out.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);}if(!closed)out.push(pts[N-1]);return out;}
// The boil: a smooth, low field that shifts every point by under a pixel, stepping through four cels four times a second.
function wobble(pts:P[],seed:number):P[]{const cel=Math.floor((boil??T)*4)%4;return pts.map(([x,y])=>[x+.9*Math.sin(y*.043+cel*1.9+seed),y+.8*Math.sin(x*.039+cel*1.4+seed*1.3)]);}

/** Draws one element; elements draw on one after another in the order a scene calls them. */
function draw(pts:P[],{fill='none',w=LINE,smooth=false,closed=false,dash,opacity=1}:Style={}):string{
 const i=order++,k=ease((T-.2-i*.13)/.7);if(k<=0)return '';
 const line=wobble(smooth?spline(pts,closed):densify(pts,closed),i);
 const d='M'+line.map(p=>n(p[0])+','+n(p[1])).join('L')+(closed?'Z':'');
 const on=k<1&&!dash?` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${(1-k).toFixed(3)}"`:'';
 const alpha=dash?k*opacity:opacity;
 return `<path d="${d}" fill="${fill}"${fill!=='none'&&k<1?` fill-opacity="${k.toFixed(3)}"`:''} stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash?` stroke-dasharray="${dash}"`:''}${on}${alpha<1?` opacity="${alpha.toFixed(3)}"`:''}/>`;
}
const line=(pts:P[],s:Style={})=>draw(pts,s);
const curve=(pts:P[],s:Style={})=>draw(pts,{smooth:true,...s});
const shape=(pts:P[],s:Style={})=>draw(pts,{closed:true,...s});
const blob=(pts:P[],s:Style={})=>draw(pts,{closed:true,smooth:true,...s});

// Geometry.
const arc=(cx:number,cy:number,rx:number,ry:number,a0:number,a1:number,steps=36):P[]=>Array.from({length:steps+1},(_,i)=>{const a=a0+(a1-a0)*i/steps;return [cx+Math.cos(a)*rx,cy+Math.sin(a)*ry] as P;});
const ellipse=(cx:number,cy:number,rx:number,ry=rx):P[]=>arc(cx,cy,rx,ry,0,TAU,40).slice(0,-1);
function rounded(x:number,y:number,w:number,h:number,r:number):P[]{r=Math.min(r,w/2,h/2);return [...arc(x+w-r,y+r,r,r,-Math.PI/2,0,6),...arc(x+w-r,y+h-r,r,r,0,Math.PI/2,6),...arc(x+r,y+h-r,r,r,Math.PI/2,Math.PI,6),...arc(x+r,y+r,r,r,Math.PI,Math.PI*1.5,6)];}
const turn=(pts:P[],cx:number,cy:number,a:number):P[]=>pts.map(([x,y])=>[cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)]);
const move=(pts:P[],dx:number,dy:number):P[]=>pts.map(([x,y])=>[x+dx,y+dy]);
const ring=(cx:number,cy:number,r:number,s:Style={})=>shape(ellipse(cx,cy,r),{w:5,...s});
const dot=(cx:number,cy:number,r:number)=>ring(cx,cy,r,{w:4.5});
/** A small four-point glint. */
const glint=(cx:number,cy:number,r:number)=>line([[cx,cy-r],[cx,cy+r]],{w:5})+line([[cx-r,cy],[cx+r,cy]],{w:5});
/** A stadium: a rectangle with fully round ends, turned by `a` around its centre. */
const pill=(cx:number,cy:number,len:number,h:number,a=0)=>turn(rounded(cx-len/2,cy-h/2,len,h,h/2),cx,cy,a);
function gear(cx:number,cy:number,r:number,teeth:number,a:number):P[]{const out:P[]=[];for(let i=0;i<teeth;i++){const b=a+i*TAU/teeth,s=TAU/teeth;for(const [f,rr] of [[0,r*.8],[.18,r*.8],[.3,r],[.7,r],[.82,r*.8]] as const)out.push([cx+Math.cos(b+s*f)*rr,cy+Math.sin(b+s*f)*rr]);}return out;}

// ---------- scenes ----------
function sprout(){
 const sway=idle(1.1,1);const tip:P=[240+sway*4,150];
 const leaf=(pts:P[],base:P,s:number)=>turn(pts,base[0],base[1],sway*.06*s);
 return shape([...arc(240,302,100,36,Math.PI,TAU,24)],{fill:PAPER})
  +curve([[240,300],[237,262],[243,205],tip])
  +blob(leaf([[239,232],[206,222],[172,196],[160,160],[198,164],[230,196]],[239,232],1),{fill:GREY})
  +blob(leaf([[242,196],[258,158],[292,128],[330,122],[326,160],[286,186]],[242,196],-1),{fill:GREY})
  +blob(move([[240,152],[230,128],[238,104],[250,126]],sway*4,0))
  +dot(318,262,6)+dot(166,278,4.5);
}
function kite(){
 const bob=idle(1.2,5),tilt=idle(.9,.05);const k=(pts:P[])=>turn(move(pts,0,bob),250,150,tilt);
 const top:P=[250,62],right:P=[322,138],bottom:P=[256,246],left:P=[178,142];
 const [tb]=k([bottom]);
 return shape(k([top,right,bottom,left]),{fill:GREY})+line(k([top,bottom]),{w:5})+line(k([left,right]),{w:5})
  +curve([tb,[228+idle(1.6,6),286],[262,318],[232+idle(1.6,-6,1),352]],{w:5})
  +dot(236+idle(1.6,3),292,6)+dot(254,326,6)
  +curve([[92,112],[122,104],[152,110]],{w:5})+curve([[80,178],[106,172],[130,176]],{w:5})+dot(384,96,5);
}
function telescope(){
 const tw=(p:number)=>1+.25*Math.sin(Math.max(0,T-6)*1.8+p);
 const a=-.42;
 return line([[252,182],[196,322]])+line([[252,182],[312,322]])+line([[252,182],[256,330]])
  +shape(pill(236,150,200,50,a),{fill:GREY})
  +shape(turn(rounded(318,112,20,70,8),328,147,a),{fill:PAPER})
  +shape(turn(rounded(132,168,30,34,8),147,185,a),{fill:PAPER})
  +glint(368,70,12*tw(0))+glint(412,138,8*tw(2))+dot(318,56,5)+dot(430,82,4);
}
function pencil(){
 const b=idle(1.3,4),a=-.62,cx=276,cy=166+b;const p=(pts:P[])=>turn(move(pts,0,b),cx,cy,a);
 return curve([[92,300],[130,276],[156,304],[190,280],[222,306],[258,290],[300,300]],{w:6})
  +shape(p([[cx-90,cy-22],[cx+80,cy-22],[cx+80,cy+22],[cx-90,cy+22]]),{fill:GREY})
  +shape(p([[cx+80,cy-22],[cx+112,cy-22],[cx+112,cy+22],[cx+80,cy+22]]),{fill:PAPER})
  +shape(p([[cx-90,cy-22],[cx-138,cy],[cx-90,cy+22]]),{fill:PAPER})
  +shape(p([[cx-122,cy-8],[cx-138,cy],[cx-122,cy+8]]),{fill:INK,w:4})
  +line(p([[cx-60,cy],[cx+60,cy]]),{w:4.5});
}
function bridge(){
 const f=Math.max(0,T-6)*.9;
 const wave=(y:number,x0:number,x1:number,ph:number)=>curve(Array.from({length:7},(_,i)=>[x0+(x1-x0)*i/6,y+Math.sin(i*1.4+f+ph)*3] as P),{w:5});
 const arch=(x:number)=>318-112*Math.sqrt(Math.max(0,1-((x-240)/124)**2));
 let s=line(arc(240,318,124,112,Math.PI,TAU,28));
 for(const x of [150,184,218,262,296,330])s+=line([[x,190],[x,arch(x)-4]],{w:5});
 s+=shape(rounded(78,170,324,22,9),{fill:GREY});
 return s+line([[88,318],[118,318]])+line([[362,318],[392,318]])+wave(340,120,360,0)+wave(362,170,310,1.7)+ring(386,92,16);
}
function conversation(){
 const pulse=(i:number)=>T>6?.55+.45*Math.sin((T-6)*3-i*.9):1;
 let s=shape(rounded(92,82,210,118,30))+shape([[132,196],[116,234],[172,198]],{fill:PAPER});
 s+=line([[124,126],[256,126]],{w:5})+line([[124,156],[210,156]],{w:5});
 s+=shape(rounded(196,186,196,110,30),{fill:GREY})+shape([[346,290],[372,322],[364,288]],{fill:GREY});
 for(let i=0;i<3;i++)s+=shape(ellipse(252+i*40,241,8*pulse(i)),{fill:INK,w:3});
 return s;
}
function envelope(){
 const b=idle(1.2,4);const e=(pts:P[])=>move(pts,0,b);
 return shape(e(rounded(128,118,224,152,16)),{fill:PAPER})
  +line(e([[136,272],[216,198]]),{w:5})+line(e([[344,272],[264,198]]),{w:5})
  +line(e([[134,126],[240,208],[346,126]]))
  +shape(e(ellipse(240,208,18)),{fill:GREY})
  +dot(384,104,7)+dot(108,292,5)+glint(96,110,10);
}
function key(){
 const a=idle(1,.05);const k=(pts:P[])=>turn(pts,240,200,a);
 return shape(k(ellipse(160,200,50)),{fill:GREY})+shape(k(ellipse(160,200,15)),{fill:PAPER})
  +shape(k(rounded(206,186,174,28,14)))
  +line(k([[318,212],[318,246],[340,246],[340,212]]))+line(k([[356,212],[356,236],[372,236],[372,212]]))
  +dot(390,120,6)+glint(110,112,10);
}
function door(){
 const o=idle(.9,7);
 return line([[110,332],[370,332]])+line([[152,330],[152,70],[330,70],[330,330]])
  +shape([[154,72],[272+o,94],[272+o,316],[154,330]],{fill:GREY})
  +shape(ellipse(252+o*.9,210,8),{fill:PAPER,w:5})
  +line([[296,346],[344,368]],{w:5,opacity:.8})+dot(380,110,6);
}
function swap(){
 const n1=idle(1.4,3),n2=idle(1.4,-3);
 return shape(move(rounded(92,110,122,150,18),0,n1),{fill:GREY})
  +line(move([[118,150],[184,150]],0,n1),{w:5})+line(move([[118,178],[166,178]],0,n1),{w:5})
  +shape(move(rounded(266,140,122,150,18),0,n2),{fill:PAPER})
  +line(move([[292,180],[358,180]],0,n2),{w:5})+line(move([[292,208],[340,208]],0,n2),{w:5})
  +curve([[160,94],[240,62],[318,112]])+line([[296,108],[320,114],[318,90]])
  +curve([[322,306],[240,338],[162,290]])+line([[184,292],[160,288],[162,312]]);
}
function invite(){
 const lift=T>6?idle(1.2,5):0;
 return shape(rounded(138,176,204,130,14),{fill:PAPER})
  +shape(rounded(166,104-lift,148,140,12),{fill:GREY})
  +shape(ellipse(240,146-lift,16),{fill:PAPER,w:5})+curve([[210,196-lift],[224,176-lift],[256,176-lift],[270,196-lift]],{w:5})
  +shape([[138,206],[240,262],[342,206],[342,306],[138,306]],{fill:PAPER})
  +glint(372,120,11)+dot(108,150,6)+dot(378,178,4);
}
function keypad(){
 const on=T>6?Math.floor((T-6)/.7)%9:4;let s=shape(rounded(160,66,160,262,28));
 s+=shape(rounded(184,92,112,40,12),{fill:GREY});
 for(let i=0;i<3;i++)s+=shape(ellipse(214+i*26,112,4.5),{fill:INK,w:2});
 for(let r=0;r<3;r++)for(let c=0;c<3;c++)s+=shape(ellipse(204+c*36,172+r*44,13),{fill:r*3+c===on?GREY:'none',w:5});
 return s+line([[222,304],[258,304]],{w:5});
}
function shield(){
 const b=idle(1.1,4);const m=(pts:P[])=>move(pts,0,b);
 return blob(m([[240,66],[290,86],[334,96],[332,170],[302,252],[240,318],[178,252],[148,170],[146,96],[190,86]]),{fill:GREY})
  +line(m([[198,196],[230,230],[288,160]]),{w:10})+glint(376,108,11)+dot(104,130,6)+dot(372,286,5);
}
function padlock(open:boolean){
 const lift=open?30+idle(1.3,4):idle(1.1,2),a=open?-.32:0;
 // The shackle's left leg stays in the body; open, it rises and swings out around that leg.
 const shackle=turn(move([[188,176],...arc(240,132,52,52,Math.PI,TAU,20),[292,176]],0,-lift),188,176,a);
 return line(shackle,{w:9})
  +shape(rounded(160,170,160,132,22),{fill:GREY})
  +shape(ellipse(240,226,13),{fill:PAPER,w:5})+line([[240,238],[240,264]],{w:8})
  +(open?glint(356,112,10)+dot(118,130,5):dot(362,118,6)+dot(116,146,5));
}
function lock(){return padlock(false);}
function unlock(){return padlock(true);}
function links(joined:boolean){
 const gap=joined?0:34+idle(1.3,4),a=-.6;
 let s=shape(pill(192-gap,212+gap*.5,160,64,a),{fill:GREY,w:LINE})+shape(pill(192-gap,212+gap*.5,96,10,a),{fill:PAPER,w:5});
 s+=shape(pill(290+gap,150-gap*.5,160,64,a),{w:LINE})+shape(pill(290+gap,150-gap*.5,96,10,a),{fill:PAPER,w:5});
 if(!joined)s+=line([[226,150],[210,128]],{w:5})+line([[248,176],[276,172]],{w:5})+line([[232,208],[244,232]],{w:5});
 else s+=glint(372,256,10)+dot(128,120,6);
 return s;
}
function link(){return links(true);}
function unlink(){return links(false);}
function plane(){
 const b=idle(1.2,6),m=(pts:P[])=>move(pts,0,b);
 return curve([[196,246],[150,270],[110,252],[120,222],[152,236],[128,300],[84,330]],{w:5,dash:'14 16'})
  +shape(m([[368,98],[138,172],[210,196]]),{fill:PAPER})
  +shape(m([[368,98],[210,196],[238,252]]),{fill:GREY})
  +line(m([[210,196],[204,230]]),{w:5})+dot(390,168,6)+glint(330,262,9);
}
function hourglass(){
 const f=Math.max(0,T-6);const fall=T>6?(f*.8)%1:0;
 let s=curve([[184,90],[188,150],[232,200],[188,250],[184,310]])+curve([[296,90],[292,150],[248,200],[292,250],[296,310]]);
 s+=shape([[200,136],[280,136],[242,188]],{fill:GREY,w:5});
 s+=shape([[194,304],[222,272],[240,266],[258,272],[286,304]],{fill:GREY,w:5});
 s+=line([[240,206],[240,262]],{w:4,dash:'8 10'});
 if(T>6)s+=shape(ellipse(240,208+fall*52,3.5),{fill:INK,w:2,opacity:swellOf(fall)});
 return s+shape(rounded(164,70,152,20,10),{fill:GREY})+shape(rounded(164,310,152,20,10),{fill:GREY});
}
const swellOf=(f:number)=>Math.sin(clamp(f)*Math.PI);
function box(){
 const rise=(i:number)=>T>6?((T-6)*.35+i*.5)%1:.3+i*.3;
 let s=shape([[140,184],[172,150],[308,150],[340,184]],{fill:GREY});
 s+=shape([[140,184],[96,146],[124,122],[172,150]],{fill:PAPER})+shape([[340,184],[384,146],[356,122],[308,150]],{fill:PAPER});
 s+=shape([[140,184],[340,184],[330,322],[150,322]],{fill:PAPER});
 s+=shape(rounded(204,232,72,30,6),{w:5});
 for(let i=0;i<2;i++){const f=rise(i);s+=shape(ellipse(226+i*34,130-f*60,5+i*2),{w:4.5,opacity:swellOf(f)});}
 return s;
}
function jar(){
 const bub=(i:number,x:number,r:number)=>{const f=T>6?((T-6)*.3+i*.33)%1:.2+i*.3;return shape(ellipse(x,196-f*58,r),{w:4,opacity:swellOf(f)});};
 return shape(rounded(168,106,144,214,36))
  +blob([[182,212],[214,200],[248,214],[298,204],[298,290],[276,308],[204,308],[182,290]],{fill:GREY})
  +bub(0,214,7)+bub(1,256,5)+bub(2,236,4)
  +shape(rounded(184,76,112,32,10),{fill:GREY})+glint(348,112,10)+dot(126,150,5);
}
function folder(){
 const up=idle(1.2,5);
 return shape([[120,118],[196,118],[218,140],[360,140],[360,302],[120,302]],{fill:GREY})
  +shape(rounded(150,104-up,178,130,10),{fill:PAPER})
  +line([[176,136-up],[284,136-up]],{w:5})+line([[176,162-up],[250,162-up]],{w:5})
  +shape([[114,172],[366,172],[354,302],[126,302]],{fill:PAPER})
  +dot(392,110,6);
}
function plug(){
 const pulse=T>6?.5+.5*Math.sin((T-6)*2.4):1;
 return curve([[240,238],[240,276],[208,302],[160,300],[124,326],[104,346]])
  +line([[214,122],[214,80]],{w:9})+line([[266,122],[266,80]],{w:9})
  +shape(rounded(186,118,108,120,24),{fill:GREY})+line([[222,158],[258,158]],{w:5})
  +line([[196,56],[184,40]],{w:5,opacity:pulse})+line([[240,50],[240,30]],{w:5,opacity:pulse})+line([[284,56],[296,40]],{w:5,opacity:pulse});
}
function house(){
 const puff=(i:number)=>{const f=T>6?((T-6)*.3+i*.5)%1:.25+i*.4;return shape(ellipse(302+f*20,92-f*50,6+f*6),{w:4.5,opacity:swellOf(f)});};
 return line([[96,322],[384,322]])+shape([[160,196],[160,322],[320,322],[320,196]],{fill:PAPER})
  +line([[290,156],[290,112],[312,112],[312,176]])
  +shape([[132,206],[240,114],[348,206]],{fill:GREY})
  +shape(rounded(220,252,42,70,10),{fill:GREY})+shape(rounded(178,226,28,28,5),{w:5})+shape(rounded(284,226,28,28,5),{w:5})
  +puff(0)+puff(1);
}
function lifebuoy(){
 const a=idle(.6,.12),cx=240,cy=200;let s='';
 for(let i=0;i<4;i++){const b=a+i*Math.PI/2+Math.PI/4;s+=shape([...arc(cx,cy,100,100,b-.36,b+.36,8),...arc(cx,cy,50,50,b+.36,b-.36,8)],{fill:GREY,w:4.5});}
 return s+ring(cx,cy,100,{w:LINE})+ring(cx,cy,50,{w:LINE})+dot(372,86,6)+glint(98,96,10);
}
function profile(){
 const n1=idle(1.2,3);
 return shape(rounded(110,112,260,176,22))+shape(rounded(214,96,52,26,9),{fill:PAPER})
  +shape(ellipse(180,178+n1*.3,30),{fill:GREY})+shape(arc(180,262,52,40,Math.PI,TAU,18),{fill:GREY})
  +line([[248,168],[334,168]],{w:5})+line([[248,200],[316,200]],{w:5})+line([[248,232],[292,232]],{w:5});
}
function safe(){
 const a=T>6?(T-6)*.5:0;const cx=222,cy=196;
 return shape(rounded(128,88,224,214,20))+shape(rounded(150,110,180,170,12),{fill:GREY})
  +shape(ellipse(cx,cy,38),{fill:PAPER})+line([[cx,cy],[cx+Math.cos(a-Math.PI/2)*26,cy+Math.sin(a-Math.PI/2)*26]],{w:6})
  +line([[296,168],[296,224]],{w:10})
  +line([[158,302],[158,318]])+line([[322,302],[322,318]]);
}
function expired(){
 const m=T>6?(T-6)*.08:0,cx=226,cy=208;
 let s=shape(ellipse(cx,cy,98));
 for(let i=0;i<4;i++){const b=i*Math.PI/2;s+=line([[cx+Math.cos(b)*80,cy+Math.sin(b)*80],[cx+Math.cos(b)*88,cy+Math.sin(b)*88]],{w:5});}
 s+=line([[cx,cy],[cx,cy-58]])+line([[cx,cy],[cx+Math.cos(.5+m)*44,cy+Math.sin(.5+m)*44]])+shape(ellipse(cx,cy,6),{fill:INK,w:3});
 return s+shape(ellipse(318,120,30),{fill:GREY})+line([[306,108],[330,132]],{w:6})+line([[330,108],[306,132]],{w:6});
}
function wave(){
 // A bigger wave while the hand arrives, then a small one it keeps up.
 const a=T<6?.22*Math.sin(Math.max(0,T-.8)*4.2)*(1-clamp((T-.8)/4.4)):idle(2,.08);
 const h=(pts:P[])=>turn(pts,240,340,a);
 let s=shape(h(rounded(206,292,68,52,8)),{fill:PAPER});
 for(const [x,top] of [[196,134],[222,112],[248,110],[274,128]] as const)s+=shape(h(rounded(x-12,top,26,130,13)),{fill:GREY});
 s+=shape(h(turn(rounded(172,196,28,92,14),186,282,-.55)),{fill:GREY});
 s+=shape(h(rounded(186,196,104,108,34)),{fill:GREY});
 return s+curve([[330,98],[346,128],[338,160]],{w:5})+curve([[358,112],[374,146],[364,180]],{w:5,opacity:.6})
  +curve([[150,98],[134,128],[142,160]],{w:5});
}
function balance(){
 const tilt=idle(.9,.07);const beam=turn([[128,128],[352,128]],240,128,tilt);
 const pan=(end:P)=>{const [x,y]=end;return line([[x,y],[x-34,y+86]],{w:4.5})+line([[x,y],[x+34,y+86]],{w:4.5})+shape([...arc(x,y+86,46,26,0,Math.PI,16)],{fill:GREY});};
 return line([[200,322],[280,322]])+line([[240,322],[240,112]])+line(beam)+pan(beam[0])+pan(beam[1])+shape(ellipse(240,104,11),{fill:GREY,w:5});
}
function untangle(){
 const w=idle(1.4,6);
 return shape(ellipse(206,206,82),{fill:GREY})
  +curve([[146,160],[200,138],[258,168]],{w:5})+curve([[134,214],[206,184],[276,220]],{w:5})+curve([[156,262],[210,238],[262,268]],{w:5})
  +curve([[282,238],[326,272],[364,248],[346,220],[380,288],[410+w,312]])+dot(372,118,6)+glint(120,96,10);
}
function build(){
 const drop=T>6?idle(1.2,4):0;
 return line([[96,322],[384,322]])
  +shape(rounded(142,228,94,94,12))+shape([[166,300],[189,254],[212,300]],{w:5})
  +shape(rounded(244,228,94,94,12),{fill:GREY})
  +shape(rounded(193,130+drop,94,94,12),{fill:PAPER})+shape(ellipse(240,177+drop,20),{fill:GREY,w:5})
  +glint(344,112,11)+dot(128,170,6);
}
function discover(){
 const dx=idle(.8,6),dy=idle(.8,4,Math.PI/2);const m=(pts:P[])=>move(pts,dx,dy);
 return shape(m(pill(304,262,104,30,Math.PI/4)))
  +shape(m(ellipse(214,184,72)),{fill:GREY})+curve(m([[172,170],[180,146],[204,134]]),{w:6})
  +glint(352,98,12)+dot(384,152,5)+dot(118,300,6);
}
function learn(){
 const lift=idle(1.1,5);
 return blob([[240,132],[196,112],[140,112],[112,122],[112,292],[150,284],[198,288],[240,306]],{fill:GREY})
  +blob([[240,132],[284,112-lift],[340,112-lift],[368,122-lift*.6],[368,292],[330,284],[282,288],[240,306]],{fill:PAPER})
  +line([[240,132],[240,306]],{w:5})
  +line([[268,160],[340,154-lift*.5]],{w:5})+line([[268,190],[340,186]],{w:5})+line([[268,220],[318,218]],{w:5})
  +shape([[296,292],[296,338],[308,326],[320,338],[320,288]],{fill:GREY,w:5});
}
function orchestrate(){
 const a=T>6?(T-6)*.35:0;
 return shape(gear(200,214,78,9,a),{fill:GREY})+shape(ellipse(200,214,22),{fill:PAPER})
  +shape(gear(310,128,50,7,-a*78/50+.2),{fill:PAPER})+shape(ellipse(310,128,13),{w:5})
  +dot(368,262,6)+glint(116,104,10);
}
const scenes:Record<Scene,()=>string>={balance,untangle,build,discover,learn,orchestrate,sprout,kite,telescope,pencil,bridge,conversation,envelope,key,door,swap,invite,keypad,shield,lock,unlock,link,unlink,plane,hourglass,box,jar,folder,plug,house,lifebuoy,profile,safe,expired,wave};
/** One frame of a scene as SVG markup for a 480×390 stage. `boil` drives only the line boil, for still drawings. */
export function filmFrame(scene:Scene,seconds:number,_id:string,boilSeconds:number|null=null){T=Math.max(0,seconds);boil=boilSeconds;order=0;try{return scenes[scene]();}finally{boil=null}}
