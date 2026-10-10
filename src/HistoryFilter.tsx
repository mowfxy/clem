import {useId,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icons';
import type {Space} from '../core/types';
// The sliders button beside the first day in the sidebar: search chats, or list only one space's chats.
export function HistoryFilter({scope,spaces,onScope,onSearch}:{scope:string;spaces:Space[];onScope:(scope:string)=>void;onSearch:()=>void}){
 const id=useId(),menu=useRef<HTMLDivElement>(null);
 const act=(fn:()=>void)=>{menu.current?.hidePopover();fn();};
 const option=(value:string,label:string)=><button key={value} role="menuitemradio" aria-checked={scope===value} onClick={()=>act(()=>onScope(value))}><span className="history-filter-check" aria-hidden="true">{scope===value?'✓':''}</span>{label}</button>;
 return <><button className={`icon-button history-filter ${scope!=='all'?'is-filtered':''}`} aria-label="Filter chats" aria-description="Search or filter chats" popoverTarget={id} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();if(menu.current){menu.current.style.left=`${Math.min(rect.left,window.innerWidth-240)}px`;menu.current.style.top=`${rect.bottom+6}px`;}}}><Icon name="sliders" size={18}/></button>{createPortal(<div id={id} ref={menu} popover="auto" role="menu" className="chat-options history-filter-menu"><button onClick={()=>act(onSearch)}>Search chats<kbd>Ctrl K</kbd></button><hr/>{option('all','All chats')}{option('none','Not in a space')}{spaces.map(s=>option(s.id,s.name))}</div>,document.body)}</>;
}
