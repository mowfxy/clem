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

// Mowr mark: the arms draw in one after another, the knot turns a third and opens again, as in the app's thinking
// state (Logo in src/Icons.tsx).
const arm='M62 87C60.6 83 55.2 70.5 53.5 63C51.8 55.5 51.1 48.2 52 42C52.9 35.8 55.3 30 59 26C62.7 22 69.2 18.8 74 18C78.8 17.2 84.5 19 88 21C91.5 23 93.7 26.7 95 30C96.3 33.3 95.8 39.2 96 41',numbers=arm.match(/-?\d*\.?\d+/g).map(Number),gathered=numbers.map(v=>72+(v-72)*.74);
const ease=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
function mark(ms){
  const cycle=ms%3600,turn=(120*ease((cycle/3600-.2)/.42)).toFixed(2);
  const paths=[0,1,2].map(i=>{const t=(cycle-i*100)/2600,blend=t<.12?0:t<.4?ease((t-.12)/.28):t<.54?1:1-ease((t-.54)/.34);let j=0;const d=arm.replace(/-?\d*\.?\d+/g,()=>{const f=numbers[j];return (f+(gathered[j++]-f)*blend).toFixed(2);});return `<path transform="rotate(${i*120} 72 72)" d="${d}"/>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8.5 4.5 122 122"><rect x="8.5" y="4.5" width="122" height="122" fill="${PAGE}"/><g transform="rotate(${turn} 72 72)" fill="none" stroke="${MARK}" stroke-width="14.5" stroke-linecap="round">${paths}</g></svg>`;
}
{
  const size=96,frames=[];
  frames.push([await raster(mark(0),size,size),900]);
  for(let ms=0;ms<3600;ms+=50)frames.push([await raster(mark(ms),size,size),50]);
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
