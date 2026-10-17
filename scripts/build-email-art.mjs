// Renders the app's own ink animations and the Mowr mark into animated GIFs for email.
// GIF is the only animation format Gmail and Outlook display reliably. The first frame of every
// GIF is the finished composition, so clients that show a single frame still look complete.
import fs from 'node:fs';
import {chromium} from 'playwright';
import gifenc from 'gifenc';
const {GIFEncoder,quantize,applyPalette}=gifenc;
import {filmFrame,loopSeconds} from '../src/vectorFilm.ts';

// Scenes sit on the email card; the mark sits on the page background.
const OUT='public/email',BG='#1b1b19',PAGE='#121211',INK='#f0efeb',MARK='#b56c4b';
fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
async function raster(svg,w,h){
  const b64=await page.evaluate(async ([svg,w,h])=>{
    const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
    const c=document.getElementById('c');c.width=w;c.height=h;const x=c.getContext('2d');x.clearRect(0,0,w,h);x.drawImage(img,0,0,w,h);
    const d=x.getImageData(0,0,w,h).data;let s='';for(let i=0;i<d.length;i+=32768)s+=String.fromCharCode(...d.subarray(i,i+32768));return btoa(s);
  },[svg,w,h]);
  return new Uint8Array(Buffer.from(b64,'base64'));
}
function encode(frames,w,h,file){
  const gif=GIFEncoder();
  for(const [rgba,delay] of frames){const palette=quantize(rgba,64);gif.writeFrame(applyPalette(rgba,palette),w,h,{palette,delay});}
  gif.finish();fs.writeFileSync(`${OUT}/${file}`,gif.bytes());
  console.log(`${file}: ${frames.length} frames, ${Math.round(gif.bytes().length/1024)} KB`);
}

// Mowr mark: a ripple runs out from the centre of the seed head, as in the app's thinking state
// (Logo in src/Icons.tsx; geometry and motion from core/mark.ts, repeated here in plain JS).
const step=39/Math.sqrt(61.5),seeds=Array.from({length:61},(_,k)=>[step*Math.sqrt(k+.5)*Math.cos(k*2.39996323),step*Math.sqrt(k+.5)*Math.sin(k*2.39996323),step*(.3+.48*((k+1)/61)**1.3)]);
function mark(ms){
  const t=ms/1000,dots=seeds.map(([x,y,r],k)=>`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r*(1+.32*Math.sin(2*Math.PI*t/1.9-Math.sqrt(k)*1.15))).toFixed(2)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -45 90 90"><rect x="-45" y="-45" width="90" height="90" fill="${PAGE}"/><g fill="${MARK}">${dots}</g></svg>`;
}
{
  const size=96,frames=[];
  frames.push([await raster(mark(0),size,size),900]);
  for(let ms=0;ms<1900;ms+=50)frames.push([await raster(mark(ms),size,size),50]);
  encode(frames,size,size,'mowr-mark.gif');
}

// Ink scenes: each plays its own loop once on twos and repeats; the first frame is the finished pose.
const W=360,H=292;
const SCENES=['envelope','key','door','swap','invite','keypad','shield','link','unlink','lock','unlock','plane','hourglass','untangle','box','wave','build'];
// --only=wave,build re-renders just those scenes and leaves the rest untouched.
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
for(const scene of process.argv.includes('--mark-only')?[]:SCENES.filter(s=>!only||only.includes(s))){
  const svg=t=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 390" color="${INK}"><rect width="480" height="390" fill="${BG}"/>${filmFrame(scene,t,'f')}</svg>`;
  const frames=[];
  for(let i=0;i<Math.round(loopSeconds[scene]*12);i++)frames.push([await raster(svg(i/12),W,H),83]);
  encode(frames,W,H,`${scene}.gif`);
}
// Remove artwork no email uses any more, so the folder mirrors what is sent.
if(!process.argv.includes('--mark-only')&&!only)for(const f of fs.readdirSync(OUT))if(f.endsWith('.gif')&&f!=='mowr-mark.gif'&&!SCENES.includes(f.slice(0,-4)))fs.rmSync(`${OUT}/${f}`);
await browser.close();
