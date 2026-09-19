/** Authored 24 fps vector cels. Geometry is redrawn, never moved as a rigid SVG group. */
export type Scene='balance'|'untangle'|'build'|'discover'|'learn'|'orchestrate'|'sprout'|'kite'|'telescope'|'pencil'|'bridge'|'conversation';
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
function blob(x:number,y:number,r:number,t:number,color=BLUE,stretch=0){const ps:P[]=[];for(let i=0;i<40;i++){const a=i/40*Math.PI*2,rr=r*(1+.028*Math.sin(a*3+t*2)+.012*Math.cos(a*5-t));ps.push([x+Math.cos(a)*rr*(1+stretch),y+Math.sin(a)*rr/(1+stretch)]);}return polygon(ps,color);}
function deform(points:P[],t:number,amount=1):P[]{const cel=Math.floor(t*6)%4;return points.map(([x,y],i)=>[x+amount*.8*Math.sin(y*.031+cel*1.7+i*.2),y+amount*.65*Math.sin(x*.027+cel*1.3+i*.3)]);}
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
 const pose=hand.map(([x,y])=>[x+(y<225?open*11:0),y+(x<165?bend*(225-y)/80:0)] as P);
 return stroke(receiving,t,9)+stroke(arm.map(([x,y])=>[x+Math.sin((y-150)/170)*bend*.5,y] as P),t,10)+stroke(pose,t,9)+droplets(t,207+open*2,113,BLUE,id);
}
function untangle(t:number,id:string){
 const pull=phase(t,.5,3.2),finish=phase(t,3.2,4.7);const line:P[]=[];
 for(let i=0;i<=100;i++){const u=i/100,coil=Math.sin(u*Math.PI)*30*(1-pull);line.push([58+u*307+Math.sin(u*Math.PI*7)*coil,225+Math.cos(u*Math.PI*7)*coil-45*Math.sin(u*Math.PI)*pull]);}
 const x=365+pull*16;const hand:P[]=[[x+20,296],[x+11,271],[x+8,245],[x-6,228],[x-23,219],[x-29,210],[x-20,200],[x-4,208],[x+8,225],[x+12,200],[x+21,193],[x+26,202],[x+22,222],[x+35,205],[x+45,206],[x+43,218],[x+32,236],[x+49,223],[x+59,227],[x+54,242],[x+41,261],[x+44,290]];
 let out=stroke(line,t,8)+stroke(hand,t,8)+stroke([[49,252],[38,271],[40,297],[66,313],[106,310],[131,288]],t,7);
 out+=droplets(t,235,113,RED,id);const turn=finish*Math.PI*.25;const c:P[]=[];for(let i=0;i<32;i++){const a=i/32*Math.PI*2,rad=lerp(34,30/(Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)))),finish);c.push([235+Math.cos(a+turn)*rad,113+Math.sin(a+turn)*rad]);}if(t>2.8)out+=shape(c,RED);return out;
}
function build(t:number,id:string){
 const form=phase(t,1.6,3.7),press=phase(t,3.4,4)-phase(t,4,4.8);let out=stroke([[69,328],[155,329],[250,327],[403,329]],t,7);
 out+=rect(99,245,91,82,t,4)+rect(192,280,91,47,t,-4)+rect(129,166,83,79,t,-5);
 const cx=296,cy=221,drop=phase(t,.5,2.8);const top=179+press*7;let fill='';
 const diamond:P[]=[[cx-53,top],[cx,top-33],[cx+54,top],[cx,top+34]];
 const circle:P[]=diamond.map(([x,y])=>{const a=Math.atan2(y-221,x-cx);return [cx+Math.cos(a)*34,221+Math.sin(a)*34]});
 const pts=diamond.map((p,i)=>[lerp(circle[i][0],p[0],form),lerp(circle[i][1],p[1],form)] as P);
 if(t<2.8)fill=droplets(t,cx,221,BLUE,id);else fill=shape(pts,BLUE);
 out+=fill;const h=69*form;out+=stroke([[cx-53,top],[cx-52,top+h],[cx,top+34+h],[cx+54,top+h],[cx+54,top]],t,8)+stroke([[cx,top+34],[cx,top+34+h]],t,7);
 const reach=phase(t,2.5,3.5)-phase(t,4,5.2),y=-46+reach*70;
 out+=stroke([[373,57+y],[355,75+y],[339,95+y],[328,122+y],[331,133+y],[341,129+y],[351,112+y],[346,141+y],[350,148+y],[361,138+y],[371,115+y],[371,138+y],[379,143+y],[388,128+y],[403,91+y]],t,8);
 return out;
}
function discover(t:number,id:string){
 const scan=phase(t,.6,3.6),x=lerp(156,286,scan),y=146+71*scan;let out=stroke([[99,72],[285,88],[271,295],[77,279],[99,72]],t,8)+stroke([[119,54],[308,67],[299,269]],t,7);
 for(let i=0;i<4;i++){const yy=118+i*39;out+=stroke([[121-i*3,yy],[172,yy+3],[237-i*9,yy+8]],t,6);}
 const ring:P[]=[];for(let i=0;i<=48;i++){const a=i/48*Math.PI*2;ring.push([x+Math.cos(a)*61,y+Math.sin(a)*61]);}out+=stroke(ring,t,9)+stroke([[x+43,y+45],[x+73,y+76],[x+108,y+110]],t,16);
 const reveal=phase(t,3.5,4.7);const check:P[]=[[x-27,y+2],[x-8,y+23],[x+30,y-22]];const checkPoints=spline(check).slice(0,Math.max(2,Math.floor(21*reveal)));if(reveal>0)out+=ink(checkPoints,10,t).replaceAll(WHITE,BLUE);
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
 out+=stroke(bulb,t,7)+stroke([[229,139],[249,139]],t,6);
 if(light>0)out+=droplets((t-2.1)*1.5,239,79,RED,id,15);
 return out;
}
function orchestrate(t:number,id:string){
 const merge=phase(t,.5,2.8),resolve=phase(t,3,4.8);let out=stroke([[111,105],[171,126],[204,174],[240,190],[294,161],[330,118],[371,100]],t,7)+stroke([[111,285],[168,263],[206,207],[240,190],[290,224],[330,276],[374,286]],t,7);
 out+=rect(68,62,78,79,t,2)+rect(335,247,78,79,t,-2);
 const x1=lerp(111,240,merge),y1=lerp(285,190,merge),x2=lerp(371,240,merge),y2=lerp(100,190,merge);
 const fused=`<g filter="url(#${id})">${blob(x1,y1,lerp(33,28,merge),t,RED,.25*Math.sin(merge*Math.PI))}${blob(x2,y2,lerp(37,28,merge),t,BLUE,.2*Math.sin(merge*Math.PI))}</g>`;out+=`<g opacity="${1-resolve}">${fused}</g>`;out+=blob(371,100,37*resolve,t,BLUE)+shape([[111,252],[144,285],[111,318],[78,285]],RED).replace('<path ',`<path opacity="${resolve}" `);
 if(resolve>0){const cx=lerp(240,373,resolve),cy=lerp(190,286,resolve);out+=blob(cx,cy,30*(1-resolve),t,BLUE,.5*Math.sin(resolve*Math.PI));for(let i=0;i<3;i++)out+=stroke([[349,267+i*17],[349+44*resolve,267+i*17]],t,5);}
 return out;
}

// Homepage-only cartoons: staged gestures with anchored supports and a living-ink hold.
function sprout(t:number,_id:string){const grow=phase(t,.4,2.5),bloom=phase(t,2,3.7),nod=(phase(t,3.6,4)-phase(t,4,4.8))*12;let out=stroke([[153,265],[161,327],[237,340],[307,325],[315,265]],t,11)+stroke([[144,262],[226,252],[324,262],[244,276],[144,262]],t,10);out+=stroke([[236,257],[233-nod,220-46*grow],[246-nod,220-119*grow]],t,10);const left:P[]=[[239,203],[204-48*bloom,187-40*bloom],[185-36*bloom,210],[239,219]];const right:P[]=[[240,159],[278+42*bloom,121],[301+24*bloom,168],[237,184]];out+=shape(left,WHITE)+shape(right,BLUE);out+=stroke([[234,266],[213,292],[226,310]],t,4);if(t>3)out+=stroke([[190,83],[180,65]],t,6)+stroke([[248,68],[253,45]],t,6)+stroke([[294,83],[312,66]],t,6);return out;}
function kite(t:number,_id:string){const open=phase(t,.4,2.6),catching=phase(t,2.6,3.1)-phase(t,3.1,4.1),cx=255+catching*13+(t>6?Math.sin((t-6)*Math.PI/2)*9:0),cy=125+(t>6?(1-Math.cos((t-6)*Math.PI/2))*3:0);let out=stroke([[109,313],[140,279],[145,250],[162,233],[181,233],[184,244],[166,258],[190,249],[202,255],[189,271],[171,287],[170,314]],t,9);out+=stroke([[181,245],[218,236],[207,211],[246,189],[cx,cy+60]],t,6);const wing=25+48*open;out+=shape([[cx,cy-72],[cx+wing,cy],[cx,cy+64],[cx-wing,cy]],BLUE);out+=stroke([[cx,cy-72],[cx,cy+64]],t,6)+stroke([[cx-wing,cy],[cx+wing,cy]],t,6);out+=stroke([[cx-1,cy+65],[cx+17,cy+88],[cx-9,cy+108],[cx+11,cy+127]],t,7);return out;}
function telescope(t:number,_id:string){const focus=phase(t,.7,2.5),blink=phase(t,3,3.2)-phase(t,3.2,3.7);let out=stroke([[212,235],[172,330],[212,316],[245,239],[283,331]],t,10);out+=stroke([[136,188],[177,132],[320,202],[285,261],[136,188]],t,12)+stroke([[167,134],[156,113],[174,95],[210,120]],t,10)+stroke([[303,202],[325+22*focus,215],[306+22*focus,247],[287,237]],t,10);out+=blob(119,91,27,t,RED,.12*blink);out+=stroke([[92,48],[83,35]],t,5)+stroke([[68,90],[45,88]],t,5)+stroke([[115,46],[118,25]],t,5);return out;}
function pencil(t:number,_id:string){const write=phase(t,.6,3.6),x=147+write*168,y=206+Math.sin(write*Math.PI*2)*17;let out=stroke([[79,103],[284,92],[312,319],[99,333],[79,103]],t,9);out+=stroke([[110,139],[181,133]],t,6);const line:P[]=[];for(let i=0;i<=35*write;i++){line.push([128+i*4.7,254+Math.sin(i*.4)*13]);}if(line.length>1)out+=stroke(line,t,8);out+=shape([[x,y],[x+23,y-59],[x+84,y-137],[x+107,y-115],[x+47,y-34]],BLUE)+stroke([[x,y],[x+23,y-59],[x+47,y-34],[x,y]],t,7)+stroke([[x+71,y-121],[x+94,y-101]],t,7);return out;}
function bridge(t:number,_id:string){const join=phase(t,.7,3),spring=phase(t,3,3.25)-phase(t,3.25,4);let out=stroke([[61,303],[150,303],[161,272],[162,222]],t,11)+stroke([[416,303],[329,303],[319,273],[318,222]],t,11);out+=stroke([[162,224],[189,183+spring*12],[239,168+spring*18],[289,184+spring*12],[318,224]],t,12);out+=stroke([[187,192],[188,279],[164,280]],t,7)+stroke([[291,192],[291,279],[318,280]],t,7);out+=blob(123+join*228,166-Math.sin(join*Math.PI)*71,29,t,RED,.22*spring);out+=stroke([[64,337],[123,332],[175,339],[245,333],[306,339],[369,332],[416,337]],t,5);return out;}
function conversation(t:number,_id:string){const reply=phase(t,1,2.8),squash=phase(t,2.8,3.1)-phase(t,3.1,3.8);let out=stroke([[66,94],[160,73],[239,100],[245,168],[214,196],[171,191],[140,221],[142,189],[77,181],[66,94]],t,10);out+=stroke([[255,183],[323,163],[398,186],[405,253],[379,281],[353,279],[361,311],[320,284],[258,268],[255,183]],t,10);for(let i=0;i<3;i++)out+=blob(111+i*44,135,10,t,WHITE);const tick:P[]=[[285,226],[307,245+8*squash],[366,202]];if(reply>0)out+=ink(spline(tick).slice(0,Math.max(2,Math.floor(21*reply))),10,t).replaceAll(WHITE,BLUE);return out;}
const scenes={balance,untangle,build,discover,learn,orchestrate,sprout,kite,telescope,pencil,bridge,conversation};
export function filmFrame(scene:Scene,seconds:number,id:string){const t=Math.max(0,seconds);return `<defs><filter id="${id}" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"/></filter></defs>${scenes[scene](t,id)}`;}
