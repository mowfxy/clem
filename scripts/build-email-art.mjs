// Renders the app's own ink animations and the Mowr mark into animated GIFs for email.
// GIF is the only animation format Gmail and Outlook display reliably. The first frame of every
// GIF is the finished composition, so clients that show a single frame still look complete.
import fs from 'node:fs';
import {chromium} from 'playwright';
import gifenc from 'gifenc';
const {GIFEncoder,quantize,applyPalette}=gifenc;
import {filmFrame,loopSeconds} from '../src/vectorFilm.ts';

// Scenes sit on the email card; the mark sits on the page background.
const OUT='public/email',BG='#1b1b19',PAGE='#121211',INK='#f0efeb',MARK='#d9473e';
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
const petal='M96.7 10.8 C100.6 19.9 103.2 29.6 102.1 38.9 C101.1 48.1 95.8 55.7 89.5 60.7 C84.8 64.2 80 65.5 74.2 66.4 C70.7 61.8 68.2 57.5 67.2 51.7 C66.2 43.8 67.7 34.7 73.4 27.3 C79.1 19.8 87.6 14.7 96.7 10.8Z';
const gathered='M78.7 18.3 C85.8 21.2 90.4 28.2 90 35.9 C89.6 44.3 83.3 51.3 75 52.7 C71.7 53.3 68.3 52.9 65.2 51.7 C62.2 50.4 59.5 48.4 57.5 45.7 C52.5 38.9 52.9 29.5 58.5 23.1 C63.5 17.4 71.6 15.4 78.7 18.3Z'.match(/-?\d*\.?\d+/g).map(Number);
const ease=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
function mark(ms){
  const paths=[0,1,2,3].map(i=>{const t=((ms%3600)-i*100)/2600,blend=t<.12?0:t<.4?ease((t-.12)/.28):t<.54?1:1-ease((t-.54)/.34);let j=0;const d=petal.replace(/-?\d*\.?\d+/g,v=>{const f=Number(v);return (f+(gathered[j++]-f)*blend).toFixed(2);});return `<path transform="rotate(${i*90} 72 72)" d="${d}" fill="${MARK}"/>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="${PAGE}"/>${paths}</svg>`;
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
