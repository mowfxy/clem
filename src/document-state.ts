import {get,set} from 'idb-keyval';
import {api} from './Cloud';
import type {StoredFile} from '../core/types';
export type Edits={office?:import('./office').OfficePatch[];text?:string;notes?:{page:number;text:string}[]};
export type DocumentState={revision:number;content:Edits|null};
export async function loadEdits(file:StoredFile):Promise<DocumentState>{return file.remote?api('files/'+file.id+'/edits'):(await get<DocumentState>('mowr-document-'+file.id))||{revision:0,content:null};}
export async function saveEdits(file:StoredFile,revision:number,content:Edits):Promise<{revision:number}>{if(file.remote)return api('files/'+file.id+'/edits','PUT',{revision,content});const current=await loadEdits(file);if(current.revision!==revision)throw Error('This file changed in another tab. Reopen it before saving.');await set('mowr-document-'+file.id,{revision:revision+1,content});return {revision:revision+1};}
