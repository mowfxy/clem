import {createClient,type SupabaseClient} from '@supabase/supabase-js';

// Public values only: the publishable key is designed to ship to browsers.
const fallback={url:'https://npdkvkikudvjrgnesuhc.supabase.co',key:'sb_publishable_iuAX6xFMvThhHYTWkT3fMw_CtkABHLu'};
export const accountService=(import.meta.env.VITE_ACCOUNT_SERVICE as string|undefined)||'https://mowr-accounts.mohamed-khaled011008.workers.dev';

let client:SupabaseClient|null=null;
export async function adminClient(){
  if(client)return client;
  let config=fallback;
  try{const r=await fetch('/api/supabase/config',{signal:AbortSignal.timeout(5000)});const data=await r.json();if(data.url&&data.key)config=data;}catch{/* Static preview: use the public fallback. */}
  // PKCE returns Google sign-ins as ?code=, leaving the hash free for portal routes.
  client=createClient(config.url,config.key,{auth:{storageKey:'mowr-admin-auth',persistSession:true,autoRefreshToken:true,flowType:'pkce',detectSessionInUrl:true}});
  return client;
}

export class AdminError extends Error{constructor(message:string,public status:number){super(message);}}

// Local preview with fixture data: http://localhost:5173/?demo#/admin. Never active in production builds.
export const demo=import.meta.env.DEV&&new URLSearchParams(location.search).has('demo');

export async function adminApi<T=any>(path:string,body?:unknown):Promise<T>{
  if(demo)return (await import('./demo')).demoApi(path,body) as T;
  const supabase=await adminClient();
  const {data}=await supabase.auth.getSession();
  if(!data.session)throw new AdminError('Your session ended. Sign in again.',401);
  const response=await fetch(accountService+path,{
    method:body===undefined?'GET':'POST',
    headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  }).catch(()=>{throw new AdminError('The account service could not be reached. Check your connection.',0);});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new AdminError(result.error||`Request failed (${response.status}).`,response.status);
  return result as T;
}

export type Plan='owner'|'complimentary'|'subscribed'|'cancelling'|'past_due'|'lapsed'|'free';
export type Person={id:string;email?:string|null;username?:string|null;display_name?:string|null;first_seen_at?:string|null;last_seen_at?:string|null;setup_step?:number|null;suspended:boolean;suspended_until?:string|null;cases:number;plan:Plan;until?:string|null};
export type CaseRow={id:string;owner_id:string;category:string;subject:string;created_at:string;status:'open'|'pending'|'resolved'|'closed';priority:'low'|'normal'|'high'|'urgent';assignee_id?:string|null;updated_at:string;email?:string|null;username?:string|null;replies:number;awaiting_staff:boolean};
export type Staff={id:string;email:string;role:'owner'|'admin'|'support';mfa:boolean;lemon:boolean;directory:boolean;requireMfa:boolean};

/** Preset emails are sent by the website's own server (it holds the mail account), not the account service. */
export async function mailApi<T=any>(path:string,body?:unknown):Promise<T>{
  if(demo)return (await import('./demo')).demoMail(path,body) as T;
  const supabase=await adminClient();
  const {data}=await supabase.auth.getSession();
  if(!data.session)throw new AdminError('Your session ended. Sign in again.',401);
  // No cookies: the server treats a cookieless bearer call as the portal, never as a signed-in page.
  const response=await fetch('/api/email/staff'+path,{
    method:body===undefined?'GET':'POST',credentials:'omit',
    headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000),
  }).catch(()=>{throw new AdminError('The Mowr website could not be reached. Check your connection.',0);});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new AdminError(result.error||`Request failed (${response.status}).`,response.status);
  return result as T;
}
export type MailPreset={id:string;label:string;about:string};
