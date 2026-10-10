import { useEffect,useRef } from 'react';
// Icons: one even line on a 32-unit grid, rounded ends, and at most one soft grey fill per icon.
// A drawing is a list of strokes; a stroke starting with "F " is also filled. Hover motion in CSS
// targets strokes by index (`.icon-<name> .stroke-<i>`), so keep each icon's stroke order.
const c=(x:number,y:number,r:number)=>`M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0Z`;
const box=(x:number,y:number,w:number,h:number,r=2)=>`M${x+r} ${y}h${w-2*r}a${r} ${r} 0 0 1 ${r} ${r}v${h-2*r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w-2*r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h-2*r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const page='M8 4h11l7 7v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z';
const bubble='M16 5C9.4 5 4 9.3 4 14.7c0 2.8 1.4 5.3 3.7 7.1L6.5 27l5.9-2.7c1.1.3 2.3.4 3.6.4 6.6 0 12-4.3 12-9.8S22.6 5 16 5Z';
const shieldPath='M16 3.5l10.5 4v7.3c0 6.4-4.4 11.1-10.5 13.7C9.9 25.9 5.5 21.2 5.5 14.8V7.5Z';
const drawings:Record<string,string[]>={
// Slash commands (core/commands.ts): one drawing each, so a command reads at a glance in the menu and its chip.
'cmd-pdf':['F '+page,'M19 4v7h7','M10.5 17h11','M10.5 22h7'],
'cmd-explain':['F M16 4a8 8 0 0 0-4.8 14.4c1 .8 1.8 2 1.8 3.3V23h6v-1.3c0-1.3.8-2.5 1.8-3.3A8 8 0 0 0 16 4Z','M13 27h6'],
'cmd-solve':['M5 9h8M9 5v8','M18 7h9M18 11h9','M6.5 22l4 4 8-9'],
'cmd-summarize':['M5 7h22','M5 13h22','M5 19h15','M5 25h8'],
'cmd-notes':['F '+box(5,5,16,23),'M9 11h8M9 16h8M9 21h4','M28.5 7.5a1.8 1.8 0 0 0-2.8-.3L19 18l-.8 4 3.4-2.2 7.2-10.4a1.5 1.5 0 0 0-.3-1.9Z'],
'cmd-flashcards':['M10 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3','F '+box(4,9,19,19),'M8 16h11M8 21h6'],
'cmd-quiz':['F '+bubble,'M13 12a3 3 0 1 1 4.2 2.8c-.7.3-1.2 1-1.2 1.8v.4','M16 20.6v.1'],
'cmd-remember':['F M16 6.5a4.5 4.5 0 0 0-8.4 1.9A5 5 0 0 0 5 16a5 5 0 0 0 3 7.4A4.5 4.5 0 0 0 16 25.5Z','M16 6.5a4.5 4.5 0 0 1 8.4 1.9A5 5 0 0 1 27 16a5 5 0 0 1-3 7.4 4.5 4.5 0 0 1-8 2.1','M16 6.5v19'],
'cmd-routine':['M26.8 12.5A11.2 11.2 0 1 0 27.2 18','M27.5 5.5v7h-7','F '+c(16,16,1.4),'M16 10v6l4 3'],
'cmd-outline':['F '+c(7,7.5,2),'M12 7.5h15','M16 13.5h11','F '+c(7,19.5,2),'M12 19.5h15','M16 25.5h9'],
'cmd-feedback':['F M6 5h20a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H14l-6 5v-5H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z','M11 13.5l3.5 3.5 6.5-7'],
'cmd-plan':[box(4,7,24,21),'F M4 9a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v4H4Z','M10 4v5M22 4v5','M11.5 20.5l3 3 6-6'],
'cmd-mnemonic':['M4 26c5-2 8-6 12-10','F M16 16c-3.5-4.5-4-9.5-.5-10s3 5.5.5 10Z','F M16 16c4.5-2.5 9.5-1.8 9.5 1.2S20 18.5 16 16Z','M16 16c3 4.5 7 8 12 10'],
'cmd-debate':['F M6 4h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3.5V15a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','M23 12h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2v3.5L22 23h-7a2 2 0 0 1-2-2v-2'],
'cmd-translate':['M4 25l5.5-15L15 25','M6 20h7','M18 7h10','M23 4v3','M26 7c-1 5-4 9-8 11.5','M20.5 11c1.5 3 4 5.5 7.5 7'],
'cmd-compact':['M16 3v9','M12 8l4 4 4-4','M16 29v-9','M12 24l4-4 4 4','M5 16h22'],
'cmd-handoff':['F '+box(4,6,12,20),'M8 12h4M8 16.5h4','M19 16h9','M24 12l4 4-4 4'],
copy:['F '+box(11,11,17,17),'M6 21a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2'],
compare:['F M7 4h9a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-6l-4 3.5V15a3 3 0 0 1-2-2.8V7a3 3 0 0 1 3-3Z','M24 12h1a3 3 0 0 1 3 3v6a3 3 0 0 1-2 2.8V27l-4-4h-6a3 3 0 0 1-3-3v-1','M18.5 19l2 2 4-4.5'],
verify:['F '+shieldPath,'M11 16l3.5 3.5L21.5 12'],
capture:['M4 10V6a2 2 0 0 1 2-2h4M22 4h4a2 2 0 0 1 2 2v4M28 22v4a2 2 0 0 1-2 2h-4M10 28H6a2 2 0 0 1-2-2v-4','F '+box(11,12,10,8,1.5)],
undo:['M10 9l-5 5 5 5','M5 14h13.5a7 7 0 0 1 0 14H13'],
import:['M5 18v7a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-7','M16 4v15','M10 13l6 6 6-6'],
pin:['F M12 4h8l-1.5 7.5L23 16v3H9v-3l4.5-4.5Z','M16 19v9'],
unpin:['F M12 4h8l-1.5 7.5L23 16v3H9v-3l4.5-4.5Z','M16 19v9','M4 4l24 24'],
new:['M26 17v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h8','F M24 3.8a2.4 2.4 0 0 1 3.4 3.4L17 17.6l-4.6 1 1-4.6Z'],
chat:['F '+bubble,'M11 13h10M11 18h6'],
temp:['F M6 27V14a10 10 0 0 1 20 0v13l-3.3-2.6L19.3 27 16 24.4 12.7 27 9.3 24.4Z','M12.5 14v.1','M19.5 14v.1'],
// Visuals: a circle, a triangle and a square, the parts every figure is made of. The triangle turns on hover.
visuals:['F '+c(22.5,9.5,5.5),'M10 4.5l6.5 11h-13Z',box(9,18.5,14,9.5)],
projects:['F M4 9a2 2 0 0 1 2-2h6l3 3h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z','M4 15h24'],
subjects:['F M16 8c-3-2.5-7-3-12-2v19c5-1 9-.5 12 2Z','M16 8c3-2.5 7-3 12-2v19c-5-1-9-.5-12 2','M16 8v19'],
connectors:['F M11 4v6M17 4v6M8 10h12v5a6 6 0 0 1-12 0Z','M14 21v2a4 4 0 0 0 4 4h5a4 4 0 0 0 4-4v-2'],
models:['F '+box(8,8,16,16),'M13 8V4M19 8V4M13 24v4M19 24v4M8 13H4M8 19H4M24 13h4M24 19h4',box(13,13,6,6,1)],
drive:['F M11.5 5h9l8.5 15H20Z','M11.5 5L3 20l4.5 7M20 20H3','M7.5 27h17l4.5-7'],
github:['F '+c(10,7,3),c(10,25,3),c(22,10,3),'M10 10v12','M22 13c0 6-12 4-12 9'],
skills:['M7 16v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V16','F '+box(5,11,22,5,1.5),'M16 11v17','M16 11c-2-4-7-5-7-2s5 2 7 2c2 0 7 1 7-2s-5-2-7 2'],
files:['F '+page,'M19 4v7h7','M10.5 17h11M10.5 22h8'],
settings:['M4 10h24M4 22h24',c(11,10,3.5),c(21,22,3.5)],
long:['F '+box(4,4,9,9),'M13 8.5h6a4 4 0 0 1 4 4V19','M19 19h9v9h-9z'],
research:['F '+c(14,14,9),'M20.5 20.5L28 28','M10 13a4 4 0 0 1 4-4'],
search:['F '+c(14,14,9),'M20.5 20.5L28 28'],
diagram:['M4 4v24h24','M8 22c4-10 8-12 11-8s5 2 8-6','F '+c(19,14,2)],
slides:['F '+box(4,5,24,17),'M16 22v5M11 28h10','M9 17l5-5 4 3 5-5'],
analysis:['M4 28h24','F '+box(7,18,4,7,1)+box(14,11,4,14,1)+box(21,5,4,20,1)],
play:[c(16,16,12),'F M13 10.5l8.5 5.5-8.5 5.5Z'],
arrow:['M5 16h22','M20 9l7 7-7 7'],up:['M16 27V5','M8 13l8-8 8 8'],plus:['M16 5v22','M5 16h22'],close:['M8 8l16 16','M24 8L8 24'],down:['M8 12.5l8 8 8-8'],chevron:['M9 13l7 7 7-7'],
menu:['M5 8h22M5 16h22M5 24h22'],check:['M6 17l7 7L26 8'],
trash:['M5 8h22','M12 8V5h8v3','F M8 8l1.5 18a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2L24 8','M13.5 13v10M18.5 13v10'],
clock:['F '+c(16,16,12),'M16 9v7l5 3'],
account:['F '+c(16,11,6),'M5 28c0-6 5-9 11-9s11 3 11 9'],
download:['M16 4v15M9 12l7 7 7-7','M5 22v4a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-4'],
lock:['F '+box(6,14,20,14),'M10.5 14v-4a5.5 5.5 0 0 1 11 0v4','M16 19v4'],
expand:['M19 5h8v8','M27 5l-8.5 8.5','M13 27H5v-8','M5 27l8.5-8.5'],
collapse:['M18.5 5v8.5H27','M18.5 13.5L27 5','M13.5 27v-8.5H5','M13.5 18.5L5 27'],
attach:['M26 15L16.2 24.8a6 6 0 0 1-8.5-8.5L18 6a4 4 0 0 1 5.7 5.7L13.5 21.8a2 2 0 0 1-2.8-2.8L20 9.5'],
mail:['F '+box(4,7,24,18),'M5 9l11 8 11-8'],
globe:[c(16,16,12),'M4 16h24','F M16 4c-4 4-5 8-5 12s1 8 5 12c4-4 5-8 5-12s-1-8-5-12Z'],
spark:['F M16 4c1 6 3.5 8.5 9.5 9.5-6 1-8.5 3.5-9.5 9.5-1-6-3.5-8.5-9.5-9.5 6-1 8.5-3.5 9.5-9.5Z','M25 4v5M22.5 6.5h5'],
alert:['F M14.3 6a2 2 0 0 1 3.4 0l10.4 18.5a2 2 0 0 1-1.7 3H5.6a2 2 0 0 1-1.7-3Z','M16 12.5v6.5','M16 23v.1'],
send:['F M4 15L28 4l-8 24-4-9Z','M16 19L28 4'],
refresh:['M26 12A10.5 10.5 0 0 0 7 9.5','M6 4v6h6','M6 20a10.5 10.5 0 0 0 19 2.5','M26 28v-6h-6'],
external:['M19 5h8v8','M27 5L16 16','M24 19v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h6'],
// The admin portal's navigation and actions.
overview:['F '+box(5,5,9,11),box(18,5,9,6),box(18,15,9,12),box(5,20,9,7)],
users:['F '+c(12,11,5),'M3 27c0-5 4-8 9-8s9 3 9 8','M21 6.5a5 5 0 0 1 0 9','M24 19.5c3 1 5 3.5 5 7.5'],
card:['F '+box(4,7,24,18,3),'M4 13h24','M8 20h5'],
inbox:['F M8 6h16l4 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7Z','M4 18h7l2 3h6l2-3h7'],
megaphone:['F M5 13v6a1.5 1.5 0 0 0 1.5 1.5H9l9 6V5.5l-9 6H6.5A1.5 1.5 0 0 0 5 13Z','M23 11a6 6 0 0 1 0 10','M10.5 21l1.5 6'],
shield:['F '+shieldPath,'M11 16l3.5 3.5L21.5 12'],
log:['F '+c(6,8,1.6)+c(6,16,1.6)+c(6,24,1.6),'M11 8h16M11 16h16M11 24h16'],
logout:['M20 5h5a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2h-5','M13 9l7 7-7 7','M20 16H4'],
note:['F '+page,'M19 4v7h7','M11 17h10M11 22h7'],
gift:['M7 16v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V16','F '+box(5,11,22,5,1.5),'M16 11v17','M16 11c-2-4-7-5-7-2s5 2 7 2c2 0 7 1 7-2s-5-2-7 2'],
ban:[c(16,16,12),'M7.5 7.5l17 17'],
// Small glyphs that screens used to draw for themselves.
bug:['F M11 11a5 5 0 0 1 10 0v7a5 5 0 0 1-10 0Z','M16 13v10','M5 15h6M21 15h6M7 8l4 3M25 8l-4 3M7 25l4-3M25 25l-4-3','M13 6l-1.5-2.5M19 6l1.5-2.5'],
idea:['F M16 4a8 8 0 0 0-4.8 14.4c1 .8 1.8 2 1.8 3.3V23h6v-1.3c0-1.3.8-2.5 1.8-3.3A8 8 0 0 0 16 4Z','M13 27h6'],
question:['F M6 6h20a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H13l-7 5v-5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z','M10 12.5h12M10 17h7'],
rename:['F M6 26l1.5-6L21 6.5a2.8 2.8 0 0 1 4 4L11.5 24Z','M18.5 9l4.5 4.5'],
flame:['F M16 3.5c.8 4.5 7.5 7.8 7.5 15A7.5 7.5 0 0 1 16 26a7.5 7.5 0 0 1-7.5-7.7c0-3.4 2-5.4 3.2-6.8.4 2.4 1.6 3.8 3 4.2C14 10.8 14.6 6.8 16 3.5Z'],
folder:['F M4 9a2 2 0 0 1 2-2h6l3 3h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z','M4 15h24'],
grid:[box(5,5,9,9),'F '+box(18,5,9,9),box(5,18,9,9),box(18,18,9,9)],
sliders:['M10 4v8','F '+c(10,15.5,3.5),'M10 19v9','M22 4v9','F '+c(22,16.5,3.5),'M22 20v8'],
list:['F '+c(6,8,1.6)+c(6,16,1.6)+c(6,24,1.6),'M11 8h16M11 16h16M11 24h16'],
right:['M12.5 8l8 8-8 8'],
playhead:['F M11 7l14.5 9L11 25Z'],stop:['F '+box(9,9,14,14,2.5)],wrap:['M6 9h20','M6 16h15.5a4 4 0 0 1 0 8H16','M19 21l-3 3 3 3','M6 24h5'],
pause:['F '+box(8,6,5.5,20,2)+box(18.5,6,5.5,20,2)],
restart:['M6.5 16a9.5 9.5 0 1 0 3-6.9','M6 4.5v6h6'],
cube:['F M16 4l11 6v12L16 28 5 22V10Z','M5 10l11 6 11-6','M16 16v12']};
/** Draws a list of strokes (see `drawings`) as paths, filling the ones marked "F ". */
export function strokes(list:string[]){return list.map((d,i)=>{const filled=d.startsWith('F ');return <path key={i} pathLength={1} d={filled?d.slice(2):d} className={`stroke stroke-${i}`} {...(filled?{fill:'currentColor',fillOpacity:.3}:{})}/>;});}
export function Icon({name,size=22}:{name:string;size?:number}){return <svg className={`drawn-icon ink-icon icon-${name}`} width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{strokes(drawings[name]||drawings.files)}</svg>;}
const petal='M64 11 C87 4 104 20 103 42 C103 57 94 70 84 72 C78 73 79 65 81 61 C85 48 75 43 65 48 C55 52 49 43 49 31 C49 22 54 15 64 11Z';
export function Logo({size=34,thinking=false}:{size?:number;thinking?:boolean}){
 const ref=useRef<SVGSVGElement>(null);
 useEffect(()=>{const el=ref.current!;const media=matchMedia('(prefers-reduced-motion: reduce)');let frame=0,last=-1;const paths=Array.from(el.querySelectorAll('.mark-petal path'));
 const reset=()=>{cancelAnimationFrame(frame);frame=0;paths.forEach(p=>p.setAttribute('d',petal));};
 // Authored matching Bezier poses keep contours smooth throughout the morph.
 const gathered='M72 17 C82 17 90 25 90 35 C90 45 82 53 72 53 C66 53 62 50 59 46 C56 42 54 39 54 35 C54 25 59 20 65 18 C67 17 69 17 72 17Z'.match(/-?\d*\.?\d+/g)!.map(Number);
 const started=performance.now();
 const ease=(t:number)=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
 const tick=(now:number)=>{const cel=Math.floor(now/24);if(cel!==last){last=cel;paths.forEach((path,i)=>{
   const t=((now-started)%3600-i*100)/2600;
   const blend=t<.12?0:t<.4?ease((t-.12)/.28):t<.54?1:1-ease((t-.54)/.34);
   let j=0;path.setAttribute('d',petal.replace(/-?\d*\.?\d+/g,value=>{const from=Number(value);return (from+(gathered[j++]-from)*blend).toFixed(2);}));
 });}if(frame)frame=requestAnimationFrame(tick);};
 const sync=()=>{reset();if(thinking&&!document.hidden&&!media.matches&&document.documentElement.dataset.quiet!=='true')frame=requestAnimationFrame(tick);};
 sync();media.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-quiet']});return()=>{reset();observer.disconnect();media.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[thinking]);
 return <svg ref={ref} width={size} height={size} viewBox="0 0 144 144" className={`mowr-mark ${thinking?'is-thinking':''}`} role={thinking?'img':undefined} aria-label={thinking?'Mowr is thinking':undefined} aria-hidden={thinking?undefined:true}>{[0,90,180,270].map((angle,i)=><g key={angle} transform={`rotate(${angle} 72 72)`}><g className={`mark-petal petal-${i}`}><path d={petal} fill="currentColor"/></g></g>)}</svg>;
}

export function GoogleLogo(){return <svg width="21" height="21" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M44 24.5c0-1.5-.1-3-.4-4.5H24v8.5h11.2c-.5 2.7-2 5-4.2 6.5v5.4h6.8C41.8 36.7 44 31.1 44 24.5Z"/><path fill="#34A853" d="M24 45c5.6 0 10.3-1.8 13.8-5.1L31 34.5c-1.9 1.3-4.3 2-7 2-5.4 0-10-3.6-11.6-8.5h-7v5.6A21 21 0 0 0 24 45Z"/><path fill="#FBBC05" d="M12.4 28a12.7 12.7 0 0 1 0-8v-5.6h-7a21 21 0 0 0 0 19.2Z"/><path fill="#EA4335" d="M24 11.5c3 0 5.6 1 7.7 3l5.8-5.8A20 20 0 0 0 24 3 21 21 0 0 0 5.4 14.4l7 5.6C14 15.1 18.6 11.5 24 11.5Z"/></svg>}
