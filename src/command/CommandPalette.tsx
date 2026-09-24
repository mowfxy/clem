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
  let i=0;for(const c of text){if(c===q[i])i++;if(i===q.length)return 10;}
  return 0;
}

export function CommandPalette({commands,onClose}:{commands:Command[];onClose:()=>void}){
  const [query,setQuery]=useState('');
  const [active,setActive]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),list=useRef<HTMLDivElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const results=useMemo(()=>commands.map(c=>({c,s:score(c,query)})).filter(r=>r.s>0).sort((a,b)=>b.s-a.s).slice(0,40).map(r=>r.c),[commands,query]);
  const groups=useMemo(()=>{const map=new Map<string,Command[]>();for(const c of (query?results:commands.slice(0,40)))map.set(query?'Results':c.group,[...(map.get(query?'Results':c.group)||[]),c]);return [...map];},[results,commands,query]);
  const flat=groups.flatMap(([,items])=>items);
  useEffect(()=>setActive(0),[query]);
  useEffect(()=>{list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active]);
  const run=(command?:Command)=>{if(!command)return;onClose();setTimeout(command.run,0);};
  let index=-1;
  return <dialog ref={dialog} className="command-palette" aria-label="Command palette" onClose={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <div className="command-input"><Icon name="research" size={19}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Jump to a chat, project, subject or setting…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={flat[active]?'command-'+flat[active].id:undefined}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(flat.length-1,a+1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(0,a-1));}else if(e.key==='Enter'){e.preventDefault();run(flat[active]);}}}/><kbd>Esc</kbd></div>
    <div className="command-results" id="command-results" role="listbox" ref={list}>
      {flat.length?groups.map(([group,items])=><section key={group}><h3>{group}</h3>{items.map(c=>{index++;const i=index;return <button key={c.id} id={'command-'+c.id} role="option" aria-selected={i===active} data-index={i} className={i===active?'active':''} onMouseMove={()=>setActive(i)} onClick={()=>run(c)}><Icon name={c.icon} size={18}/><span>{c.label}</span>{c.hint&&<small>{c.hint}</small>}</button>;})}</section>)
      :<p className="command-empty">Nothing matches “{query}”.</p>}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span></footer>
  </dialog>;
}
