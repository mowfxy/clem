import {Fragment,useEffect,useRef,useState,type ReactNode} from 'react';
import {Icon} from '../Icons';

/** A file or folder's ⋯ menu (or a custom trigger), shared by the local and Google Drive lists. */
/** `handle`: props that also make the button a drag handle (src/space/reorder.ts); a plain click still opens the menu. */
export function Menu({label,items,trigger,handle}:{label:string;items:{label:string;icon?:string;danger?:boolean;run:()=>void}[];trigger?:ReactNode;handle?:Record<string,unknown>}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
  return <div className="sp-menu" ref={root}><button type="button" {...handle} className={trigger?'sp-menu-trigger':'icon-button'} aria-label={label} aria-expanded={open} onClick={e=>{e.stopPropagation();setOpen(!open);}}>{trigger||<Icon name="menu" size={16}/>}</button>
    {open&&<div className="sp-menu-list" role="menu">{items.map((i,n)=><Fragment key={i.label}>{i.danger&&n>0&&!items[n-1].danger&&<hr/>}<button type="button" role="menuitem" className={i.danger?'danger':''} onClick={e=>{e.stopPropagation();setOpen(false);i.run();}}>{i.label}</button></Fragment>)}</div>}</div>;
}
export function FolderIcon(){return <span className="sp-folder-icon"><Icon name="folder" size={30}/></span>;}
