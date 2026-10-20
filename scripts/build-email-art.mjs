// Renders Clem's mark into the one image emails use: public/email/clem-mark.gif, the mark on the email's page colour with
// its cursor blinking (two frames). GIF is the only animation format Gmail and Outlook display reliably; the first frame
// shows the whole mark, so clients that show a single frame still look complete.
import fs from 'node:fs';
import {chromium} from 'playwright';
import gifenc from 'gifenc';
import {markInner,MARK_ARC,MARK_ARC_WIDTH,MARK_NUDGE} from '../core/mark.ts';
const {GIFEncoder,quantize,applyPalette}=gifenc;

const OUT='public/email',PAGE='#0b0b0a',INK='#F4F2EC',SIZE=78;
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
const frame=(inner)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${PAGE}"/>${inner}</svg>`;
const whole=frame(markInner(INK));
const arcOnly=frame(`<g transform="${MARK_NUDGE}"><path d="${MARK_ARC}" fill="none" stroke="${INK}" stroke-width="${MARK_ARC_WIDTH}" stroke-linecap="round"/></g>`);
const gif=GIFEncoder();
for(const [svg,delay] of [[whole,530],[arcOnly,530]]){
  const rgba=await raster(svg,SIZE,SIZE),palette=quantize(rgba,32);
  gif.writeFrame(applyPalette(rgba,palette),SIZE,SIZE,{palette,delay});
}
gif.finish();
fs.writeFileSync(`${OUT}/clem-mark.gif`,gif.bytes());
// The folder mirrors what is sent: anything else in it is left over from older designs.
for(const f of fs.readdirSync(OUT))if(f!=='clem-mark.gif')fs.rmSync(`${OUT}/${f}`);
await browser.close();
console.log(`clem-mark.gif: 2 frames, ${Math.round(gif.bytes().length/1024)} KB`);
