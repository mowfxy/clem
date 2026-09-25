import {useEffect,useState} from 'react';
import {Icon} from './Icons';
import {sizeLabel,download,getBlob} from './store';
import type {StoredFile} from '../core/types';
import './file-card.css';

const tone=(ext:string)=>/PDF/.test(ext)?'pdf':/DOCX?|RTF|ODT/.test(ext)?'doc':/PPTX?|KEY/.test(ext)?'slides':/XLSX?|CSV|TSV/.test(ext)?'sheet':/PNG|JPE?G|GIF|WEBP|SVG|HEIC/.test(ext)?'image':/MD|TXT|TEX|JSON/.test(ext)?'text':'other';
/** "media_7a7_7a71a979-78fb-4d07-8800_phpSzWu0Y.png" → "media_7a7_7a71…SzWu0Y.png" */
const middle=(name:string,max=34)=>{if(name.length<=max)return name;const dot=name.lastIndexOf('.'),ext=dot>0&&name.length-dot<=6?name.slice(dot):'';const stem=name.slice(0,name.length-ext.length),keep=max-ext.length-1;return stem.slice(0,Math.ceil(keep*.6))+'…'+stem.slice(-Math.floor(keep*.4))+ext;};

/** A file in the conversation: a folded page with its type, or a thumbnail for pictures. */
export function FileCard({file,onOpen,onError}:{file:StoredFile;onOpen:()=>void;onError:(message:string)=>void}){
 const ext=(file.name.includes('.')?file.name.split('.').pop()!:'file').toUpperCase().slice(0,4),kind=tone(ext);
 const [thumb,setThumb]=useState('');
 useEffect(()=>{if(kind!=='image'||file.size>12_000_000)return;let url='',live=true;void getBlob(file.id).then(b=>{if(b&&live){url=URL.createObjectURL(b);setThumb(url);}}).catch(()=>{});return()=>{live=false;if(url)URL.revokeObjectURL(url);};},[file.id,kind]);
 const save=()=>void (async()=>{const blob=await getBlob(file.id);if(!blob)throw Error('File unavailable.');download(blob,file.name);})().catch(e=>onError(e.message));
 if(thumb)return <div className="file-slip file-photo"><button className="file-photo-open" onClick={onOpen} title={file.name}><img src={thumb} alt={file.name}/></button><span className="file-photo-bar"><span>{middle(file.name,28)}</span><button aria-label={'Download '+file.name} onClick={save}><Icon name="download" size={14}/></button></span></div>;
 return <div className={'file-slip tone-'+kind}>
  <button className="file-slip-open" onClick={onOpen} title={file.name}>
   <span className="file-page" aria-hidden="true"><span className="file-fold"/><b>{ext}</b></span>
   <span className="file-slip-text"><strong>{middle(file.name)}</strong><small>{file.made?'Made by Mowr · ':''}{sizeLabel(file.size)}</small></span>
  </button>
  <button className="file-slip-save" aria-label={'Download '+file.name} onClick={save}><Icon name="download" size={15}/></button>
 </div>;
}
