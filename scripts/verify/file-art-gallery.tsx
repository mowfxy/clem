// Mounts every file kind's card into the page, for file-art.mjs to screenshot.
import {createRoot} from 'react-dom/client';
import {DocumentCard,FileCard} from '../../src/FileCard';
import type {StoredFile} from '../../core/types';

const names=['Study guide with Worksheet 1 Solutions.pdf','Lab report.docx','Pitch deck.pptx','Grades.xlsx','Diagram.png','Sources.zip','data.json','notes.md'];
export function mount(){
  const host=document.createElement('div');host.className='messages';host.style.cssText='position:fixed;inset:0;z-index:9999;background:#171717;padding:30px;overflow:auto;width:auto;margin:0';
  document.body.append(host);
  const files=names.map((name,i)=>({id:'g'+i,name,type:name.endsWith('.png')?'text/plain':'',size:2_500_000+i*1000,created:Date.now()} as unknown as StoredFile));
  createRoot(host).render(<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 24px',maxWidth:1100}}>
    <div className="message assistant">{files.map(f=><DocumentCard key={f.id} file={f} onOpen={()=>{}} onError={()=>{}}/>)}</div>
    <div className="message user">{files.map(f=><div key={f.id}><FileCard file={f} onOpen={()=>{}} onError={()=>{}}/></div>)}</div>
  </div>);
}
