import {useEffect,useState} from 'react';

// The website keeps the visitor's hour, as the app's new-chat screen does: paper by day, ink at night, and the same
// greeting. A visitor can pick day or night themselves; that choice is kept on this device until they pick the hour again.
const KEY='clem-site-theme';
export type SiteTheme='light'|'dark';

/** The app's greeting for an hour (src/App.tsx). */
export const greeting=(hour:number)=>hour<5?'Late night':hour<12?'Morning':hour<18?'Afternoon':'Evening';
/** Paper from six in the morning to seven in the evening, ink the rest of the night. */
export const clockTheme=(hour:number):SiteTheme=>hour>=6&&hour<19?'light':'dark';

export function chosenTheme():SiteTheme|null{try{const v=localStorage.getItem(KEY);return v==='light'||v==='dark'?v:null;}catch{return null;}}
export const siteTheme=()=>chosenTheme()??clockTheme(new Date().getHours());

/** Puts the theme on <html> and the browser's toolbar, and tells the sky to redraw its glyphs. */
export function paintTheme(theme:SiteTheme=siteTheme()){
  const root=document.documentElement;
  if(root.dataset.theme!==theme){root.dataset.theme=theme;window.dispatchEvent(new CustomEvent('clem-theme',{detail:theme}));}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#faf8f3':'#0e1017');
}

/** Switches between day and night; picking the theme the clock would pick anyway forgets the choice. */
export function flipTheme(){
  const next:SiteTheme=siteTheme()==='light'?'dark':'light';
  try{if(next===clockTheme(new Date().getHours()))localStorage.removeItem(KEY);else localStorage.setItem(KEY,next);}catch{}
  const swap=()=>paintTheme(next);
  // Paper turning to ink: a short crossfade where the browser can do it, an instant change otherwise.
  const doc=document as Document&{startViewTransition?:(cb:()=>void)=>unknown};
  if(doc.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)doc.startViewTransition(swap);else swap();
  return next;
}

/** The current hour's greeting and theme, rechecked every minute so a page left open turns with the evening. */
export function useClock(){
  const [now,setNow]=useState(()=>new Date());
  const [theme,setTheme]=useState<SiteTheme>(siteTheme);
  useEffect(()=>{
    paintTheme(theme);
    const tick=setInterval(()=>{const d=new Date();setNow(d);const t=siteTheme();setTheme(t);paintTheme(t);},60000);
    const sync=(e:Event)=>setTheme((e as CustomEvent<SiteTheme>).detail);
    window.addEventListener('clem-theme',sync);
    return()=>{clearInterval(tick);window.removeEventListener('clem-theme',sync);};
  },[]);
  return {hour:now.getHours(),greeting:greeting(now.getHours()),theme,flip:()=>setTheme(flipTheme())};
}
