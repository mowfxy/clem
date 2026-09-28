/** Authored 24 fps vector cels. Geometry is redrawn, never moved as a rigid SVG group. */
export type Scene='balance'|'untangle'|'build'|'discover'|'learn'|'orchestrate'|'sprout'|'kite'|'telescope'|'pencil'|'bridge'|'conversation'|'envelope'|'key'|'door'|'swap'|'invite'|'keypad'|'shield'|'lock'|'unlock'|'link'|'unlink'|'plane'|'hourglass'|'box'|'jar'|'folder'|'plug'|'house'|'lifebuoy'|'profile'|'safe'|'expired'|'wave'|'cards';
type P=[number,number];
const WHITE='#f3f2ec',BLUE='#8197e2',RED='#d87968';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{x=clamp(x);return x*x*(3-2*x)};
const phase=(t:number,a:number,b:number)=>ease((t-a)/(b-a));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const n=(v:number)=>v.toFixed(2);
function spline(points:P[],closed=false):P[]{const out:P[]=[];const N=points.length;for(let i=0;i<(closed?N:N-1);i++){const p0=points[(i-1+N)%N],p1=points[i],p2=points[(i+1)%N],p3=points[(i+2)%N];const a=!closed&&i===0?p1:p0,c=!closed&&i===N-2?p2:p3;for(let j=0;j<10;j++){const t=j/10,t2=t*t,t3=t2*t;out.push([0,1].map(k=>.5*((2*p1[k])+(-a[k]+p2[k])*t+(2*a[k]-5*p1[k]+4*p2[k]-c[k])*t2+(-a[k]+3*p1[k]-3*p2[k]+c[k])*t3)) as P);}}if(!closed)out.push(points.at(-1)!);return out;}
function polygon(points:P[],fill:string){return `<path fill="${fill}" d="M${points.map(p=>n(p[0])+','+n(p[1])).join('L')}Z"/>`;}
// Deliberate smooth ink pressure along a line, with tapered terminal caps.
function ink(points:P[],width=8,time=0,seed=0,closed=false){const ps=spline(points,closed),left:P[]=[],right:P[]=[];ps.forEach((p,i)=>{const prev=ps[Math.max(0,i-1)],next=ps[Math.min(ps.length-1,i+1)],dx=next[0]-prev[0],dy=next[1]-prev[1],len=Math.hypot(dx,dy)||1,u=i/(ps.length-1);const pressure=.86+.12*Math.sin(u*8+seed)+.06*Math.sin(u*17+time*1.1);const taper=closed?1:Math.min(1,.5+u*14,.5+(1-u)*14);const w=width*.5*pressure*taper;left.push([p[0]-dy/len*w,p[1]+dx/len*w]);right.push([p[0]+dy/len*w,p[1]-dx/len*w]);});return polygon([...left,...right.reverse()],WHITE);}
function shape(points:P[],fill:string){return polygon(spline(points,true),fill);}
function blob(x:number,y:number,r:number,t:number,color=BLUE,stretch=0){if(boilClock!==null)t+=Math.floor(boilClock*6)%4*.9;const ps:P[]=[];for(let i=0;i<40;i++){const a=i/40*Math.PI*2,rr=r*(1+.028*Math.sin(a*3+t*2)+.012*Math.cos(a*5-t));ps.push([x+Math.cos(a)*rr*(1+stretch),y+Math.sin(a)*rr/(1+stretch)]);}return polygon(ps,color);}
// Line boil: every stroke is redrawn slightly differently six times a second, cycling through four cels,
// so a drawing looks hand-inked even when nothing in it moves. A still drawing passes its own boil clock.
let boilClock:number|null=null;
function deform(points:P[],t:number,amount=1):P[]{const cel=Math.floor((boilClock??t)*6)%4;return points.map(([x,y],i)=>[x+amount*1.9*Math.sin(y*.031+cel*1.7+i*.2),y+amount*1.6*Math.sin(x*.027+cel*1.3+i*.3)]);}
function stroke(points:P[],t:number,width=8,seed=0,closed=false){return ink(deform(points,t),width,t,seed,closed);}
function rect(x:number,y:number,w:number,h:number,t:number,skew=0){return stroke([[x,y],[x+w*.5,y+skew*.5],[x+w,y+skew],[x+w-1,y+h*.5],[x+w-2,y+h],[x+w*.5,y+h-1],[x+1,y+h-2],[x,y+h*.5],[x,y]],t,8);}
function droplets(t:number,cx:number,cy:number,color:string,id:string,radius=34){
 // A stretched leading drop sheds a trail, which subsequently rejoins it. Three seconds of material change.
 const gather=phase(t,.8,2.8),emerge=phase(t,0,.35);let s='';
 for(let i=0;i<6;i++){const d=(5-i),delay=d*.07,g=phase(t,.8+delay,2.65+delay),spread=(1-g);const x=cx-16*d*spread-18*Math.sin(spread*Math.PI),y=cy-20*d*spread-20*Math.sin(spread*Math.PI);const r=(i===5?lerp(8,radius,gather):lerp(3+i*2.3,6,g))*emerge;s+=blob(x,y,r,t+i,color,i===5?(1-gather)*.62:0);}
 return `<g filter="url(#${id})">${s}</g>`;
}
function balance(t:number,id:string){
 const flex=phase(t,0,1.1)-phase(t,2.6,4.5),open=phase(t,2.6,4.5),bend=flex*11;
 const arm:P[]=[[175,257],[177,278],[160,297],[130,314],[103,339]];
 const receiving:P[]=[[404,338],[378,305],[374,277],[362,253],[344,239],[322,221],[312,199],[298,180],[286,183],[287,198],[301,221],[279,203],[265,187],[252,189],[251,201],[268,220],[287,244],[310,262]];

 const hand:P[]=[[76,250],[74,223],[77,191],[90,165],[102,167],[99,192],[91,225],[108,175],[122,154],[133,159],[127,184],[114,220],[143,171],[157,161],[163,170],[152,196],[137,223],[164,191],[183,184],[196,191],[192,205],[168,218],[154,237],[158,257],[172,265],[186,252],[194,232],[184,216],[169,229],[175,248],[192,208],[201,183],[204,154],[207,143],[210,158],[208,180],[219,162],[238,157],[246,165],[238,178],[211,184]];
 // Holding still is never quite still: the drop sways and the fingertip under it follows.
 const sway=idle(t,1.25,3.5);
 const pose=hand.map(([x,y])=>[x+(y<225?open*11:0)+(y<185&&x>196?sway*(185-y)/42:0),y+(x<165?bend*(225-y)/80:0)] as P);
 return stroke(receiving,t,9)+stroke(arm.map(([x,y])=>[x+Math.sin((y-150)/170)*bend*.5,y] as P),t,10)+stroke(pose,t,9)+droplets(t,207+open*2+sway,113,BLUE,id);
}
function untangle(t:number,id:string){
 const pull=phase(t,.5,3.2),finish=phase(t,3.2,4.7);const line:P[]=[];
 for(let i=0;i<=100;i++){const u=i/100,coil=Math.sin(u*Math.PI)*30*(1-pull);line.push([58+u*307+Math.sin(u*Math.PI*7)*coil,225+Math.cos(u*Math.PI*7)*coil-(45+idle(t,1.5,4))*Math.sin(u*Math.PI)*pull]);}
 const x=365+pull*16;const hand:P[]=[[x+20,296],[x+11,271],[x+8,245],[x-6,228],[x-23,219],[x-29,210],[x-20,200],[x-4,208],[x+8,225],[x+12,200],[x+21,193],[x+26,202],[x+22,222],[x+35,205],[x+45,206],[x+43,218],[x+32,236],[x+49,223],[x+59,227],[x+54,242],[x+41,261],[x+44,290]];
 let out=stroke(line,t,8)+stroke(hand,t,8)+stroke([[49,252],[38,271],[40,297],[66,313],[106,310],[131,288]],t,7);
 const bob=idle(t,1.5,-4);out+=droplets(t,235,113,RED,id);const turn=finish*Math.PI*.25+idle(t,.75,.1);const c:P[]=[];for(let i=0;i<32;i++){const a=i/32*Math.PI*2,rad=lerp(34,30/(Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))),finish);c.push([235+Math.cos(a+turn)*rad,113+bob+Math.sin(a+turn)*rad]);}if(t>2.8)out+=shape(c,RED);return out;
}
function build(t:number,id:string){
 const form=phase(t,1.6,3.7),press=phase(t,3.4,4)-phase(t,4,4.8);let out=stroke([[69,328],[155,329],[250,327],[403,329]],t,7);
 out+=rect(99,245,91,82,t,4)+rect(192,280,91,47,t,-4)+rect(129,166,83,79,t,-5);
 const cx=296;const top=179+press*7;let fill='';
 const diamond:P[]=[[cx-53,top],[cx,top-33],[cx+54,top],[cx,top+34]];
 const circle:P[]=diamond.map(([x,y])=>{const a=Math.atan2(y-221,x-cx);return [cx+Math.cos(a)*34,221+Math.sin(a)*34]});
 const pts=diamond.map((p,i)=>[lerp(circle[i][0],p[0],form),lerp(circle[i][1],p[1],form)] as P);
 if(t<2.8)fill=droplets(t,cx,221,BLUE,id);else fill=shape(pts,BLUE);
 out+=fill;{const g=cycle(t,3.4,.55),k=g/.3;if(t>6&&k<1){const x=lerp(cx-38,cx+38,ease(k)),h=13*(1-Math.abs(x-cx)/53);out+=faded(stroke([[x-.6*h,top+h],[x+.6*h,top-h]],t,5),swell(k)*.85);}}const h=69*form;out+=stroke([[cx-53,top],[cx-52,top+h],[cx,top+34+h],[cx+54,top+h],[cx+54,top]],t,8)+stroke([[cx,top+34],[cx,top+34+h]],t,7);
 const reach=phase(t,2.5,3.5)-phase(t,4,5.2),y=-46+reach*70-110*phase(t,4.4,5.4);
 // The hand that pressed the lid leaves upward; once it is off the stage it is not drawn at all.
 if(y>-148)out+=stroke([[373,57+y],[355,75+y],[339,95+y],[328,122+y],[331,133+y],[341,129+y],[351,112+y],[346,141+y],[350,148+y],[361,138+y],[371,115+y],[371,138+y],[379,143+y],[388,128+y],[403,91+y]],t,8);
 return out;
}
function discover(t:number,id:string){
 const scan=phase(t,.6,3.6),cx=lerp(156,286,scan),cy=146+71*scan,x=cx+idle(t,1.1,7),y=cy+idle(t,2.2,3.5);let out=stroke([[99,72],[285,88],[271,295],[77,279],[99,72]],t,8)+stroke([[119,54],[308,67],[299,269]],t,7);
 for(let i=0;i<4;i++){const yy=118+i*39;out+=stroke([[121-i*3,yy],[172,yy+3],[237-i*9,yy+8]],t,6);}
 const ring:P[]=[];for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;ring.push([x+Math.cos(a)*61,y+Math.sin(a)*61]);}out+=stroke(ring,t,9)+stroke([[x+43,y+45],[x+73,y+76],[x+108,y+110]],t,16);
 const reveal=phase(t,3.5,4.7);const check:P[]=[[cx-27,cy+2],[cx-8,cy+23],[cx+30,cy-22]];const checkPoints=spline(check).slice(0,Math.max(2,Math.floor(21*reveal)));if(reveal>0)out+=ink(checkPoints,10,t).replaceAll(WHITE,BLUE);
 if(t<3.5){for(let i=0;i<4;i++){const angle=t*2+i*.28;out+=blob(x+Math.cos(angle)*20,y+Math.sin(angle)*13,3+i*1.5,t,BLUE);}}
 return out;
}
function learn(t:number,id:string){
 let out=stroke([[72,302],[72,169],[123,153],[178,157],[236,179],[289,157],[349,153],[407,168],[407,301],[352,293],[293,301],[237,324],[179,304],[125,294],[72,302]],t,9)+stroke([[237,179],[238,240],[237,324]],t,7);
 const turn=phase(t,.3,2.7),edge=lerp(398,85,turn),arch=Math.sin(turn*Math.PI)*64;
 const page:P[]=[[237,179],[lerp(304,176,turn),151-arch],[edge,168-arch*.25],[edge,299],[lerp(303,175,turn),295-arch*.25],[237,324]];
 if(turn<1)out+=shape(page,'#171717')+stroke([...page,page[0]],t,7);
 const words=phase(t,2,3.1);for(let side=0;side<2;side++)for(let i=0;i<3;i++){const x=side?268:101,y=199+i*34;out+=stroke([[x,y],[x+30*words,y-5],[x+92*words,y+5]],t,5);}
 const light=phase(t,2.5,4);const bulb:P[]=[[225,126],[224,110],[209,89],[209,65],[227,49],[250,49],[269,68],[267,92],[252,109],[251,126],[225,126]];
 const glow=t>6?(1-Math.cos((t-6)*1.8))*.5:0;
 if(light>0)out+=faded(blob(239,82,lerp(34,40,glow)*light,t,RED),(.1+.08*glow)*light);
 out+=stroke(bulb,t,7)+stroke([[229,139],[249,139]],t,6);
 if(light>0)out+=droplets((t-2.1)*1.5,239,79,RED,id,15);
 if(light>=1)for(const a of [-2.5,-1.57,-.64]){const r0=48+2*glow,r1=58+4*glow;out+=faded(stroke([[239+Math.cos(a)*r0,82+Math.sin(a)*r0],[239+Math.cos(a)*r1,82+Math.sin(a)*r1]],t,5),.55+.45*glow);}
 return out;
}
function orchestrate(t:number,id:string){
 const merge=phase(t,.5,2.8),resolve=phase(t,3,4.8);const upper:P[]=[[111,105],[171,126],[204,174],[240,190],[294,161],[330,118],[371,100]],lower:P[]=[[111,285],[168,263],[206,207],[240,190],[290,224],[330,276],[374,286]];
 let out=stroke(upper,t,7)+stroke(lower,t,7);
 out+=rect(68,62,78,79,t,2)+rect(335,247,78,79,t,-2);
 const x1=lerp(111,240,merge),y1=lerp(285,190,merge),x2=lerp(371,240,merge),y2=lerp(100,190,merge);
 const fused=`<g filter="url(#${id})">${blob(x1,y1,lerp(33,28,merge),t,RED,.25*Math.sin(merge*Math.PI))}${blob(x2,y2,lerp(37,28,merge),t,BLUE,.2*Math.sin(merge*Math.PI))}</g>`;out+=`<g opacity="${1-resolve}">${fused}</g>`;out+=blob(371,100,37*resolve,t,BLUE)+shape([[111,252],[144,285],[111,318],[78,285]],RED).replace('<path ',`<path opacity="${resolve}" `);
 if(resolve>0){const cx=lerp(240,373,resolve),cy=lerp(190,286,resolve);out+=blob(cx,cy,30*(1-resolve),t,BLUE,.5*Math.sin(resolve*Math.PI));for(let i=0;i<3;i++)out+=stroke([[349,267+i*17],[349+44*resolve,267+i*17]],t,5);}
 // Work keeps flowing through the junction to each result.
 if(t>6)for(const [line,color,o] of [[upper,BLUE,0],[lower,RED,.5],[upper,BLUE,.5],[lower,RED,0]] as const){const f=cycle(t,3,o),[px,py]=along(line,lerp(.2,.84,f));out+=faded(blob(px,py,8,t,color),swell(f)*Math.min(1,t-6));}
 return out;
}

// Homepage-only cartoons: staged gestures with anchored supports and a living-ink hold.
function sprout(t:number,_id:string){const grow=phase(t,.4,2.5),bloom=phase(t,2,3.7),nod=(phase(t,3.6,4)-phase(t,4,4.8))*12;let out=stroke([[153,265],[161,327],[237,340],[307,325],[315,265]],t,11)+stroke([[144,262],[226,252],[324,262],[244,276],[144,262]],t,10);const sway=idle(t,1.2,6),bend=(pts:P[])=>pts.map(([x,y])=>[x+sway*Math.pow(Math.max(0,257-y)/156,1.6),y] as P);out+=stroke(bend([[236,257],[233-nod,220-46*grow],[246-nod,220-119*grow]]),t,10);const left:P[]=[[239,203],[204-48*bloom,187-40*bloom],[185-36*bloom,210],[239,219]];const right:P[]=[[240,159],[278+42*bloom,121],[301+24*bloom,168],[237,184]];out+=shape(bend(left),WHITE)+shape(bend(right),BLUE);out+=stroke([[234,266],[213,292],[226,310]],t,4);if(t>3){const shine=t>6?.7+.3*Math.cos((t-6)*2):1;out+=faded(stroke([[190,83],[180,65]],t,6)+stroke([[248,68],[253,45]],t,6)+stroke([[294,83],[312,66]],t,6),shine);}return out;}
function kite(t:number,_id:string){const open=phase(t,.4,2.6),catching=phase(t,2.6,3.1)-phase(t,3.1,4.1),cx=255+catching*13+(t>6?Math.sin((t-6)*Math.PI/2)*9:0),cy=125+(t>6?(1-Math.cos((t-6)*Math.PI/2))*3:0);let out=stroke([[109,313],[140,279],[145,250],[162,233],[181,233],[184,244],[166,258],[190,249],[202,255],[189,271],[171,287],[170,314]],t,9);out+=stroke([[181,245],[218,236],[207,211],[246,189],[cx,cy+60]],t,6);const wing=25+48*open;out+=shape([[cx,cy-72],[cx+wing,cy],[cx,cy+64],[cx-wing,cy]],BLUE);out+=stroke([[cx,cy-72],[cx,cy+64]],t,6)+stroke([[cx-wing,cy],[cx+wing,cy]],t,6);const flap=(k:number)=>t>6?Math.sin((t-6)*3.4-k*1.2)*3.5*k*Math.min(1,t-6):0;out+=stroke([[cx-1,cy+65],[cx+17+flap(1),cy+88],[cx-9+flap(2),cy+108],[cx+11+flap(3),cy+127]],t,7);return out;}
function telescope(t:number,_id:string){const focus=phase(t,.7,2.5),blink=phase(t,3,3.2)-phase(t,3.2,3.7);let out=stroke([[212,235],[172,330],[212,316],[245,239],[283,331]],t,10);out+=stroke([[136,188],[177,132],[320,202],[285,261],[136,188]],t,12)+stroke([[167,134],[156,113],[174,95],[210,120]],t,10)+stroke([[303,202],[325+22*focus,215],[306+22*focus,247],[287,237]],t,10);out+=blob(119,91,27,t,RED,.12*blink);out+=stroke([[92,48],[83,35]],t,5)+stroke([[68,90],[45,88]],t,5)+stroke([[115,46],[118,25]],t,5);return out;}
function pencil(t:number,_id:string){const write=phase(t,.6,3.6),x=147+write*168,y=206+Math.sin(write*Math.PI*2)*17-(t>6?Math.abs(Math.sin((t-6)*2.4))*7:0);let out=stroke([[79,103],[284,92],[312,319],[99,333],[79,103]],t,9);out+=stroke([[110,139],[181,133]],t,6);const line:P[]=[];for(let i=0;i<=35*write;i++){line.push([128+i*4.7,254+Math.sin(i*.4)*13]);}if(line.length>1)out+=stroke(line,t,8);out+=shape([[x,y],[x+23,y-59],[x+84,y-137],[x+107,y-115],[x+47,y-34]],BLUE)+stroke([[x,y],[x+23,y-59],[x+47,y-34],[x,y]],t,7)+stroke([[x+71,y-121],[x+94,y-101]],t,7);return out;}
function bridge(t:number,_id:string){const join=phase(t,.7,3),spring=phase(t,3,3.25)-phase(t,3.25,4);let out=stroke([[61,303],[150,303],[161,272],[162,222]],t,11)+stroke([[416,303],[329,303],[319,273],[318,222]],t,11);out+=stroke([[162,224],[189,183+spring*12],[239,168+spring*18],[289,184+spring*12],[318,224]],t,12);out+=stroke([[187,192],[188,279],[164,280]],t,7)+stroke([[291,192],[291,279],[318,280]],t,7);out+=blob(123+join*228,166-Math.sin(join*Math.PI)*71,29,t,RED,.22*spring);out+=stroke([[64,337],[123,332],[175,339],[245,333],[306,339],[369,332],[416,337]],t,5);return out;}
function conversation(t:number,_id:string){const reply=phase(t,1,2.8),squash=phase(t,2.8,3.1)-phase(t,3.1,3.8);let out=stroke([[66,94],[160,73],[239,100],[245,168],[214,196],[171,191],[140,221],[142,189],[77,181],[66,94]],t,10);out+=stroke([[255,183],[323,163],[398,186],[405,253],[379,281],[353,279],[361,311],[320,284],[258,268],[255,183]],t,10);for(let i=0;i<3;i++){const k=clamp((cycle(t,1.5)-i*.14)/.36);out+=blob(111+i*44,135-(t>6?Math.sin(k*Math.PI)*7:0),10,t,WHITE);}const tick:P[]=[[285,226],[307,245+8*squash],[366,202]];if(reply>0)out+=ink(spline(tick).slice(0,Math.max(2,Math.floor(21*reply))),10,t).replaceAll(WHITE,BLUE);return out;}
// ───── Situational scenes: one per moment (emails, sign-in, settings). Same ink, blue and coral as above. ─────
const PAPER='#1a1a19';
const arc=(cx:number,cy:number,r:number,a0:number,a1:number,steps=28,ry=r):P[]=>Array.from({length:steps+1},(_,i)=>{const a=a0+(a1-a0)*i/steps;return [cx+Math.cos(a)*r,cy+Math.sin(a)*ry] as P;});
const quad=(x:number,y:number,w:number,h:number):P[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
// Extra points along each edge keep the ink straight and its corners tight, as rect() does.
const sharp=(pts:P[]):P[]=>pts.flatMap((p,i)=>i===pts.length-1?[p]:[.12,.5,.88].map(f=>[p[0]+(pts[i+1][0]-p[0])*f,p[1]+(pts[i+1][1]-p[1])*f] as P).reduce<P[]>((a,q)=>[...a,q],[p]));
const faded=(svg:string,o:number)=>svg.replaceAll('<path ',`<path opacity="${n(clamp(o))}" `);
const tint=(svg:string,color:string)=>svg.replaceAll(WHITE,color);
/** Draws a line progressively, like a pen travelling along it. */
function pen(points:P[],t:number,k:number,width=8,color=WHITE){if(k<=0)return '';const s=spline(points);const svg=ink(s.slice(0,Math.max(2,Math.ceil(s.length*clamp(k)))),width,t);return color===WHITE?svg:tint(svg,color);}
const tickMark=(x:number,y:number,s:number,t:number,k:number,color=BLUE,w=10)=>pen([[x-s,y],[x-s*.3,y+s*.7],[x+s,y-s*.8]],t,k,w,color);
/** Three short rays that burst out once something lands. */
function burst(cx:number,cy:number,r:number,t:number,at:number,spread=.75){const k=phase(t,at,at+.45);if(k<=0)return '';let s='';for(let i=-1;i<=1;i++){const a=-Math.PI/2+i*spread,glint=t>6?(1-Math.cos((t-6)*2.2-i*.9))*.5:0,r0=r+2*glint,r1=r+16*k-3*glint;s+=stroke([[cx+Math.cos(a)*r0,cy+Math.sin(a)*r0],[cx+Math.cos(a)*r1,cy+Math.sin(a)*r1]],t,5);}return s;}
const idle=(t:number,speed=1.4,amp=1)=>t>6?Math.sin((t-6)*speed)*amp:0;
// Idle loops run forward from t=6, the finished drawing. cycle() is the position within one loop, 0→1;
// swell() fades a looping element in and out so it never pops at the seam.
const cycle=(t:number,period:number,offset=0)=>((Math.max(0,t-6)/period+offset)%1+1)%1;
const swell=(f:number)=>Math.sin(clamp(f)*Math.PI);
/** Rotates points about a pivot, for parts that swing or turn. */
const turnAbout=(pts:P[],cx:number,cy:number,a:number):P[]=>pts.map(([x,y])=>[cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)]);
/** Samples a spline at fraction f of its length, for things that travel along a drawn line. */
const along=(pts:P[],f:number):P=>{const s=spline(pts),x=clamp(f)*(s.length-1),i=Math.min(s.length-2,Math.floor(x)),u=x-i;return [lerp(s[i][0],s[i+1][0],u),lerp(s[i][1],s[i+1][1],u)];};
const floor=(t:number,x0=70,x1=410,y=330)=>stroke([[x0,y],[(x0+x1)/2,y+1],[x1,y]],t,6);

function envelope(t:number,_id:string){
 const open=phase(t,.4,1.3),rise=phase(t,1.1,2.4),check=phase(t,2.5,3.2),x=140,y=200,w=200,h=120,tip=lerp(262,112,open),ly=lerp(214,92,rise)+idle(t,1.6,3);
 let s=polygon(quad(x,y,w,h),PAPER)+rect(x,y,w,h,t);
 const flap=polygon([[x,y],[x+w/2,tip],[x+w,y]],PAPER)+stroke(sharp([[x,y],[x+w/2,tip],[x+w,y]]),t,8)+blob(x+w/2,tip-6,13*(1-open*.35),t,RED);
 if(open>.5)s+=flap;
 s+=polygon(quad(x+20,ly,w-40,112),PAPER)+rect(x+20,ly,w-40,112,t,2);
 if(rise>.3)s+=stroke([[x+46,ly+28],[x+110,ly+30]],t,5)+stroke([[x+46,ly+48],[x+146,ly+47]],t,5);
 s+=tickMark(x+w/2,ly+80,20,t,check);
 s+=polygon([[x,y+22],[x+w/2,y+74],[x+w,y+22],[x+w,y+h],[x,y+h]],PAPER)+stroke([[x,y+22],[x+w/2,y+74],[x+w,y+22]],t,7)+rect(x,y,w,h,t);
 if(open<=.5)s+=flap;
 return s+burst(x+w/2,ly-4,18,t,3.1)+floor(t,90,390,340);
}
function key(t:number,_id:string){
 const slide=phase(t,.3,1.8),turn=phase(t,1.9,2.5),lift=26*phase(t,2.6,3)-6*phase(t,3,3.4),kx=lerp(10,160,slide);
 let s=stroke([[222,202],[222,190-lift],...arc(260,190-lift,38,Math.PI,Math.PI*2,20),[298,190-lift],[298,204-lift]],t,11);
 const ry=22*Math.max(.18,Math.abs(Math.cos(turn*Math.PI)));
 s+=shape(arc(kx,240,22,0,Math.PI*2,30,ry),RED)+blob(kx,240,7*ry/22,t,PAPER)+stroke([[kx+22,240],[kx+104,240]],t,9);
 const tooth=turn<.5?1:-1;s+=stroke([[kx+80,240],[kx+80,240+14*tooth],[kx+90,240+14*tooth],[kx+90,240+7*tooth],[kx+98,240+7*tooth]],t,7);
 s+=polygon(quad(200,190,120,100),PAPER)+rect(200,190,120,100,t,3);
 s+=blob(260,228,10,t,BLUE)+polygon([[254,232],[266,232],[269,258],[251,258]],BLUE);
 return s+burst(260,150-lift,20,t,3)+floor(t,120,380,330);
}
function door(t:number,_id:string){
 const a=phase(t,.4,1.8)*1.25,k=Math.sin(a),lx=180+120*Math.cos(a),glow=phase(t,.6,1.9)*(1+idle(t,1.2,.12));
 let s=faded(polygon([[lx,320],[300,320],[360+40*k,388],[lx+20,388]],BLUE),.22*glow);
 s+=faded(polygon([[180,100],[300,100],[300,320],[180,320]],BLUE),.55*glow);
 s+=polygon([[180,100],[lx,100-22*k],[lx,322+8*k],[180,320]],PAPER)+stroke(sharp([[180,100],[lx,100-22*k],[lx,322+8*k],[180,320],[180,100]]),t,8);
 s+=blob(lx-14*Math.cos(a)-4,214,6,t,RED);
 s+=stroke(sharp([[180,322],[180,98],[300,98],[300,322]]),t,10)+floor(t,60,420,322);
 const up=phase(t,2,3.4),dx=lerp(250,356,up),dy=lerp(270,82,up)+idle(t,1.3,4);
 if(up>0)s+=blob(dx,dy,11,t,RED,.35*(1-up))+faded(blob(dx-18*up,dy+30*up,5,t,RED),.6*(1-up));
 return s+burst(dx,dy,18,t,3.4);
}
function smallEnvelope(x:number,y:number,t:number,accent:string){return polygon(quad(x,y,110,72),PAPER)+rect(x,y,110,72,t)+stroke([[x+2,y+4],[x+55,y+40],[x+108,y+4]],t,6)+blob(x+55,y+46,7,t,accent);}
function swap(t:number,_id:string){
 const k=phase(t,.9,2.6),lift=Math.sin(k*Math.PI),b=idle(t,1.4,3);
 let s=pen([[196,96],[262,86],[318,128]],t,phase(t,.2,.8),6)+pen([[318,128],[306,112]],t,phase(t,.7,.9),6)+pen([[318,128],[300,130]],t,phase(t,.7,.9),6);
 s+=pen([[284,318],[218,328],[162,286]],t,phase(t,.4,1),6)+pen([[162,286],[174,302]],t,phase(t,.9,1.1),6)+pen([[162,286],[180,284]],t,phase(t,.9,1.1),6);
 s+=smallEnvelope(lerp(80,290,k),lerp(118,212,k)-80*lift+b,t,BLUE)+smallEnvelope(lerp(290,80,k),lerp(212,118,k)+80*lift-b,t,RED);
 return s+burst(345,200+b,40,t,2.7);
}
function invite(t:number,_id:string){
 const o=140*(1-phase(t,.4,1.8)),cups=phase(t,1.8,2.3),lamp=phase(t,2.5,3.1);
 let s=faded(blob(240,96,58*lamp,t,BLUE),.14)+pen([[240,0],[240,74]],t,lamp*1.6,5)+blob(240,92,20*lamp,t,BLUE);
 s+=floor(t,50,430,332)+stroke([[160,232],[240,230],[320,232]],t,10)+stroke([[180,234],[176,332]],t,8)+stroke([[300,234],[304,332]],t,8);
 s+=stroke([[90,264],[140,262]],t,8)+stroke([[92,264],[86,182]],t,8)+stroke([[96,266],[94,332]],t,7)+stroke([[136,266],[138,332]],t,7);
 s+=stroke([[340+o,262],[390+o,264]],t,8)+stroke([[388+o,264],[394+o,182]],t,8)+stroke([[344+o,266],[342+o,332]],t,7)+stroke([[384+o,266],[386+o,332]],t,7);
 s+=shape([[346+o,252],[384+o,252],[386+o,262],[344+o,262]],RED);
 for(const x of [204,276]){const y=lerp(-30,0,cups);if(cups>0){s+=stroke([[x-13,206+y],[x-10,228+y],[x+10,228+y],[x+13,206+y]],t,6)+stroke([[x+13,212+y],[x+22,216+y],[x+12,224+y]],t,4);if(t>2.4)s+=stroke([[x,194],[x+5+Math.sin(t*3+x)*2,184],[x-2,172]],t,4);}}
 return s;
}
function keypad(t:number,_id:string){
 let s='';
 for(let i=0;i<6;i++){const x=66+i*60,k=phase(t,.4+i*.3,.55+i*.3);s+=rect(x,140,50,66,t,i%2?2:-2);if(k>0)s+=blob(x+25,173,10*k*(1+(t>6?.1*Math.sin((t-6)*2.4-i*.7)*Math.min(1,t-6):0)),t,BLUE);else if(Math.floor(t*2.5)%2===0&&(i===0||phase(t,.4+(i-1)*.3,.55+(i-1)*.3)>=1))s+=stroke([[x+25,156],[x+25,190]],t,4);}
 s+=tickMark(240,290,26,t,phase(t,2.4,3));
 return s;
}
function shield(t:number,_id:string){
 const pts:P[]=[[240,64],[322,96],[318,196],[292,262],[240,302],[188,262],[162,196],[158,96]],k=phase(t,.2,1.6),b=idle(t,1.2,2);
 const moved=pts.map(([x,y])=>[x,y+b] as P);
 let s=faded(shape(moved,BLUE),phase(t,1.3,2)*.95);
 s+=k<1?pen([...moved,moved[0]],t,k,10):stroke(moved,t,10,0,true);
 s+=tickMark(240,182+b,34,t,phase(t,2,2.7),WHITE,12);
 return s+burst(240,64+b,16,t,2.7)+floor(t,140,340,338);
}
function padlock(t:number,closing:boolean){
 const lift=closing?lerp(30,0,phase(t,1.9,2.3))+3*(phase(t,2.3,2.45)-phase(t,2.45,2.6)):lerp(0,30,phase(t,1.3,1.8))+idle(t,1.5,1.5);
 let s=stroke([[208,196],[208,185-lift],...arc(240,185-lift,32,Math.PI,Math.PI*2,18),[272,185-lift],[272,198-(closing?0:lift)]],t,11);
 s+=polygon(quad(186,185,108,100),PAPER)+rect(186,185,108,100,t,2);
 for(let i=0;i<6;i++){const x=214+(i%3)*26,y=218+Math.floor(i/3)*30,on=closing?phase(t,.3+i*.22,.45+i*.22):1-phase(t,.3+(5-i)*.15,.45+(5-i)*.15);s+=on>.05?blob(x,y,7*on*(closing&&t>6?1+.12*Math.sin((t-6)*2.4-i*.6)*Math.min(1,t-6):1),t,BLUE):stroke(arc(x,y,6,0,Math.PI*2,10),t,3);}
 if(closing)s+=burst(240,140,22,t,2.6);
 else{const d=phase(t,1.9,2.6);s+=blob(318,lerp(120,150,d)+idle(t,1.8,3),11*d,t,RED);}
 return s+floor(t,130,350,300);
}
function lock(t:number,_id:string){return padlock(t,true);}
function unlock(t:number,_id:string){return padlock(t,false);}
function chain(cx:number,cy:number,rot:number,t:number){const pts:P[]=[...arc(-40,0,24,Math.PI/2,Math.PI*1.5,12),...arc(40,0,24,-Math.PI/2,Math.PI/2,12)].map(([x,y])=>[cx+x*Math.cos(rot)-y*Math.sin(rot),cy+x*Math.sin(rot)+y*Math.cos(rot)] as P);return stroke(pts,t,12,0,true);}
function links(t:number,joining:boolean){
 const k=joining?phase(t,.4,2):1-phase(t,.8,2.2),b=idle(t,1.3,3);
 let s=chain(lerp(118,212,k),200+b,-.35,t)+chain(lerp(362,268,k),200-b,.35,t);
 if(joining)s+=blob(240,200,11*phase(t,2,2.4),t,RED)+burst(240,176,20,t,2.3);
 else{const d=phase(t,1.2,2.2);s+=blob(240-50*d,200+30*d,6*(1-d*.3),t,RED)+blob(240+50*d,200-30*d,6*(1-d*.3),t,BLUE)+(d>0&&d<1?burst(240,190,12,t,1.2,1.1):'');}
 return s+floor(t,110,370,300);
}
function link(t:number,_id:string){return links(t,true);}
function unlink(t:number,_id:string){return links(t,false);}
function plane(t:number,_id:string){
 const path=spline([[40,320],[110,260],[140,160],[220,100],[300,130],[340,210],[378,262]]),u=phase(t,.3,2.8),at=(v:number)=>path[Math.min(path.length-1,Math.floor(clamp(v)*(path.length-1)))];
 let s=stroke(sharp([[316,256],[328,312],[432,312],[444,256]]),t,9)+stroke(sharp([[322,282],[354,282],[364,296],[394,296],[404,282],[438,282]]),t,5);
 for(let i=1;i<=9;i++){const v=u-i*.045;if(v>0)s+=faded(blob(...at(v),2.6,t,WHITE),.55-i*.05);}
 const land=phase(t,2.6,3),[px,py]=at(u),[x2,y2]=at(u+.01),x=lerp(px,378,land),y=lerp(py,266,land)+idle(t,1.6,2),a=lerp(Math.atan2(y2-y,x2-x),-.18,land),sc=1.35-.3*land;
 {const r=(p:P):P=>[x+(p[0]*Math.cos(a)-p[1]*Math.sin(a))*sc,y+(p[0]*Math.sin(a)+p[1]*Math.cos(a))*sc];s+=shape([[30,0],[-22,-18],[-8,0]].map(p=>r(p as P)),BLUE)+stroke(sharp([[30,0],[-22,18],[-8,0],[30,0],[-22,-18],[-8,0]].map(p=>r(p as P))),t,6);}
 const badge=phase(t,2.9,3.3);s+=blob(444,248+idle(t,2,2),12*badge,t,RED);
 return s+burst(444,240,14,t,3.2);
}
function hourglass(t:number,_id:string){
 const L=1-.86*phase(t,.3,3.2),half=(y:number)=>y<140?40:Math.max(2,40*(195-y)/55),y1=195-100*L,w=half(y1);
 let s='';
 if(L>.02)s+=shape([[240-w,y1],[240+w,y1],[240,196]],RED);
 const pile=1-L;if(pile>.02)s+=shape([[240-46*Math.min(1,pile*1.6),316],[240+46*Math.min(1,pile*1.6),316],[240,316-78*pile]],RED);
 if(L>.02&&L<.99)s+=tint(ink([[240,196],[240,(196+316-78*pile)/2],[240,316-78*pile]],4,t),RED);
 s+=stroke([[180,70],[300,70]],t,11)+stroke([[180,320],[300,320]],t,11);
 s+=stroke([[198,74],[200,140],[234,195],[200,250],[198,316]],t,8)+stroke([[282,74],[280,140],[246,195],[280,250],[282,316]],t,8);
 s+=tickMark(340,110,20,t,phase(t,3.2,3.8));
 if(t>6)for(let i=0;i<3;i++){const f=cycle(t,1.2,i/3),top=316-78*pile;s+=faded(blob(240,lerp(200,top-2,f*f),2.6,t,RED),Math.min(1,f*6)*(1-f*f)*Math.min(1,t-6));}
 return s;
}
function box(t:number,_id:string){
 const sink=phase(t,.2,1.1),l=1-phase(t,1.1,1.8),r=1-phase(t,1.5,2.2),tape=phase(t,2.4,3);
 let s='';
 if(sink<1)s+=blob(215,lerp(150,230,sink),16,t,BLUE)+rect(248,lerp(120,220,sink),36,46,t,4);
 s+=polygon([[170,200],[240,200],[240-8*l,200-70*l],[170-34*l,200-60*l]],PAPER)+stroke([[170,200],[170-34*l,200-60*l],[240-8*l,200-70*l],[240,200]],t,8);
 s+=polygon([[240,200],[310,200],[310+34*r,200-60*r],[240+8*r,200-70*r]],PAPER)+stroke([[240,200],[240+8*r,200-70*r],[310+34*r,200-60*r],[310,200]],t,8);
 s+=polygon(quad(170,200,140,112),PAPER)+rect(170,200,140,112,t,2);
 s+=pen([[240,200],[240,226],[240,252]],t,tape,11,RED)+rect(188,262,46,30,t,1)+stroke([[196,272],[222,272]],t,3);
 return s+burst(240,176,14,t,3)+floor(t,110,370,318);
}
function jar(t:number,_id:string){
 const lid=phase(t,2.6,3.1);let s=faded(blob(240,262,70,t,BLUE),.1*phase(t,2,3));
 for(let i=0;i<3;i++){const k=phase(t,.2+i*.3,.9+i*.3);if(k>0&&k<1)s+=rect(214+i*18,lerp(-30,236,k),22,28,t,i-1);}
 s+=droplets(Math.max(0,t-1.1),240,272,BLUE,_id,28);
 s+=stroke([[180,124],[180,150],[168,172],[168,308],[182,322],[298,322],[312,308],[312,172],[300,150],[300,124]],t,9);
 const ly=lerp(56,100,lid),tilt=(1-lid)*16;
 s+=shape([[172,ly+tilt],[308,ly-tilt],[308,ly+22-tilt],[172,ly+22+tilt]],RED)+stroke([[172,ly+tilt],[308,ly-tilt],[308,ly+22-tilt],[172,ly+22+tilt],[172,ly+tilt]],t,6);
 return s+burst(240,88,16,t,3.1)+floor(t,120,360,334);
}
function folder(t:number,_id:string){
 let s=polygon([[140,132],[208,132],[226,152],[340,152],[340,300],[140,300]],PAPER)+stroke(sharp([[140,300],[140,132],[208,132],[226,152],[340,152],[340,300]]),t,8);
 for(const [i,x] of [[0,172],[1,232]] as const){const k=phase(t,.3+i*.35,1.3+i*.35),y=lerp(20,150,k)-(t>6?(1-Math.cos((t-6)*1.3+i*Math.PI))*2.5*Math.min(1,t-6):0);s+=polygon(quad(x,y,86,108),PAPER)+rect(x,y,86,108,t,i?3:-3)+stroke([[x+16,y+26],[x+60,y+28]],t,4)+stroke([[x+16,y+44],[x+70,y+43]],t,4);}
 s+=polygon([[128,184],[352,184],[340,300],[140,300]],PAPER)+stroke(sharp([[128,184],[352,184],[340,300],[140,300],[128,184]]),t,9);
 s+=shape([[168,210],[222,210],[222,226],[168,226]],RED);
 return s+burst(340,140,18,t,2)+floor(t,100,380,318);
}
function plug(t:number,_id:string){
 const o=128*phase(t,.4,1.8),o2=36*phase(t,.4,1.8),spark=phase(t,1.8,2.2);
 let s=stroke([[62+o,200],[30,214],[8,240]],t,8)+stroke([[418-o2,200],[450,188],[478,170]],t,8);
 s+=polygon(quad(60+o,168,86,64),PAPER)+rect(60+o,168,86,64,t,2)+stroke([[146+o,184],[176+o,184]],t,8)+stroke([[146+o,216],[176+o,216]],t,8);
 s+=polygon(quad(332-o2,164,86,72),PAPER)+rect(332-o2,164,86,72,t,-2)+blob(346-o2,184,6,t,BLUE)+blob(346-o2,216,6,t,BLUE);
 if(spark>0)s+=blob(286,200,12*Math.sin(spark*Math.PI)+(spark>=1?5:0),t,RED)+burst(286,160,14,t,1.9,.9);
 if(t>2.2){const f=((t-2.2)*.5)%1;s+=faded(blob(lerp(8,62+o,f),lerp(240,200,f),4,t,BLUE),swell(f));}
 return s;
}
function house(t:number,_id:string){
 const roof=phase(t,.2,1),walls=phase(t,.6,1.5),light=phase(t,1.6,2.3),light2=phase(t,2.2,2.9);
 let s=faded(shape(quad(172,216,40,34),RED),light)+faded(shape(quad(268,216,40,34),BLUE),light2);
 s+=pen(sharp([[126,192],[240,98],[354,192]]),t,roof,10)+pen(sharp([[152,184],[152,320],[328,320],[328,184]]),t,walls,9);
 if(walls>=1)s+=rect(172,216,40,34,t)+rect(268,216,40,34,t)+rect(220,256,40,64,t)+blob(252,290,4,t,RED)+stroke(sharp([[290,142],[290,112],[310,112],[310,158]]),t,7);
 if(t>1.5)for(let i=0;i<3;i++){const f=((t*.35)+i/3)%1;s+=faded(blob(300+12*f+Math.sin(f*6+i)*6,100-60*f,5+6*f,t,WHITE),.5*(1-f)*Math.min(1,f*6));}
 return s+floor(t,80,400,322);
}
function lifebuoy(t:number,_id:string){
 const drop=phase(t,.2,1.1),cy=lerp(-90,222,drop)+(drop>=1?Math.sin((t-1.1)*1.8)*5*Math.min(1,(t-1.1)):0),sp=phase(t,1.1,1.9);
 let s='';
 for(let q=0;q<4;q+=2){const a0=q*Math.PI/2+.4;s+=polygon([...arc(240,cy,68,a0,a0+Math.PI/2,10),...arc(240,cy,36,a0+Math.PI/2,a0,10)],RED);}
 s+=stroke(arc(240,cy,68,0,Math.PI*2,36),t,9)+stroke(arc(240,cy,36,0,Math.PI*2,24),t,8);
 s+=stroke([[296,cy-40],[340,cy-110],[420,cy-150]],t,5);
 if(sp>0&&sp<1)for(const [dx,h] of [[-60,50],[-30,80],[30,76],[62,46]])s+=blob(240+dx*(1+sp*.5),cy+40-h*Math.sin(sp*Math.PI),5*(1-sp*.6),t,BLUE);
 for(const [y,a] of [[300,0],[322,1.8]])s+=stroke(Array.from({length:21},(_,i)=>[60+i*18,y+Math.sin(i*.9+t*2.2+a)*6] as P),t,6);
 return s;
}
// A name badge on a lanyard, swinging gently like a pendulum. The card hangs from its clip and lags the strap a little.
function profile(t:number,_id:string){
 const w=(t-6)*1.9,a1=.05*Math.sin(w),a2=a1+.035*Math.sin(w-.9);
 const [clipX,clipY]=turnAbout([[240,112]],240,-30,a1)[0];
 const strap=(pts:P[])=>turnAbout(pts,240,-30,a1),card=(pts:P[])=>turnAbout(pts.map(([x,y])=>[x+clipX-240,y+clipY-112] as P),clipX,clipY,a2);
 let s=stroke(strap([[204,-30],[222,40],[236,108]]),t,8)+stroke(strap([[276,-30],[258,40],[244,108]]),t,8);
 const body=card(sharp([[162,126],[318,126],[318,324],[162,324],[162,126]]));
 s+=polygon(body,PAPER)+stroke(body,t,10);
 s+=shape(card([[194,270],[203,238],[240,227],[277,238],[286,270]]),BLUE);
 s+=polygon(card(arc(240,186,30,0,Math.PI*2,30)),PAPER)+stroke(card(arc(240,186,30,-2.2,Math.PI*2-1.7,32)),t,9);
 const blink=cycle(t,3.8,.4)>.95?.15:1;
 for(const x of [229,251])s+=stroke(card([[x,181-5*blink],[x,181+5*blink]]),t,7);
 s+=stroke(card([[228,197],[240,204],[252,197]]),t,6);
 // A preference switch that flips on and off every few seconds, easing across.
 const g=cycle(t,6),on=g<.5?1:g<.93?1-ease((g-.5)/.07):ease((g-.93)/.07),kx=lerp(224,256,on);
 const pill=card([...arc(224,297,15,Math.PI/2,Math.PI*1.5,10),...arc(256,297,15,-Math.PI/2,Math.PI/2,10)]);
 s+=faded(polygon(pill,BLUE),.9*on)+stroke(pill,t,8,0,true);
 {const [x,y]=card([[kx,297]])[0];s+=blob(x,y,9,t,WHITE);}
 s+=shape(card([[230,98],[250,98],[250,148],[230,148]]),RED)+stroke(card(sharp([[230,98],[250,98],[250,148],[230,148],[230,98]])),t,7);
 return s;
}
// Time's up: an alarm clock with both hands on twelve rings every few seconds beside a chain link that has come apart.
function expired(t:number,_id:string){
 const g=cycle(t,4),env=t>6&&g<.32?swell(g/.32):0,buzz=Math.sin((t-6)*56),a=env*.075*buzz;
 const clock=(pts:P[])=>turnAbout(pts,300,322,a);
 let s=floor(t,60,420,330);
 // The broken link: two open halves lying apart.
 s+=stroke(arc(116,298,34,Math.PI*.35,Math.PI*1.65,20,22).map(([x,y])=>[x,y+Math.sin(x*.03)*2] as P),t,10);
 s+=stroke(turnAbout(arc(184,304,34,-Math.PI*.65,Math.PI*.65,20,22),184,304,.18),t,11);
 s+=blob(150,320,6,t,RED);
 s+=stroke(clock([[268,268],[252,322]]),t,9)+stroke(clock([[332,268],[348,322]]),t,9);
 for(const side of [-1,1]){const bx=300+side*44,by=160;s+=shape(clock(turnAbout(arc(bx,by,22,Math.PI,Math.PI*2,14,18),bx,by,side*.5)),RED);}
 s+=stroke(clock([[300,158],[300+9*buzz*env,140]]),t,6)+blob(...clock([[300+9*buzz*env,138]])[0],5,t,WHITE);
 const face=clock(arc(300,222,62,0,Math.PI*2,36));s+=polygon(face,PAPER)+stroke(clock(arc(300,222,62,-2.4,Math.PI*2-1.9,40)),t,10);
 for(let i=0;i<4;i++){const b=i*Math.PI/2;s+=stroke(clock([[300+Math.cos(b)*46,222+Math.sin(b)*46],[300+Math.cos(b)*53,222+Math.sin(b)*53]]),t,6);}
 s+=stroke(clock([[300,222],[300,184]]),t,8)+stroke(clock([[300,222],[278,209]]),t,10)+blob(...clock([[300,222]])[0],8,t,BLUE);
 if(env>0)for(const side of [-1,1])for(let i=0;i<3;i++){const b=-Math.PI/2+side*(.55+i*.32),r0=96,r1=96+14*env;s+=faded(stroke([[300+Math.cos(b)*r0,210+Math.sin(b)*r0],[300+Math.cos(b)*r1,210+Math.sin(b)*r1]],t,5),env);}
 return s;
}
// A safe whose combination dial turns through a code and clicks at each number; the light answers each click.
function safe(t:number,_id:string){
 const keys:[number,number][]=[[0,0],[.08,0],[.26,140],[.36,140],[.52,-70],[.62,-70],[.74,30],[.86,30],[1,0]];
 const g=cycle(t,7);let deg=0,click=0;
 for(let i=0;i<keys.length-1;i++){const [f0,a0]=keys[i],[f1,a1]=keys[i+1];if(g>=f0&&g<=f1){deg=lerp(a0,a1,ease((g-f0)/(f1-f0)));break;}}
 for(const at of [.26,.52,.74]){const d=g-at;if(d>=0&&d<.1)click=Math.max(click,1-d/.1);}
 const a=deg*Math.PI/180,cx=218,cy=210;
 let s=stroke([[158,322],[156,338]],t,10)+stroke([[322,322],[324,338]],t,10)+floor(t,90,390,340);
 s+=polygon(quad(128,86,224,236),PAPER)+stroke(sharp([[128,86],[352,88],[352,322],[128,322],[128,86]]),t,11);
 s+=stroke(sharp([[150,108],[330,108],[330,300],[150,300],[150,108]]),t,8);
 s+=stroke(sharp([[300,176],[310,176],[310,244],[300,244]]),t,9);
 s+=polygon(arc(cx,cy,56,0,Math.PI*2,36),PAPER)+stroke(arc(cx,cy,56,-2.4,Math.PI*2-1.9,40),t,9);
 for(let i=0;i<8;i++){const b=a+i*Math.PI/4,r0=i%2?42:36;s+=stroke([[cx+Math.cos(b)*r0,cy+Math.sin(b)*r0],[cx+Math.cos(b)*48,cy+Math.sin(b)*48]],t,i%2?4:7);}
 s+=blob(cx,cy,22,t,BLUE)+stroke([[cx+Math.cos(a-Math.PI/2)*5,cy+Math.sin(a-Math.PI/2)*5],[cx+Math.cos(a-Math.PI/2)*19,cy+Math.sin(a-Math.PI/2)*19]],t,7);
 s+=shape([[cx-11,cy-80],[cx+11,cy-80],[cx,cy-63]],RED);
 s+=faded(blob(292,138,16+7*click,t,BLUE),.28*click)+blob(292,138,9+2*click,t,click>0?BLUE:RED);
 return s;
}

// Atmosphere for the quieter originals: wind for the kite, stars for the telescope, water for the bridge.
function kiteAir(t:number,id:string){let s=kite(t,id);for(let i=0;i<3;i++){const f=((t*.22)+i/3)%1,x=lerp(430,60,f),y=[70,120,190][i];s+=faded(stroke([[x,y],[x+34,y-3],[x+60,y+1]],t,4),Math.sin(f*Math.PI)*.8);}s+=faded(shape([[70,72],[88,58],[112,60],[124,48],[150,54],[160,72],[140,82],[82,84]],WHITE),.12);return s;}
function telescopeNight(t:number,id:string){let s=telescope(t,id);for(const [x,y,p] of [[300,60,0],[380,130,1.3],[430,70,2.1],[250,110,.7]] as const){const k=.35+.65*Math.abs(Math.sin(t*1.4+p));s+=faded(stroke([[x-7*k,y],[x+7*k,y]],t,3)+stroke([[x,y-7*k],[x,y+7*k]],t,3),k);}{const f=cycle(t,6.5,.62),k=f/.16;if(t>6&&k<1){const hx=lerp(250,420,ease(k)),hy=lerp(22,78,ease(k)),len=34*swell(k);s+=faded(stroke([[hx-len*.95,hy-len*.31],[hx,hy]],t,4),swell(k));}}return s+faded(blob(420,40,4,t,BLUE),.8);}
function bridgeWater(t:number,id:string){let s=bridge(t,id);for(const [y,a,o] of [[356,.9,.5],[372,1.7,.3]] as const)s+=faded(stroke(Array.from({length:17},(_,i)=>[90+i*19,y+Math.sin(i*.8+t*1.6+a)*3] as P),t,4),o);const f=(t*.06+.3)%1,bx=lerp(70,410,f),by=Math.sin(bx*.08-t*1.6)*1.5;s+=faded(shape([[bx-16,344+by],[bx+16,344+by],[bx+10,354+by],[bx-10,354+by]],BLUE)+stroke([[bx,344+by],[bx,328+by]],t,3)+shape([[bx,328+by],[bx+12,338+by],[bx,340+by]],WHITE),Math.min(1,swell(f)*4));return s;}
/** Hello: a hand rises into view and waves, the fingertips trailing short motion marks; at rest it keeps a small wave going. */
function wave(t:number,_id:string){
 const rise=lerp(190,0,phase(t,0,1.1)),k=clamp((t-1.1)/3.3);
 // Three waves that fade to a gentle tilt; after t=6 the idle loop keeps a slower, smaller wave.
 const a=(t<6?.26*Math.sin(k*Math.PI*6)*(1-.7*k)+.06*phase(t,4,4.6):.06)+idle(t,2.2,.1);
 const at=(pts:P[])=>turnAbout(pts.map(([x,y])=>[240+x*1.3,272+y*1.3+rise] as P),240,440+rise,a);
 const hand:P[]=[[-30,0],[-34,-44],[-48,-58],[-64,-78],[-60,-91],[-47,-83],[-35,-67],[-33,-86],[-33,-130],[-25,-141],[-17,-131],[-16,-95],[-14,-141],[-6,-152],[2,-142],[3,-96],[5,-134],[13,-144],[21,-134],[20,-90],[23,-114],[30,-124],[37,-114],[35,-70],[30,-34],[28,0]];
 let out=stroke(at(hand),t,9)+stroke(at([[-37,4],[0,6],[37,3]]),t,9)+stroke(at([[-33,8],[-35,70],[-37,170]]),t,9)+stroke(at([[33,8],[35,70],[38,170]]),t,9);
 out+=stroke(at([[-12,-42],[4,-34],[18,-44]]),t,5);
 // Motion marks beside the fingertips, on the side the hand is swinging towards.
 const swing=t<6?Math.cos(k*Math.PI*6)*(1-k):Math.cos((t-6)*2.2),side=swing>0?1:-1,show=t<6?Math.abs(swing)*phase(t,1.2,1.6):Math.abs(swing)*.7;
 if(show>.05)for(let i=0;i<2;i++){const r=182+i*22;out+=faded(stroke(at([[side*48,-r+120],[side*(64+i*10),-r+88],[side*(62+i*14),-r+56]]),t,5),show*(.9-i*.3));}
 out+=blob(352,98,15*phase(t,3.9,4.4),t,BLUE)+burst(352,98,24,t,4.2)+blob(126,300,8*phase(t,4.3,4.7),t,RED);
 return out;
}
/** Skills: an index box of ways of working. The cards drop in, then the tabbed one keeps being picked out. */
function cards(t:number,_id:string){
 let s='';
 const pick=t>6?swell(cycle(t,3.2))*24:0;
 for(const [i,x,y0,sk] of [[0,150,140,-4],[1,198,104,0],[2,246,146,4]] as const){
  const k=phase(t,.25+i*.35,1.15+i*.35),y=lerp(-160,y0,k)-(i===1?pick:0);
  s+=polygon(quad(x,y,84,130),PAPER)+rect(x,y,84,130,t,sk)+stroke([[x+15,y+26],[x+58,y+27]],t,4)+stroke([[x+15,y+42],[x+66,y+41]],t,4)+stroke([[x+15,y+58],[x+48,y+58]],t,4);
  if(i===1)s+=shape([[x+44,y-24],[x+76,y-24],[x+76,y+1],[x+44,y+1]],RED)+stroke([[x+44,y+1],[x+44,y-24],[x+76,y-24],[x+76,y+1]],t,5);
 }
 s+=polygon([[138,228],[342,228],[330,318],[150,318]],PAPER)+stroke(sharp([[138,228],[342,228],[330,318],[150,318],[138,228]]),t,9);
 s+=faded(blob(240,273,16,t,BLUE),phase(t,1.6,2.2));
 return s+burst(240,72,20,t,2.1)+floor(t,100,380,330);
}
const scenes={balance,untangle,build,discover,learn,orchestrate,sprout,kite:kiteAir,telescope:telescopeNight,pencil,bridge:bridgeWater,conversation,envelope,key,door,swap,invite,keypad,shield,lock,unlock,link,unlink,plane,hourglass,box,jar,folder,plug,house,lifebuoy,profile,safe,expired,wave,cards};
export function filmFrame(scene:Scene,seconds:number,id:string,boil:number|null=null){const t=Math.max(0,seconds);boilClock=boil;try{return `<defs><filter id="${id}" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"/></filter></defs>${scenes[scene](t,id)}`;}finally{boilClock=null}}
