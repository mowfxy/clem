import {useId,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icons';
export function ChatMenu({title,pinned,disabled,onPin,onExport,onDelete}:{title:string;pinned:boolean;disabled:boolean;onPin:()=>void;onExport:()=>void;onDelete:()=>void}){
 const id=useId(),menu=useRef<HTMLDivElement>(null);
 const act=(fn:()=>void)=>{menu.current?.hidePopover();fn();};
 return <><button className="history-more" aria-label={`Chat options for ${title}`} popoverTarget={id} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();if(menu.current){menu.current.style.left=`${rect.right+8}px`;menu.current.style.top=`${Math.min(rect.top,window.innerHeight-150)}px`;}}}><span aria-hidden="true">···</span></button>{createPortal(<div id={id} ref={menu} popover="auto" className="chat-options"><button onClick={()=>act(onPin)}><Icon name={pinned?"unpin":"pin"} size={16}/>{pinned?'Unpin chat':'Pin chat'}</button><button onClick={()=>act(onExport)}><Icon name="download" size={16}/>Export chat</button><button disabled={disabled} onClick={()=>act(onDelete)}><Icon name="trash" size={16}/>Delete chat</button></div>,document.body)}</>;
}
