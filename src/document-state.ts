import {get,update} from 'idb-keyval';
import {api} from './Cloud';
import type {StoredFile} from '../core/types';
export type Edits={office?:import('./office').OfficePatch[];text?:string;notes?:{page:number;text:string}[]};
export type DocumentState={revision:number;content:Edits|null};
export async function loadEdits(file:StoredFile):Promise<DocumentState>{return file.remote?api('files/'+file.id+'/edits'):(await get<DocumentState>('clem-document-'+file.id))||{revision:0,content:null};}
export async function saveEdits(file:StoredFile,revision:number,content:Edits):Promise<{revision:number}>{if(file.remote)return api('files/'+file.id+'/edits','PUT',{revision,content});await update<DocumentState>('clem-document-'+file.id,current=>{if((current?.revision||0)!==revision)throw Error('This file changed in another tab. Reopen it before saving.');return {revision:revision+1,content};});return {revision:revision+1};}
