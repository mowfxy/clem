import { get, set, del } from 'idb-keyval';
import type { Chat, Space, StoredFile, Skill, VisualRecord, Automation } from '../core/types';
export const MAX_BYTES = 1_500_000_000;
export type State = { chats:Chat[];spaces:Space[];files:StoredFile[];skills:Skill[];visuals:VisualRecord[];automations:Automation[];avatar?:string;name:string;memory:string;quiet:boolean };
export const emptyState:State={chats:[],spaces:[],files:[],skills:[],visuals:[],automations:[],name:'Thinker',memory:'',quiet:false};
let namespace='guest';
export function setStorageNamespace(value:string){namespace=value;}
const stateKey=(ns=namespace)=>ns==='guest'?'mowr-state-v1':`mowr-state-${ns}`;
const blobKey=(id:string)=>namespace==='guest'?`file-${id}`:`file-${namespace}-${id}`;
export async function loadState():Promise<State>{const stored=await get<State>(stateKey());return stored?{...emptyState,...stored}:structuredClone(emptyState);}
export async function saveState(state:State,ns=namespace){await set(stateKey(ns),state);}
export async function storeBlob(id:string,file:Blob){await set(blobKey(id),file);}
export async function getBlob(id:string){const local=await get<Blob>(blobKey(id));if(local)return local;if(namespace==='guest')return undefined;const r=await fetch('/api/files/'+id);if(!r.ok)return undefined;const {url}=await r.json();const remote=await fetch(url);if(!remote.ok)throw new Error('File download failed. Check storage CORS configuration.');return remote.blob();}
export async function deleteBlob(id:string){await del(blobKey(id));}
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const sizeLabel=(bytes:number)=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${(bytes/1e3).toFixed(1)} KB`;
