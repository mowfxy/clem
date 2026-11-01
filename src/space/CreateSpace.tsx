import {useRef,useState,type DragEvent} from 'react';
import {Icon} from '../Icons';
import {sizeLabel} from '../store';

/** New project / new subject: a name, what it is about, and files to start it with (dropped in or picked). */
export function CreateSpaceForm({kind,preset,onCreate,onCancel}:{kind:'project'|'subject';preset?:{name?:string;description?:string}|null;onCreate:(name:string,description:string,files:File[])=>void;onCancel:()=>void}){
  const [files,setFiles]=useState<File[]>([]);
  const [over,setOver]=useState(false);
  const picker=useRef<HTMLInputElement>(null);
  const add=(list:FileList|null)=>{if(list?.length)setFiles(f=>[...f,...Array.from(list).filter(n=>!f.some(o=>o.name===n.name&&o.size===n.size))]);};
  const drop=(e:DragEvent)=>{e.preventDefault();setOver(false);add(e.dataTransfer.files);};
  const project=kind==='project';
  return <form className="space-create" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const name=String(data.get('name')).trim();if(name)onCreate(name,String(data.get('description')||'').trim(),files);}}>
    <label className="space-create-field">
      <span>Name</span>
      <input name="name" required maxLength={100} autoFocus defaultValue={preset?.name||''} placeholder={project?'A book, a business, a big idea…':'Physics, philosophy, organic chemistry…'}/>
    </label>
    <label className="space-create-field">
      <span>{project?'What do you want to work on?':'What are you learning, and why?'} <small>(optional)</small></span>
      <textarea name="description" rows={3} maxLength={400} defaultValue={preset?.description||''} placeholder={project?'Finalize the Q3 launch plan':'Pass the January exam with a good grade'}/>
    </label>
    <section className={`space-create-context${over?' over':''}`} onDragOver={e=>{e.preventDefault();setOver(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(false);}} onDrop={drop}>
      <div className="space-create-context-head"><span>Context <small>(optional)</small></span>
        <button type="button" aria-label="Add files" onClick={()=>picker.current?.click()}><Icon name="plus" size={16}/></button></div>
      {files.length?<ul>{files.map((f,i)=><li key={f.name+f.size}><Icon name="files" size={14}/><span>{f.name}</span><small>{sizeLabel(f.size)}</small>
        <button type="button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(all=>all.filter((_,j)=>j!==i))}><Icon name="close" size={13}/></button></li>)}</ul>
        :<button type="button" className="space-create-drop" onClick={()=>picker.current?.click()}>Drop in files, or click to add</button>}
      <input ref={picker} type="file" multiple hidden onChange={e=>{add(e.target.files);e.target.value='';}}/>
    </section>
    <div className="modal-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button className="primary">Create {kind}</button>
    </div>
  </form>;
}
