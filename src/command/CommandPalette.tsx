import {useEffect,useMemo,useRef,useState} from 'react';
import {Icon} from '../Icons';
import './command.css';

export type Command={id:string;group:string;label:string;hint?:string;icon:string;keywords?:string;run:()=>void};

/** Scores a command by how early and how contiguously the query appears. */
function score(command:Command,query:string){
  if(!query)return 1;
  const text=(command.label+' '+(command.keywords||'')).toLowerCase();
  const q=query.toLowerCase().trim();
  const at=text.indexOf(q);
  if(at===0)return 100;
  if(at>0)return 60-Math.min(at,50)/2+(text[at-1]===' '?15:0);
  // Letters typed in order count only when they sit close together ("rmp" finds "roadmap"), not scattered across a label.
  let best=Infinity;
  for(let start=text.indexOf(q[0]);start>=0;start=text.indexOf(q[0],start+1)){
    let i=1,end=start;
    for(let j=start+1;j<text.length&&i<q.length;j++)if(text[j]===q[i]){i++;end=j;}
    if(i===q.length)best=Math.min(best,end-start+1);
  }
  return best<=q.length*2+1?10-Math.min(9,best-q.length):0;
}

/** The label with the typed text marked where it appears, so it is clear why a result matched. */
function Marked({text,query}:{text:string;query:string}){
  const q=query.trim().toLowerCase(),at=q?text.toLowerCase().indexOf(q):-1;
  if(at<0)return <>{text}</>;
  return <>{text.slice(0,at)}<mark>{text.slice(at,at+q.length)}</mark>{text.slice(at+q.length)}</>;
}

export function CommandPalette({commands,onClose}:{commands:Command[];onClose:()=>void}){
  const [query,setQuery]=useState('');
  const [active,setActive]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),list=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const results=useMemo(()=>commands.map(c=>({c,s:score(c,query)})).filter(r=>r.s>0).sort((a,b)=>b.s-a.s).slice(0,40).map(r=>r.c),[commands,query]);
  // With nothing typed: the latest conversations first, then actions and pages, a few spaces, and settings, so recent
  // chats are always one key away however many spaces and settings there are.
  const groups=useMemo(()=>{
    if(query)return results.length?[['Results',results]] as [string,Command[]][]:[];
    const map=new Map<string,Command[]>();
    for(const c of commands)map.set(c.group,[...(map.get(c.group)||[]),c]);
    const order=['Recent conversations','Actions','Go to','Projects','Subjects','Settings'];
    const cap:Record<string,number>={'Recent conversations':5,Projects:6,Subjects:6};
    return [...map].sort(([a],[b])=>(order.indexOf(a)+1||99)-(order.indexOf(b)+1||99)).map(([g,items])=>[g,items.slice(0,cap[g]??items.length)] as [string,Command[]]);
  },[results,commands,query]);
  const flat=groups.flatMap(([,items])=>items);
  useEffect(()=>setActive(0),[query]);
  useEffect(()=>{list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active]);
  const run=(command?:Command)=>{if(!command)return;onClose();setTimeout(command.run,0);};
  let index=-1;
  return <dialog ref={dialog} className="command-palette" aria-label="Command palette" onClose={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <div className="command-input"><Icon name="research" size={19}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Jump to a chat, project, subject or setting…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={flat[active]?'command-'+flat[active].id:undefined}
      onKeyDown={e=>{
        // Arrows wrap around; Home/End and Page keys jump; Tab moves like the arrows.
        const last=flat.length-1,move=(to:number)=>{e.preventDefault();if(last>=0)setActive(to);};
        if(e.key==='ArrowDown'||(e.key==='Tab'&&!e.shiftKey))move(active>=last?0:active+1);
        else if(e.key==='ArrowUp'||(e.key==='Tab'&&e.shiftKey))move(active<=0?last:active-1);
        else if(e.key==='PageDown')move(Math.min(last,active+8));
        else if(e.key==='PageUp')move(Math.max(0,active-8));
        else if((e.key==='Home'||e.key==='End')&&e.ctrlKey)move(e.key==='Home'?0:last);
        else if(e.key==='Enter'){e.preventDefault();run(flat[active]);}
      }}/><kbd>Esc</kbd></div>
    <div className="command-results" id="command-results" role="listbox" ref={list}>
      {flat.length?groups.map(([group,items])=><section key={group}><h3>{group}</h3>{items.map(c=>{index++;const i=index;return <button key={c.id} id={'command-'+c.id} role="option" aria-selected={i===active} data-index={i} className={i===active?'active':''} onMouseMove={()=>setActive(i)} onClick={()=>run(c)}><Icon name={c.icon} size={18}/><span><Marked text={c.label} query={query}/></span>{c.hint&&<small>{c.hint}</small>}</button>;})}</section>)
      :<p className="command-empty">Nothing matches “{query}”.</p>}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span></footer>
  </dialog>;
}
