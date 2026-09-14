import {Icon} from './Icons';
import {sizeLabel,download,getBlob} from './store';
import type {StoredFile} from '../core/types';
export function FileCard({file,onOpen,onError}:{file:StoredFile;onOpen:()=>void;onError:(message:string)=>void}){
 const extension=file.name.split('.').pop()?.toUpperCase()||'FILE';
 const kind=/PPT/.test(extension)?'slides':/XLS|CSV/.test(extension)?'analysis':/JSON/.test(extension)?'skills':'files';
 return <div className={'document-card document-card-'+kind}><button className="document-card-open" onClick={onOpen}><span className="document-card-icon"><Icon name={kind} size={27}/></span><span><strong>{file.name}</strong><small>{extension} · {sizeLabel(file.size)}</small></span></button><button className="icon-button" aria-label={'Download '+file.name} onClick={()=>void (async()=>{const blob=await getBlob(file.id);if(!blob)throw Error('File unavailable.');download(blob,file.name);})().catch(e=>onError(e.message))}><Icon name="download" size={19}/></button></div>;
}
