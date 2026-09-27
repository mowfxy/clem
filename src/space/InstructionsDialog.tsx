import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../Icons';
import type {Space} from '../../core/types';
import '../dialogs.css';

const MAX=8000;

export function InstructionsGlyph(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4"/><path d="M9 11.5h6M9 14.5h6M9 17.5h3.5"/></svg>;
}

/** The notes Mowr follows in one project or subject, edited in a popup. */
export function InstructionsDialog({space,onSave,onClose}:{space:Space;onSave:(memory:string)=>void;onClose:()=>void}){
  const subject=space.kind==='subject';
  const ref=useRef<HTMLDialogElement>(null),field=useRef<HTMLTextAreaElement>(null);
  const [text,setText]=useState(space.memory);
  const dirty=text.trim()!==space.memory.trim();
  useEffect(()=>{ref.current?.showModal();const f=field.current;if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}},[]);
  const save=()=>{if(dirty)onSave(text.trim());onClose();};
  // Unsaved edits are not lost to a stray click outside the popup or Escape.
  const casualClose=()=>{if(!dirty)onClose();};
  return createPortal(
    <dialog ref={ref} className="contact-dialog instructions-dialog" aria-labelledby="instructions-title"
      onCancel={e=>{e.preventDefault();casualClose();}}
      onClick={e=>{if(e.target===e.currentTarget)casualClose();}}>
      <header>
        <span className="contact-option-mark" aria-hidden="true"><InstructionsGlyph/></span>
        <div><h2 id="instructions-title">{subject?'How Mowr teaches you':'Project instructions'}</h2>
          <p>{subject?`Mowr follows these whenever you study ${space.name}.`:`Mowr follows these in every chat in ${space.name}.`}</p></div>
        <button type="button" className="contact-close" aria-label="Close" onClick={onClose}><Icon name="close" size={16}/></button>
      </header>
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div className="instructions-field">
          <textarea aria-label="Instructions" ref={field} rows={9} value={text} maxLength={MAX} onChange={e=>setText(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();save();}}}
            placeholder={subject?'My level, the course and exam board, how I like things explained…':'Goals, background, tone, and how Mowr should work here…'}/>
          {text.length>MAX*.8&&<small className="instructions-count">{text.length.toLocaleString()} / {MAX.toLocaleString()}</small>}
        </div>
        <footer>
          <small>Only this {space.kind} uses these. Files marked Source are quoted when you ask here.</small>
          <button type="button" className="contact-secondary" onClick={onClose}>Cancel</button>
          <button className="contact-primary" disabled={!dirty}>Save</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
