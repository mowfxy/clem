import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../Icons';
import type {Space} from '../../core/types';
import '../dialogs.css';

const MAX=8000;

export function InstructionsGlyph(){
  return <Icon name="note" size={18}/>;
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

/** A subject's or project's one-line description, edited from its menu. */
export function DescriptionDialog({space,onSave,onClose}:{space:Space;onSave:(description:string)=>void;onClose:()=>void}){
  const subject=space.kind==='subject';
  const ref=useRef<HTMLDialogElement>(null),field=useRef<HTMLTextAreaElement>(null);
  const [text,setText]=useState(space.description);
  const dirty=text.trim()!==space.description.trim();
  useEffect(()=>{ref.current?.showModal();const f=field.current;if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}},[]);
  const save=()=>{if(dirty)onSave(text.trim());onClose();};
  const casualClose=()=>{if(!dirty)onClose();};
  return createPortal(
    <dialog ref={ref} className="contact-dialog instructions-dialog description-dialog" aria-labelledby="description-title"
      onCancel={e=>{e.preventDefault();casualClose();}}
      onClick={e=>{if(e.target===e.currentTarget)casualClose();}}>
      <header>
        <span className="contact-option-mark" aria-hidden="true"><Icon name="cmd-notes" size={18}/></span>
        <div><h2 id="description-title">Description</h2>
          <p>{subject?`Shown under ${space.name}. Mowr reads it to know what you are studying.`:`Shown under ${space.name}. Mowr reads it to know what the project is.`}</p></div>
        <button type="button" className="contact-close" aria-label="Close" onClick={onClose}><Icon name="close" size={16}/></button>
      </header>
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div className="instructions-field">
          <textarea aria-label="Description" ref={field} rows={3} value={text} maxLength={400} onChange={e=>setText(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();save();}}}
            placeholder={subject?'What are you learning, and why?':'What is this project about?'}/>
        </div>
        <footer>
          <small>{text.length} / 400</small>
          <button type="button" className="contact-secondary" onClick={onClose}>Cancel</button>
          <button className="contact-primary" disabled={!dirty}>Save</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
