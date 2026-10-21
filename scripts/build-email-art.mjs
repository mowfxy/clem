// Renders every image the emails use into public/email/ (served from clem.m4labs.xyz/email/):
//  - m4labs-logo.png and clem-mark.gif, the two brand marks;
//  - ink-<scene>.gif, Clem's illustrations (src/vectorFilm.ts) for Clem's own emails;
//  - ascii-<scene>.gif and ascii-m4.gif, the same scenes and the M4 mark drawn as M4 Labs character grids
//    (the style of m4labs.xyz) for account emails.
// GIF is the only animation format Gmail and Outlook display reliably. Outlook for Windows shows only the first frame,
// so every loop starts on its finished pose. Each image is drawn on its own dark ground so no client can recolour it.
import fs from 'node:fs';
import {chromium} from 'playwright';
import gifenc from 'gifenc';
import {markInner,MARK_ARC,MARK_ARC_WIDTH,MARK_NUDGE} from '../core/mark.ts';
import {filmFrame,loopSeconds} from '../src/vectorFilm.ts';
import {emailArt,ART,artBackground} from '../server/email-layout.ts';
const {GIFEncoder,quantize,applyPalette}=gifenc;

const OUT='public/email',INK='#F4F2EC';
const only=process.argv.slice(2);
fs.mkdirSync(OUT,{recursive:true});
const font=(f)=>'data:font/woff2;base64,'+fs.readFileSync('public/fonts/'+f).toString('base64');
const browser=await chromium.launch();
const page=await browser.newPage();
await page.setContent(`<style>@font-face{font-family:'Mowafy Sans';src:url(${font('MowafySans-Bold.woff2')});font-weight:700}@font-face{font-family:'Mowafy Sans';src:url(${font('MowafySans-Medium.woff2')});font-weight:500}@font-face{font-family:'Fragment Mono';src:url(${font('FragmentMono-Regular.woff2')})}</style><canvas id="c"></canvas><canvas id="o"></canvas><span style="font:700 10px 'Mowafy Sans'">M</span><span style="font:500 10px 'Mowafy Sans'">l</span><span style="font:10px 'Fragment Mono'">a</span>`);
await page.evaluate(()=>Promise.all([document.fonts.load("700 100px 'Mowafy Sans'"),document.fonts.load("500 100px 'Mowafy Sans'"),document.fonts.load("20px 'Fragment Mono'")]));

// The page keeps the drawing code: an SVG rasteriser, the ASCII sampler and a text-grid painter.
await page.evaluate(()=>{
 const RAMP=' .:-=+*#%@',SCRAMBLE='!<>-_\\/[]{}=+*^?#%&$01';
 const c=document.getElementById('c'),x=c.getContext('2d',{willReadFrequently:true});
 const out=document.getElementById('o'),ox=out.getContext('2d',{willReadFrequently:true});
 const b64=(d)=>{let s='';for(let i=0;i<d.length;i+=32768)s+=String.fromCharCode(...d.subarray(i,i+32768));return btoa(s);};
 const image=async(svg)=>{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();return img;};
 // Rasterises an SVG and returns RGBA, plus the bounding box of everything drawn (for cropping scenes).
 window.raster=async(svg,w,h,bg)=>{
  const img=await image(svg);c.width=w;c.height=h;x.clearRect(0,0,w,h);if(bg){x.fillStyle=bg;x.fillRect(0,0,w,h);}x.drawImage(img,0,0,w,h);
  return b64(x.getImageData(0,0,w,h).data);
 };
 window.bbox=async(svg,w,h)=>{
  const img=await image(svg);c.width=w;c.height=h;x.clearRect(0,0,w,h);x.drawImage(img,0,0,w,h);
  const d=x.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(d[(j*w+i)*4+3]>20){if(i<x0)x0=i;if(i>x1)x1=i;if(j<y0)y0=j;if(j>y1)y1=j;}
  return [x0,y0,x1,y1];
 };
 // Ink per character cell, from a drawing of cols × rows cells. Thin pen lines are boosted so they read as characters.
 window.densities=async(svg,cols,rows,boost)=>{
  const s=6,W=cols*s,H=rows*s*2;const img=await image(svg);c.width=W;c.height=H;x.clearRect(0,0,W,H);x.drawImage(img,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data,o=new Array(cols*rows);
  for(let r=0;r<rows;r++)for(let q=0;q<cols;q++){let a=0;for(let j=r*s*2;j<(r+1)*s*2;j++)for(let i=q*s;i<(q+1)*s;i++)a+=d[(j*W+i)*4+3];o[r*cols+q]=Math.min(1,a/(s*s*2*255)*boost);}
  return o;
 };
 // Ink of a word set in Mowafy Sans Bold, read back per cell (the m4labs.xyz glyph scene).
 window.wordDensities=(text,cols,rows,fit)=>{
  const s=6,W=cols*s,H=rows*s*2;c.width=W;c.height=H;x.clearRect(0,0,W,H);x.font="700 100px 'Mowafy Sans'";
  const m=x.measureText(text),tw=m.width,th=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,k=Math.min(W*fit/tw,H*fit/th);
  x.setTransform(k,0,0,k,(W-tw*k)/2,(H-th*k)/2+m.actualBoundingBoxAscent*k);x.fillStyle='#000';x.fillText(text,0,0);x.setTransform(1,0,0,1,0,0);
  const d=x.getImageData(0,0,W,H).data,o=new Array(cols*rows);
  for(let r=0;r<rows;r++)for(let q=0;q<cols;q++){let a=0;for(let j=r*s*2;j<(r+1)*s*2;j++)for(let i=q*s;i<(q+1)*s;i++)a+=d[(j*W+i)*4+3];o[r*cols+q]=a/(s*s*2*255);}
  return o;
 };
 window.RAMP=RAMP;window.SCRAMBLE=SCRAMBLE;
 // Paints a character grid: strong characters in ink, faint ones dimmer, like depth on the site.
 window.paintGrid=(chars,cols,rows,{cell,bg,ink,dim,faint})=>{
  const cw=cell*.6,lh=cell*1.2,W=Math.round(cols*cw),H=Math.round(rows*lh);out.width=W;out.height=H;
  ox.fillStyle=bg;ox.fillRect(0,0,W,H);ox.font=`${cell}px 'Fragment Mono'`;ox.textBaseline='middle';
  for(let r=0;r<rows;r++)for(let q=0;q<cols;q++){const ch=chars[r*cols+q];if(ch===' ')continue;
   const level=RAMP.indexOf(ch);ox.fillStyle=level>=0&&level<=2?faint:level>=0&&level<=4?dim:ink;ox.fillText(ch,q*cw,r*lh+lh/2);}
  return {w:W,h:H,data:b64(ox.getImageData(0,0,W,H).data)};
 };
});
const rgba=(b64)=>new Uint8Array(Buffer.from(b64,'base64'));

/** Frames that come out identical are merged into one longer frame; one palette serves the whole loop. */
function writeGif(file,frames,w,h,colors=64){
 const merged=[];
 for(const f of frames){const last=merged.at(-1);if(last&&Buffer.compare(Buffer.from(last.rgba),Buffer.from(f.rgba))===0)last.delay+=f.delay;else merged.push({...f});}
 const step=Math.max(1,Math.floor(merged.length/6)),sample=merged.filter((_,i)=>i%step===0).map(f=>f.rgba);
 const pool=new Uint8Array(sample.reduce((n,a)=>n+a.length,0));let o=0;for(const a of sample){pool.set(a,o);o+=a.length;}
 // Each frame after the first keeps only the pixels that changed; the rest are transparent and show the frame
 // before (dispose 1), which shrinks a boiling line or a character grid to a fraction of its size.
 const palette=quantize(pool,colors-1),clear=palette.length;palette.push([255,0,255]);
 // A line that boils changes most edge pixels, so whichever encoding comes out smaller is kept.
 const encode=(diff)=>{
  const gif=GIFEncoder();let previous;
  merged.forEach((f,i)=>{
   const index=applyPalette(f.rgba,palette.slice(0,clear));
   if(!i||!diff){gif.writeFrame(index,w,h,i?{delay:f.delay}:{palette,delay:f.delay,repeat:0,dispose:1});previous=index;return;}
   const delta=index.map((v,k)=>v===previous[k]?clear:v);previous=index;
   gif.writeFrame(delta,w,h,{delay:f.delay,transparent:true,transparentIndex:clear,dispose:1});
  });
  gif.finish();return gif.bytes();
 };
 const bytes=[encode(true),encode(false)].sort((a,b)=>a.length-b.length)[0];
 fs.writeFileSync(`${OUT}/${file}`,bytes);
 return `${file}: ${merged.length} frames, ${Math.round(bytes.length/1024)} KB`;
}

// ---------- brand marks ----------
async function brand(){
 // Clem's mark only appears in Clem's emails, so it is drawn on Clem's page colour.
 const mark=(inner)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${artBackground.mark}"/>${inner}</svg>`;
 const whole=mark(markInner(INK)),arcOnly=mark(`<g transform="${MARK_NUDGE}"><path d="${MARK_ARC}" fill="none" stroke="${INK}" stroke-width="${MARK_ARC_WIDTH}" stroke-linecap="round"/></g>`);
 const frames=[];for(const [svg,delay] of [[whole,530],[arcOnly,530]])frames.push({rgba:rgba(await page.evaluate(([s])=>raster(s,78,78),[svg])),delay});
 console.log(writeGif('clem-mark.gif',frames,78,78,32));
 // The M4 Labs logo as m4labs.xyz sets it: "M4" in Mowafy Sans Bold and "labs" in a pill, at 3x for sharp screens,
 // on a transparent ground (PNG alpha works in every client) so it sits on both brands' pages.
 const png=await page.evaluate(([bg,ink])=>{
  const k=3,size=34*k,c=document.getElementById('c'),x=c.getContext('2d');
  x.font=`700 ${size}px 'Mowafy Sans'`;const m4=x.measureText('M4');
  const pill=size*.3;x.font=`500 ${pill}px 'Mowafy Sans'`;const labs=x.measureText('labs');
  const gap=size*.075,pw=labs.width+pill*.84,ph=pill*1.34,cap=m4.actualBoundingBoxAscent,W=Math.ceil(m4.width-size*.058*2+gap+pw+6*k),H=Math.ceil(cap+6*k);
  c.width=W;c.height=H;x.clearRect(0,0,W,H);x.fillStyle=ink;x.strokeStyle=ink;
  x.font=`700 ${size}px 'Mowafy Sans'`;x.letterSpacing=`${-size*.058}px`;x.textBaseline='alphabetic';x.fillText('M4',3*k,3*k+cap);
  const px=3*k+m4.width-size*.058*2+gap,py=3*k+size*-.01;x.lineWidth=pill*.09;
  x.beginPath();x.roundRect(px+x.lineWidth/2,py+x.lineWidth/2,pw-x.lineWidth,ph-x.lineWidth,ph/2);x.stroke();
  x.font=`500 ${pill}px 'Mowafy Sans'`;x.letterSpacing='0px';x.textBaseline='middle';x.fillText('labs',px+pill*.42,py+ph/2+pill*.03);
  return {w:W,h:H,url:c.toDataURL('image/png')};
 },[null,INK]);
 fs.writeFileSync(`${OUT}/m4labs-logo.png`,Buffer.from(png.url.split(',')[1],'base64'));
 console.log(`m4labs-logo.png: ${png.w}×${png.h} (shown at ${Math.round(png.w/3)}×${Math.round(png.h/3)})`);
}

// ---------- scenes ----------
const svgOf=(scene,t,box)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" color="${INK}">${filmFrame(scene,t,'e')}</svg>`;
/** A 4:3 crop around everything the scene draws over its loop, so each illustration fills its frame. */
async function crop(scene){
 const full=[0,0,480,390],u=[480,390,0,0];
 for(let t=0;t<loopSeconds[scene];t+=.25){const b=await page.evaluate(([s])=>bbox(s,480,390),[svgOf(scene,t,full)]);u[0]=Math.min(u[0],b[0]);u[1]=Math.min(u[1],b[1]);u[2]=Math.max(u[2],b[2]);u[3]=Math.max(u[3],b[3]);}
 let w=u[2]-u[0]+40,h=u[3]-u[1]+40;if(w/h<4/3)w=h*4/3;else h=w*3/4;
 return [(u[0]+u[2])/2-w/2,(u[1]+u[3])/2-h/2,w,h].map(v=>+v.toFixed(1));
}
async function ink(scene){
 const box=await crop(scene),W=ART.ink.w*2,H=ART.ink.h*2,frames=[];
 for(let i=0;i<Math.round(loopSeconds[scene]*12);i++)frames.push({rgba:rgba(await page.evaluate(([s,w,h,bg])=>raster(s,w,h,bg),[svgOf(scene,i/12,box),W,H,artBackground.ink])),delay:Math.round(1000/12)});
 return writeGif(`ink-${scene}.gif`,frames,W,H,64);
}
const look={cell:ART.ascii.cell,bg:artBackground.ascii,ink:INK,dim:'#a9a89f',faint:'#55554f'};
async function ascii(scene){
 const box=await crop(scene),{cols,rows}=ART.ascii,frames=[];let size;
 const ramp=(d)=>' .:-=+*#%@'[Math.max(0,Math.min(9,Math.round(d*9)))];
 for(let i=0;i<Math.round(loopSeconds[scene]*6);i++){
  const dens=await page.evaluate(([s,c,r])=>densities(s,c,r,3.2),[svgOf(scene,i/6,box),cols,rows]);
  const g=await page.evaluate(([ch,c,r,l])=>paintGrid(ch,c,r,l),[dens.map(d=>d>.05?ramp(Math.max(.12,d)):' '),cols,rows,look]);
  size=g;frames.push({rgba:rgba(g.data),delay:Math.round(1000/6)});
 }
 return writeGif(`ascii-${scene}.gif`,frames,size.w,size.h,8);
}
/** The M4 mark from m4labs.xyz: whole on the first frame, then scrambles away left to right and assembles again. */
async function asciiM4(){
 const {cols,m4rows:rows}=ART.ascii,dens=await page.evaluate(([c,r])=>wordDensities('M4',c,r,.86),[cols,rows]);
 const hash=(x,y)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);};
 const ramp=(d)=>' .:-=+*#%@'[Math.max(0,Math.min(9,Math.round(d*9)))],S='!<>-_\\/[]{}=+*^?#%&$01';
 let rnd=7;const rand=()=>((rnd=(rnd*16807)%2147483647)/2147483647);
 const P=5.6,frames=[];let size;
 for(let i=0;i<P*12;i++){
  const t=i/12,chars=dens.map((d,k)=>{
   const q=k%cols,r=(k/cols)|0,at=q/cols*.7+hash(q,r)*.45;
   const scrambled=t>2.2&&t<2.2+at+.35&&t>2.2+at*.6?true:t>=2.2+at*.6+.35&&t<3.4+at?'gone':false;
   if(scrambled==='gone')return d>.04&&rand()<.08?'.':' ';
   if(scrambled)return d>.04&&rand()<.75?S[(rand()*S.length)|0]:' ';
   if(t>=3.4+at&&t<3.4+at+.3)return d>.04&&rand()<.7?S[(rand()*S.length)|0]:' ';
   return d>.03?ramp(Math.max(.12,d)):' ';
  });
  const g=await page.evaluate(([ch,c,r,l])=>paintGrid(ch,c,r,l),[chars,cols,rows,look]);
  size=g;frames.push({rgba:rgba(g.data),delay:Math.round(1000/12)});
 }
 return writeGif('ascii-m4.gif',frames,size.w,size.h,8);
}

await brand();
const want=(s)=>!only.length||only.includes(s);
const inks=new Set(),asciis=new Set();
for(const a of Object.values(emailArt))(a.kind==='ink'?inks:asciis).add(a.scene);
if(want('m4'))console.log(await asciiM4());
for(const s of inks)if(want(s))console.log(await ink(s));
for(const s of asciis)if(s!=='m4'&&want(s))console.log(await ascii(s));
// The folder mirrors what is sent: anything else in it is left over from older designs.
if(!only.length){const keep=new Set(['clem-mark.gif','m4labs-logo.png',...[...inks].map(s=>`ink-${s}.gif`),...[...asciis].map(s=>`ascii-${s}.gif`)]);for(const f of fs.readdirSync(OUT))if(!keep.has(f))fs.rmSync(`${OUT}/${f}`);}
await browser.close();
