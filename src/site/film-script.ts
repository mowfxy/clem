import {inks,pen,penFrame} from '../vectorFilm';
import {MARK_BODY,MARK_LEAF,TUMBLE_PERIOD,markOutline} from '../../core/mark';

/**
 * The website's film: a short story in Clem's pen, the same wandering ivory line, one colour per shot and the same
 * pose-to-pose timing as the app's illustrations, only longer and wider (a 960 × 540 stage, framed in close at VIEW). The tumbling shape
 * is its one character: it rolls while Clem thinks and settles beside Clem's mark at the end.
 * Shots that share an object continue straight on; a new place fades in as the last one fades out.
 */
const {line,curve,shape,arc,ellipse,rounded,X,ring,wavy,pose,pop,clamp,lerp}=pen;
const {INK,BLUE,GREEN,LILAC,SAND,CLAY,FINE,THIN}=inks;
type P=[number,number];
const TAU=Math.PI*2;
/** 0 → 1 across [a, b] seconds, eased out. */
const ease=(u:number,a:number,b:number)=>{const x=clamp((u-a)/(b-a));return 1-(1-x)**3;};

/** `dx` slides a shot sideways so its drawings sit in the middle of the framed view; shots that continue into each
 *  other share one so nothing jumps at the cut. */
export type Shot={id:string;caption:string;seconds:number;draw:(u:number)=>string;into?:'cut'|'fade';dx?:number};

// ---------- the mark ----------
const CX=540,CY=246,S=2.9;
/** One outline of the mark, placed on the stage. */
const placed=(path:string):P[]=>markOutline(path).map(([x,y])=>[CX+(x-50)*S,CY+(y-50)*S]);
const BODY=placed(MARK_BODY),LEAF=placed(MARK_LEAF);
/** A pose's edge at angle `a`, measured from its centre, for a shape of unit half-width. */
const squircle=(a:number)=>(Math.abs(Math.cos(a))**3.4+Math.abs(Math.sin(a))**3.4)**(-1/3.4);
const leafEdge=(a:number,axis:number)=>{const s=Math.sin(a-axis),R=1.42,d=R-.72;return Math.min(...[1,-1].map(side=>{const b=side*d*s;return -b+Math.sqrt(b*b+R*R-d*d)}));};
/** One soft shape tumbling, as Clem does while it thinks: a quarter turn at a time, square, leaf, circle, leaf, square. */
function tumble(u:number,x:number,y:number,r:number,{opacity=1}:{opacity?:number}={}){
  const turns=((u%TUMBLE_PERIOD)+TUMBLE_PERIOD)%TUMBLE_PERIOD/TUMBLE_PERIOD*4,step=Math.floor(turns),e=ease(turns-step,0,1),q=(step+e)/4,pts:P[]=[];
  const poses=[squircle,(a:number)=>leafEdge(a,Math.PI/4),()=>1,(a:number)=>leafEdge(a,-Math.PI/4),squircle];
  for(let i=0;i<72;i++){const a=i/72*TAU,edge=lerp(poses[step](a),poses[step+1](a),e)*r;pts.push([x+Math.cos(a+q*TAU)*edge,y+Math.sin(a+q*TAU)*edge]);}
  return shape(pts,{fill:INK,w:0,opacity});
}

// ---------- the notes page, shared by the first shots ----------
const PAGE=rounded(236,104,262,330,16);
const RULES=[164,198,232,266,300,334,368].map((y,i)=>({y,x1:[460,430,468,404,452,440,390][i]}));
function page(u:number,{drawIn=false,mark=0}:{drawIn?:boolean;mark?:number}={}){
  const k=drawIn?ease(u,.1,.9):1;
  let s=shape(PAGE,{k});
  s+=line([[236,140],[498,140]],{w:THIN,k});
  RULES.forEach(({y,x1},i)=>{
    const kk=drawIn?ease(u,.5+i*.14,.9+i*.14):1;
    // The line Clem found: a wash of sand laid under it.
    if(i===3&&mark>0)s+=shape(X(rounded(258,y-15,x1-246,30,9),{sx:mark,ox:258,oy:y}),{fill:SAND,w:0});
    if(kk>0)s+=curve(Array.from({length:9},(_,j)=>[264+(x1-264)*j/8,y+Math.sin(j*1.3+i)*3.2] as P),{w:FINE,k:kk});
  });
  return s;
}
/** The question, asked in a bubble with a hand-written question mark. */
const QMARK:P[]=[[656,196],[664,176],[684,170],[702,180],[704,200],[688,214],[680,232]];
function bubble(u:number,{scale=1,x=0,y=0,write=1}:{scale?:number;x?:number;y?:number;write?:number}){
  if(scale<.03)return '';
  const b=(pts:P[])=>X(pts,{s:scale,x,y,ox:640,oy:300});
  let s=shape(b(rounded(588,132,200,152,44)),{fill:LILAC})+line(b([[630,282],[612,322],[668,284]]));
  if(write>0)s+=curve(b(QMARK),{k:write})+(write>.98?ring(...b([[679,256]])[0],4.5*scale,{fill:INK,w:0}):'');
  return s;
}
/** A magnifying glass resting with its lens at (x, y). */
function lens(x:number,y:number,sc=1){
  if(sc<.03)return '';
  const t=(pts:P[])=>X(pts,{s:sc,ox:x,oy:y});
  return shape(t(ellipse(x,y,34)))+line(t([[x+25,y+25],[x+50,y+50]]))+shape(t(rounded(x+52,y+50,16,40,7).map(([px,py])=>{const a=-Math.PI/4,dx=px-(x+60),dy=py-(y+70);return [x+60+dx*Math.cos(a)-dy*Math.sin(a),y+70+dx*Math.sin(a)+dy*Math.cos(a)] as P;})));
}

// ---------- the answer ----------
const CARD=rounded(600,118,252,300,18);
function answer(u:number,{k=1,thread=1,tick=1}:{k?:number;thread?:number;tick?:number}){
  let s=shape(CARD,{k});
  [168,204,240,276,312].forEach((y,i)=>{const kk=clamp(k*1.6-i*.15);if(kk>0)s+=curve(Array.from({length:9},(_,j)=>[634+([186,160,176,120,150][i])*j/8,y+Math.sin(j*1.2+i*2)*2.6] as P),{w:FINE,k:kk});});
  // The citation: a blue tab on the card's edge, tied back to the line on the page it came from.
  if(thread>0){
    s+=curve([[468,266],[520,262],[548,218],[586,208],[600,206]],{w:THIN,k:thread});
    s+=shape(X(rounded(588,190,28,32,6),{s:pop(thread,.85,.25),ox:600,oy:206}),{fill:BLUE,w:FINE});
  }
  if(tick>0){s+=shape(ellipse(800,366,26),{w:FINE,k:tick})+line([[786,366],[796,377],[815,354]],{w:FINE,k:clamp(tick*1.4-.4)});}
  return s;
}

// ---------- the visual ----------
function response(z:number,k:number){
  const wd=2*Math.sqrt(1-z*z),pts:P[]=[];
  for(let i=0;i<=96;i++){const t=i/96*12,y=1-Math.exp(-z*2*t)*(Math.cos(wd*t)+z/Math.sqrt(1-z*z)*Math.sin(wd*t));pts.push([266+t*38,372-y*132]);}
  return curve(pts,{k,w:4.4});
}

// ---------- shots ----------
export const shots:Shot[]=[
  {id:'open',caption:'This is Clem, your space to think.',seconds:4.6,draw(u){
    return shape(BODY,{k:ease(u,.15,1.5)})+shape(LEAF,{k:ease(u,1.3,2.4)});
  }},
  {id:'ask',caption:'Bring a question, and the notes it came from.',seconds:6,dx:10,into:'fade',draw(u){
    return page(u,{drawIn:true})+bubble(u,{scale:pop(u,2.3,.34),write:ease(u,2.9,3.9)});
  }},
  {id:'think',caption:'Clem reads them, and says what it is doing.',seconds:6,dx:10,draw(u){
    const away=ease(u,.2,.8),ly=pose(u,[1.4,2.4,3.4],[176,244,346,278],.34),lx=pose(u,[1.4,2.4,3.4],[400,360,420,380],.34);
    const found=u>3.75,mark=found?ease(u,3.75,4.3):0;
    let s=page(u,{mark})+bubble(u,{scale:lerp(1,.46,away),x:lerp(0,150,away),y:lerp(0,-150,away)});
    s+=lens(lx,ly,pop(u,1,.3));
    if(u>.7)s+=tumble(u,680,286,26*pop(u,.7,.3));
    return s;
  }},
  {id:'answer',caption:'Every claim points back to the page it came from.',seconds:6.5,dx:10,draw(u){
    const out=1-ease(u,.15,.6);
    let s=page(u,{mark:1})+bubble(u,{scale:.46*out,x:150,y:-150});
    s+=lens(380,278,out);
    if(out>.05)s+=tumble(u,680,286,26*out);
    return s+answer(u,{k:ease(u,.5,1.9),thread:ease(u,2.3,3.3),tick:ease(u,3.9,4.6)});
  }},
  {id:'see',caption:'Ideas become things you can play with.',seconds:7,dx:45,into:'fade',draw(u){
    const knob=pose(u,[2.4,4.8],[0,1,.55],.5),z=lerp(.72,.22,knob);
    let s=line([[256,96],[256,382],[734,382]],{k:ease(u,.05,.8)});
    s+=line([[266,240],[724,240]],{w:THIN,k:ease(u,.5,1.1),opacity:.55});
    s+=response(z,ease(u,.8,2));
    const kx=lerp(356,612,knob);
    s+=line([[336,414],[632,414]],{w:FINE,k:ease(u,.3,1)});
    return s+shape(ellipse(kx,414,15),{fill:BLUE,w:FINE,k:ease(u,.9,1.3)});
  }},
  {id:'keep',caption:'What you learn, it helps you keep.',seconds:6.5,dx:10,into:'fade',draw(u){
    const flip=u<1.5?1:u<1.8?1-(u-1.5)/.3:u<2.1?(u-1.8)/.3:1,back=u>=1.8;
    const top=rounded(250,150,196,240,16),f=(pts:P[])=>X(pts,{sx:Math.max(.02,flip),ox:348,oy:270});
    let s=shape(rounded(274,128,196,240,16),{w:THIN})+shape(rounded(262,139,196,240,16),{w:FINE})+shape(f(top));
    if(!back)s+=curve(f([[324,232],[332,214],[352,208],[370,218],[372,238],[356,250],[348,272]]))+ring(...f([[348,296]])[0],4.5,{fill:INK,w:0});
    else{s+=shape(f(rounded(282,182,34,34,7)),{fill:GREEN,w:FINE});[200,248,282,316].forEach((y,i)=>s+=line(f([[i?282:330,y],[[412,404,380,396][i],y]]),{w:FINE}));}
    // The plan: a month with the exam circled.
    const cal=rounded(560,128,250,262,18);
    s+=shape(cal,{k:ease(u,.2,1)})+line([[560,184],[810,184]],{w:FINE,k:ease(u,.5,1.1)});
    for(const x of [606,764])s+=line([[x,112],[x,144]],{w:FINE,k:ease(u,.6,1)});
    for(let r=0;r<4;r++)for(let c=0;c<5;c++){const i=r*5+c,x=600+c*42,y=220+r*44;if(i===13){const kk=ease(u,3.1,3.8);if(kk>0)s+=shape(ellipse(x,y,17),{fill:pop(u,3.8,.3)>.5?CLAY:undefined,w:FINE,k:kk});else s+=ring(x,y,3.2,{fill:INK,w:0});}else s+=ring(x,y,3.2,{fill:INK,w:0,opacity:i<13?.35:1});}
    return s;
  }},
  {id:'home',caption:'And all of it stays home, on your PC.',seconds:6.5,dx:0,into:'fade',draw(u){
    const drop=ease(u,1,1.6),go=pose(u,[2.3],[0,1],.9),shut=u>3.7,lit=u>4.1;
    // The house first, so the folder passes in front of it on its way in.
    const hx=608,hy=388;
    let s=line([[hx-160,hy],[hx+170,hy]],{w:FINE});
    s+=shape([[hx-110,hy],[hx-110,hy-150],[hx,hy-238],[hx+110,hy-150],[hx+110,hy]]);
    s+=shape(rounded(hx+40,hy-118,44,44,6),{fill:lit?SAND:undefined,w:FINE})+line([[hx+62,hy-118],[hx+62,hy-74]],{w:THIN})+line([[hx+40,hy-96],[hx+84,hy-96]],{w:THIN});
    s+=shape(rounded(hx-76,hy-110,58,110,8),{w:FINE});
    if(shut)s+=ring(hx-30,hy-54,3.4,{fill:INK,w:0});
    if(lit)s+=wavy(hy-248,hx+60,hx+70,u*3,5)+line([[hx+56,hy-200],[hx+56,hy-232],[hx+80,hy-232],[hx+80,hy-182]],{w:FINE});
    else s+=line([[hx+56,hy-200],[hx+56,hy-232],[hx+80,hy-232],[hx+80,hy-182]],{w:FINE});
    // The report drops into its folder; the folder walks in through the door, which closes behind it.
    const fx=lerp(286,hx-47,go),fy=lerp(300,hy-58,go)-Math.sin(go*Math.PI)*90,fs=lerp(1,.42,go);
    if(!shut){
      const t=(pts:P[])=>X(pts,{s:fs,x:fx-286,y:fy-300,ox:286,oy:300});
      const sheet=X(rounded(222,140,128,160,10),{y:drop*96,ox:286,oy:220});
      if(drop<1)s+=shape(t(sheet))+[176,204,232].map(y=>line(t(X([[242,y],[328,y]],{y:drop*96,ox:286,oy:220})),{w:FINE})).join('');
      s+=shape(t([[206,240],[246,240],[258,226],[300,226],[312,240],[366,240],[366,354],[206,354]]),{fill:drop>.98?GREEN:undefined});
    }
    return s;
  }},
  {id:'close',caption:'What’s on your mind?',seconds:4.8,into:'fade',draw(u){
    const merge=ease(u,2.6,3.1);
    let s=shape(BODY)+shape(LEAF);
    if(merge<1)s+=tumble(u,CX+172,CY+8,lerp(24,6,merge),{opacity:1-merge});
    return s;
  }},
];

/** The part of the stage the film frames: the drawings sit in the middle, the captions under them. */
export const VIEW='160 40 760 428';
export const filmSeconds=shots.reduce((t,s)=>t+s.seconds,0);
/** Where each shot starts, in film seconds. */
export const starts=shots.reduce<number[]>((a,s,i)=>{a.push(i?a[i-1]+shots[i-1].seconds:0);return a;},[]);
export const shotAt=(t:number)=>{let i=0;while(i<shots.length-1&&t>=starts[i+1])i++;return i;};

// Between places the drawing lets go and the next one arrives: a short fade out, then a fade in that settles from a
// few units below. It is stepped like everything else, twelve drawings a second.
const FADE=.45;
/** The film at `t` seconds, as SVG markup for a 960 × 540 stage. */
export function filmFrame(t:number){
  t=((t%filmSeconds)+filmSeconds)%filmSeconds;
  const i=shotAt(t),local=t-starts[i];
  penFrame(t);
  const next=shots[(i+1)%shots.length],toEnd=shots[i].seconds-local;
  let o=1,lift=0;
  if(local<FADE&&shots[i].into==='fade'){const q=ease(local,0,FADE);o=q;lift=(1-q)*10;}
  else if(toEnd<FADE&&next.into==='fade')o=clamp(toEnd/FADE);
  return `<g transform="translate(${shots[i].dx||0} ${lift.toFixed(1)})"${o<1?` opacity="${o.toFixed(3)}"`:''}>${shots[i].draw(local)}</g>`;
}
