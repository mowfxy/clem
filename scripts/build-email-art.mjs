// Renders the app's own ink animations and the Mowr mark into animated GIFs for email.
// GIF is the only animation format Gmail and Outlook display reliably. The first frame of every
// GIF is the finished composition, so clients that show a single frame still look complete.
import fs from 'node:fs';
import {chromium} from 'playwright';
import gifenc from 'gifenc';
const {GIFEncoder,quantize,applyPalette}=gifenc;
import {filmFrame} from '../src/vectorFilm.ts';

// Scenes sit on the email card; the mark sits on the page background.
const OUT='public/email',BG='#1b1b19',PAGE='#121211',INK='#f0efeb';
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

// Mowr mark: each petal gathers toward the centre and opens again, staggered, as in the app's thinking state.
const petal='M64 11 C87 4 104 20 103 42 C103 57 94 70 84 72 C78 73 79 65 81 61 C85 48 75 43 65 48 C55 52 49 43 49 31 C49 22 54 15 64 11Z';
const gathered='M72 17 C82 17 90 25 90 35 C90 45 82 53 72 53 C66 53 62 50 59 46 C56 42 54 39 54 35 C54 25 59 20 65 18 C67 17 69 17 72 17Z'.match(/-?\d*\.?\d+/g).map(Number);
const ease=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
function mark(ms){
  const paths=[0,1,2,3].map(i=>{const t=((ms%3600)-i*100)/2600,blend=t<.12?0:t<.4?ease((t-.12)/.28):t<.54?1:1-ease((t-.54)/.34);let j=0;const d=petal.replace(/-?\d*\.?\d+/g,v=>{const f=Number(v);return (f+(gathered[j++]-f)*blend).toFixed(2);});return `<path transform="rotate(${i*90} 72 72)" d="${d}" fill="${INK}"/>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="${PAGE}"/>${paths}</svg>`;
}
{
  const size=96,frames=[];
  frames.push([await raster(mark(0),size,size),900]);
  for(let ms=0;ms<3600;ms+=50)frames.push([await raster(mark(ms),size,size),50]);
  encode(frames,size,size,'mowr-mark.gif');
}

// Ink scenes: complete still → the authored action → a held ending, then loop.
const W=360,H=292;
for(const scene of process.argv.includes('--mark-only')?[]:['envelope','key','door','swap','invite','keypad','shield','link','unlink','lock','unlock','plane','hourglass','untangle','coin','balance','box']){
  const svg=t=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 390"><rect width="480" height="390" fill="${BG}"/>${filmFrame(scene,t,'f')}</svg>`;
  const frames=[[await raster(svg(6),W,H),1400]];
  for(let t=0;t<6;t+=1/10)frames.push([await raster(svg(t),W,H),100]);
  frames.push([await raster(svg(6),W,H),2200]);
  encode(frames,W,H,`${scene}.gif`);
}
// Remove artwork no email uses any more, so the folder mirrors what is sent.
if(!process.argv.includes('--mark-only'))for(const f of fs.readdirSync(OUT))if(f.endsWith('.gif')&&f!=='mowr-mark.gif'&&!['envelope','key','door','swap','invite','keypad','shield','link','unlink','lock','unlock','plane','hourglass','untangle','coin','balance','box'].includes(f.slice(0,-4)))fs.rmSync(`${OUT}/${f}`);
await browser.close();
