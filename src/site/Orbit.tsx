import {useEffect,useRef} from 'react';
import horizon from '../glass/horizon.webp?inline';

/** The whole site sits in one orbit. The app's picture of Earth's limb, set in Mowafy Sans characters, is drawn once at
 *  each size onto two large canvases, one for the night side and one for the day, and scrolling only moves those canvases
 *  on the compositor. The horizon starts low and dark behind the opening screen, rises through #sunrise, and the page
 *  comes out in the app's daylight. Pages with no #sunrise wait at dawn. Nothing moves by itself but a slow twinkle in the
 *  opening screen, the same one the app's home screen has. */
const RAMP=' .··::;;+*#',SPECKLE=['#ff5a36','#3f8cff','#37d08c','#e8c547','#b27bff'];
const NIGHT='#05080f',DAY='#e9eff6';
/** A point on the limb in the 900×600 picture: the point the rotation turns around. */
const LIMB_X=450/900,LIMB_Y=345/600;
const hash=(a:number,b:number)=>{const s=Math.sin(a*127.1+b*311.7)*43758.5453;return s-Math.floor(s);};
const clamp=(v:number,a=0,b=1)=>Math.min(b,Math.max(a,v));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const ease=(t:number)=>t*t*(3-2*t);
const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

type Cell={x:number;y:number;c:number;fill:string;alpha:number};
type Plate={ctx:CanvasRenderingContext2D;base:HTMLCanvasElement;cells:Cell[];cw:number;ch:number;dpr:number};

function draw(canvas:HTMLCanvasElement,image:HTMLImageElement,pixels:Uint8ClampedArray,W:number,H:number,cw:number,light:boolean):Plate|null{
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return null;
  const imgW=image.naturalWidth,imgH=image.naturalHeight,ch=cw*1.7,dpr=Math.min(1.5,window.devicePixelRatio||1,4096/W);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);canvas.style.width=W+'px';canvas.style.height=H+'px';
  const base=document.createElement('canvas');base.width=canvas.width;base.height=canvas.height;
  const under=base.getContext('2d')!;
  under.imageSmoothingQuality='high';under.globalAlpha=light?.42:.46;
  if(light){
    // In daylight space is simply not there: the picture's black turns see-through instead of grey.
    const lit=document.createElement('canvas');lit.width=imgW;lit.height=imgH;
    const c=lit.getContext('2d')!,copy=new ImageData(new Uint8ClampedArray(pixels),imgW,imgH);
    for(let i=0;i<copy.data.length;i+=4)copy.data[i+3]=Math.min(255,(.3*copy.data[i]+.59*copy.data[i+1]+.11*copy.data[i+2])*3);
    c.putImageData(copy,0,0);under.drawImage(lit,0,0,base.width,base.height);
  }else under.drawImage(image,0,0,base.width,base.height);
  ctx.drawImage(base,0,0);
  const cols=Math.ceil(W/cw),rows=Math.ceil(H/ch),cells:Cell[]=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x=Math.min(imgW-1,Math.floor((col+.5)/cols*imgW)),y=Math.min(imgH-1,Math.floor((row+.5)/rows*imgH)),at=(y*imgW+x)*4;
    const r=pixels[at],g=pixels[at+1],b=pixels[at+2],lum=(.3*r+.59*g+.11*b)/255,grain=hash(col,row),cell:Cell={x:col*cw,y:row*ch,c:0,fill:'',alpha:1};
    if(lum<.05){
      if(light||grain>.62)continue;
      cell.c=grain<.2?2:1;cell.fill=SPECKLE[Math.floor(hash(row,col)*SPECKLE.length)];cell.alpha=.1+grain*.2;
    }else{
      const mean=(r+g+b)/3,push=1.4,dim=light?.86:.8,tint=(v:number)=>Math.min(255,(mean+(v-mean)*push)*dim)|0;
      cell.fill=`rgb(${tint(r)},${tint(g)},${tint(b)})`;
      cell.c=Math.max(1,Math.min(RAMP.length-1,Math.round((Math.sqrt(lum)*.92+(grain-.5)*.2)*(RAMP.length-1))));
      cell.alpha=light?Math.min(1,.45+lum*.9):.26+lum*.42;
    }
    cells.push(cell);
  }
  ctx.font=`400 ${(cw*1.7*dpr).toFixed(1)}px 'Mowafy Sans',sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(const cell of [...cells].sort((a,b)=>a.fill<b.fill?-1:1)){ctx.globalAlpha=cell.alpha;ctx.fillStyle=cell.fill;ctx.fillText(RAMP[cell.c],(cell.x+cw/2)*dpr,(cell.y+ch/2)*dpr);}
  ctx.globalAlpha=1;
  return {ctx,base,cells,cw,ch,dpr};
}

export function Orbit(){
  const night=useRef<HTMLCanvasElement>(null),day=useRef<HTMLCanvasElement>(null),sky=useRef<HTMLDivElement>(null),sun=useRef<HTMLDivElement>(null),dark=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let gone=false,frame=0,resize=0,W=0,H=0,plate:Plate|null=null,image:HTMLImageElement|null=null,pixels:Uint8ClampedArray|null=null,scrollAtTop=true,sky_='night';
    const theme=document.querySelector('meta[name="theme-color"]');
    const place=()=>{
      frame=0;
      const vw=window.innerWidth,vh=window.innerHeight,y=window.scrollY,mark=document.getElementById('sunrise');
      // Before the sunrise section the horizon sinks a little; through it, it climbs the screen; after it, it drifts.
      let rot=-27,limb=.97,glow=.5,a=0,sunUp=0,fade=1;
      if(mark){
        const top=mark.offsetTop-vh*.2,end=mark.offsetTop+mark.offsetHeight-vh*.9,b=clamp(y/Math.max(1,top));
        a=clamp((y-top)/Math.max(1,end-top));
        const after=clamp((y-end)/Math.max(1,document.documentElement.scrollHeight-vh-end)),rise=ease(a);
        rot=lerp(lerp(-29,-21,b),-40,rise)-after*4;
        limb=lerp(lerp(.8,1.2,ease(b)),.1,rise)-clamp(after*3)*.22;fade=1-clamp(after*3)*.2;
        glow=lerp(lerp(.92,.42,b),1,clamp(rise*1.6));
        sunUp=clamp(a*2)*(1-clamp((a-.72)/.14));
      }
      const dayness=ease(clamp((a-.6)/.16));
      const place1=(el:HTMLCanvasElement|null)=>{if(el)el.style.transform=`translate3d(${vw/2}px,${(limb*vh).toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) translate(${(-W*LIMB_X).toFixed(1)}px,${(-H*LIMB_Y).toFixed(1)}px)`;};
      place1(night.current);place1(day.current);
      if(night.current)night.current.style.opacity=(glow*(1-dayness)).toFixed(3);
      if(day.current)day.current.style.opacity=(dayness*fade).toFixed(3);
      if(sky.current)sky.current.style.opacity=dayness.toFixed(3);
      if(sun.current)sun.current.style.opacity=sunUp.toFixed(3);
      if(dark.current)dark.current.style.opacity=(1-clamp(a*2.4)).toFixed(3);
      mark?.style.setProperty('--day',dayness.toFixed(3));
      const next=dayness>.5?'day':'night';
      if(next!==sky_){sky_=next;document.documentElement.dataset.sky=next;theme?.setAttribute('content',next==='day'?DAY:NIGHT);}
      scrollAtTop=y<vh;
    };
    const queue=()=>{if(!frame)frame=requestAnimationFrame(place);};
    const paint=()=>{
      if(!image||!pixels)return;
      const vw=window.innerWidth,vh=window.innerHeight;
      if(!vw||!vh)return; // A pane or tab still opening: the resize that follows draws it.
      W=Math.round(Math.max(vw*2.5,vh*3.6));H=Math.round(W*2/3);
      const cw=Math.max(5,W/520);
      plate=draw(night.current!,image,pixels,W,H,cw,false);
      place();
      // Daylight is only needed further down the page, so the opening screen doesn't wait for it.
      const later=()=>{if(!gone&&image&&pixels)draw(day.current!,image,pixels,W,H,cw,true);};
      if(document.getElementById('sunrise')){if('requestIdleCallback' in window)requestIdleCallback(later,{timeout:1500});else setTimeout(later,300);}
    };
    const twinkle=()=>{
      if(!plate||!scrollAtTop||document.hidden||still())return;
      const {ctx,base,cells,cw,ch,dpr}=plate;
      for(let n=Math.round(cells.length*.006);n>0;n--){
        const cell=cells[Math.floor(Math.random()*cells.length)],x=Math.floor(cell.x*dpr),y=Math.floor(cell.y*dpr),w=Math.ceil(cw*dpr)+1,h=Math.ceil(ch*dpr)+1,c=RAMP[Math.max(1,Math.min(RAMP.length-1,cell.c+(Math.random()<.5?-1:1)))];
        ctx.globalAlpha=1;ctx.clearRect(x,y,w,h);ctx.drawImage(base,x,y,w,h,x,y,w,h);
        ctx.globalAlpha=cell.alpha;ctx.fillStyle=cell.fill;ctx.fillText(c,(cell.x+cw/2)*dpr,(cell.y+ch/2)*dpr);
      }
      ctx.globalAlpha=1;
    };
    const picture=new Image();
    picture.onload=()=>{
      if(gone)return;
      const read=document.createElement('canvas');read.width=picture.naturalWidth;read.height=picture.naturalHeight;
      const c=read.getContext('2d',{willReadFrequently:true})!;
      c.drawImage(picture,0,0);pixels=c.getImageData(0,0,read.width,read.height).data;image=picture;
      void document.fonts.load("400 10px 'Mowafy Sans'").catch(()=>{}).then(()=>{if(!gone)paint();});
    };
    picture.src=horizon;
    // A phone's address bar changes the height as it scrolls: only a change of width is worth redrawing for.
    let width=window.innerWidth;
    const onResize=()=>{queue();if(plate&&window.innerWidth===width)return;width=window.innerWidth;clearTimeout(resize);resize=window.setTimeout(paint,200);};
    addEventListener('scroll',queue,{passive:true});addEventListener('resize',onResize);
    const timer=window.setInterval(twinkle,1000/6);
    return()=>{gone=true;clearInterval(timer);clearTimeout(resize);cancelAnimationFrame(frame);removeEventListener('scroll',queue);removeEventListener('resize',onResize);delete document.documentElement.dataset.sky;theme?.setAttribute('content',NIGHT);};
  },[]);
  return <div className="o-orbit" aria-hidden="true"><canvas ref={night}/><div ref={dark} className="o-dark"/><div ref={sky} className="o-daylight"/><canvas ref={day}/><div ref={sun} className="o-sun"/></div>;
}
