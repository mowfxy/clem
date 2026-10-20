import {createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
export async function confirmFileAccess(token:string,owner:string,session:string,enabled:boolean|null){
 const expires=Math.floor(Date.now()/1000)+43200;
 const secret=process.env.FILE_GATE_SECRET;
 if(!secret)throw Error('Account verification is temporarily unavailable.');
 const proof=createHmac('sha256',secret).update([owner.slice(9),session,enabled===null?'session':String(enabled),expires].join('|')).digest('hex');
 const client=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false},global:{headers:{Authorization:'Bearer '+token}}});
 const {error}=await client.rpc('clem_confirm_email_access',{p_enabled:enabled,p_expires:expires,p_proof:proof});
 if(error)throw Error('Unable to complete account verification. Request a new code and try again.');
}
