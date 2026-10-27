import {Fragment,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Icon} from '../Icons';
import {menuKeys,useMenuKeys} from '../menuKeys';

/** The edges a menu must stay inside: the window, narrowed by every scrolling or clipping box it sits in. */
function bounds(el:HTMLElement){
  let top=0,bottom=window.innerHeight,left=0,right=window.innerWidth;
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
    const s=getComputedStyle(p);
    if(/(auto|scroll|hidden|clip)/.test(s.overflowY+s.overflowX)){const r=p.getBoundingClientRect();top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);left=Math.max(left,r.left);right=Math.min(right,r.right);}
  }
  return {top,bottom,left,right};
}

/** A file or folder's ⋯ menu (or a custom trigger), shared by the local and Google Drive lists. */
/** `handle`: props that also make the button a drag handle (src/space/reorder.ts); a plain click still opens the menu. */
export function Menu({label,items,trigger,handle}:{label:string;items:{label:string;icon?:string;danger?:boolean;run:()=>void}[];trigger?:ReactNode;handle?:Record<string,unknown>}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),list=useRef<HTMLDivElement>(null);
  // Closes on a click elsewhere, Escape, and when the person switches to another app: a menu left open behind the window
  // came back on the next hover of its row, as if hovering had opened it.
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const leave=()=>setOpen(false);const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',close);window.addEventListener('blur',leave);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('blur',leave);document.removeEventListener('keydown',key);};},[open]);
  // Opens below its button, or above it when the room below runs out (a row near the bottom of the window), and moves
  // in from a side edge; with no room either way it takes the larger side and scrolls.
  useLayoutEffect(()=>{
    const el=list.current,button=root.current;if(!open||!el||!button)return;
    el.style.top=el.style.bottom=el.style.left=el.style.right=el.style.maxHeight='';el.classList.remove('up');
    const edge=bounds(button),gap=8,at=button.getBoundingClientRect(),box=el.getBoundingClientRect();
    const below=edge.bottom-at.bottom-gap,above=at.top-edge.top-gap;
    if(box.height>below&&above>below){el.classList.add('up');el.style.top='auto';el.style.bottom='calc(100% + 4px)';if(box.height>above)el.style.maxHeight=`${above}px`;}
    else if(box.height>below)el.style.maxHeight=`${Math.max(below,120)}px`;
    const now=el.getBoundingClientRect();
    if(now.left<edge.left+gap){el.style.right='auto';el.style.left='0';}
    else if(now.right>edge.right-gap){el.style.left='auto';el.style.right='0';}
  },[open]);
  const keys=menuKeys(items),choose=(i:number)=>{setOpen(false);items[i].run();};
  useMenuKeys(open,keys,choose);
  return <div className="sp-menu" ref={root}><button type="button" {...handle} className={trigger?'sp-menu-trigger':'icon-button'} aria-label={label} aria-expanded={open} onClick={e=>{e.stopPropagation();setOpen(!open);}}>{trigger||<Icon name="menu" size={16}/>}</button>
    {open&&<div className="sp-menu-list" role="menu" ref={list}>{items.map((i,n)=><Fragment key={i.label}>{i.danger&&n>0&&!items[n-1].danger&&<hr/>}<button type="button" role="menuitem" className={i.danger?'danger':''} aria-keyshortcuts={keys[n]||undefined} onClick={e=>{e.stopPropagation();choose(n);}}>{i.label}{keys[n]&&<span className="menu-key" aria-hidden="true">{keys[n]}</span>}</button></Fragment>)}</div>}</div>;
}
export function FolderIcon(){return <span className="sp-folder-icon"><Icon name="folder" size={30}/></span>;}
