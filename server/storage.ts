import {createClient} from '@supabase/supabase-js';
function storage(token:string){if(!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)throw Error('File storage is unavailable.');return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}}).storage.from('clem-files');}
export async function uploadUrl(key:string,_size:number,_mime:string,token:string){const {data,error}=await storage(token).createSignedUploadUrl(key);if(error)throw error;return data.signedUrl;}
export async function downloadUrl(key:string,token:string){const {data,error}=await storage(token).createSignedUrl(key,120,{download:true});if(error)throw error;return data.signedUrl;}
export async function objectSize(key:string,token:string){const {data,error}=await storage(token).info(key);if(error)throw error;return Number(data.size);}
export async function removeObject(key:string,token:string){const {error}=await storage(token).remove([key]);if(error)throw error;}
