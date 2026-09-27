import express from 'express';
import {randomUUID} from 'node:crypto';
import {Sandbox} from '@vercel/sandbox';
import {identity} from './auth.ts';
import {db} from './db.ts';
import {encrypt} from './vault.ts';
import {subscriptionWorker} from './subscription-worker.ts';

export const subscriptionsRouter=express.Router();
type Provider='openai'|'xai';
export function subscriptionReady(){return Boolean(process.env.SUBSCRIPTION_RUNTIME_SNAPSHOT_ID&&process.env.VERCEL_OIDC_TOKEN);}
export async function cleanExpiredSubscriptionSessions(){
 const rows=await db()`DELETE FROM mowr_subscription_sessions WHERE expires_at<${Date.now()} RETURNING session_id,sandbox_id`;
 for(const row of rows)try{await(await Sandbox.get({name:row.sandbox_id||'mowr-'+row.session_id})).delete();}catch{/* A timed-out VM may already be gone. */}
}
// Reserve worst-case VM wall time up front: this bounds CPU and memory usage even when requests fail or an
// abandoned sign-in reaches its timeout. Each person also has their own share, so one account cannot use up
// everyone's allowance, and time a VM provably did not use (it was deleted early) is given back.
export const MONTHLY_RUNTIME_SECONDS=12000,USER_MONTHLY_RUNTIME_SECONDS=2400;
export type RuntimeReservation={month:string;owner:string;seconds:number;at:number};
// Per-person rows share the budget table, keyed "<month>:<owner>", so no schema change is needed.
async function take(key:string,seconds:number,cap:number){return (await db()`INSERT INTO mowr_runtime_budget(month,reserved_seconds) VALUES(${key},${seconds}) ON CONFLICT(month) DO UPDATE SET reserved_seconds=mowr_runtime_budget.reserved_seconds+excluded.reserved_seconds WHERE mowr_runtime_budget.reserved_seconds+excluded.reserved_seconds<=${cap} RETURNING month`).length>0;}
async function give(key:string,seconds:number){await db()`UPDATE mowr_runtime_budget SET reserved_seconds=CASE WHEN reserved_seconds>${seconds} THEN reserved_seconds-${seconds} ELSE 0 END WHERE month=${key}`;}
export async function reserveRuntime(owner:string,seconds:number):Promise<RuntimeReservation>{
 const at=Date.now(),month=new Date(at).toISOString().slice(0,7);
 if(!await take(month+':'+owner,seconds,USER_MONTHLY_RUNTIME_SECONDS))throw Error('Your free account connection allowance is used up for this month. No paid usage will be started.');
 if(!await take(month,seconds,MONTHLY_RUNTIME_SECONDS)){await give(month+':'+owner,seconds);throw Error('The free account connection allowance is used up for this month. No paid usage will be started.');}
 return {month,owner,seconds,at};
}
/** Gives back the part of a reservation the VM cannot have used. Call once, only after the VM is confirmed deleted. */
export async function refundRuntime(r:RuntimeReservation|undefined){
 if(!r)return;const unused=r.seconds-Math.ceil((Date.now()-r.at)/1000);if(unused<=0)return;
 await give(r.month,unused);await give(r.month+':'+r.owner,unused);
}
const SIGN_IN_SECONDS=600;
// A sign-in's reservation is made just before its expiry is set, so it can be rebuilt from the session row.
const signInReservation=(owner:string,expires:number):RuntimeReservation=>({month:new Date(expires-SIGN_IN_SECONDS*1000).toISOString().slice(0,7),owner,seconds:SIGN_IN_SECONDS,at:expires-SIGN_IN_SECONDS*1000});
export const removed=(sandbox:Sandbox|undefined)=>sandbox?sandbox.delete().then(()=>true,()=>false):Promise.resolve(true);
subscriptionsRouter.use(async(req,res,next)=>{
 const user=await identity(req);if(!user){res.status(401).json({error:'Sign in before connecting a subscription.'});return;}
 const users=await db()`SELECT disabled FROM mowr_users WHERE id=${user.id}`;
 if(!users.length||users[0].disabled){res.status(401).json({error:'This account is no longer active.'});return;}
 res.locals.owner=user.id;next();
});
subscriptionsRouter.get('/',async(_req,res)=>{
 const rows=await db()`SELECT provider,metadata FROM mowr_credentials WHERE owner_id=${res.locals.owner} AND provider IN ('openai','xai')`;
 res.json({available:subscriptionReady(),connections:rows.filter(r=>r.metadata?.kind==='subscription').map(r=>({provider:r.provider,connected:true}))});
});
subscriptionsRouter.param('provider',(req,res,next,value)=>{if(value!=='openai'&&value!=='xai'){res.status(400).json({error:'Unknown subscription provider.'});return;}next();});
subscriptionsRouter.post('/:provider',async(req,res)=>{
 if(!subscriptionReady()){res.status(503).json({error:'Subscription sign-in is not configured yet.'});return;}
 await cleanExpiredSubscriptionSessions();
 const owner=res.locals.owner as string,provider=req.params.provider as Provider,session=randomUUID(),expires=Date.now()+SIGN_IN_SECONDS*1000;
 const rows=await db()`INSERT INTO mowr_subscription_sessions(owner_id,provider,session_id,expires_at) VALUES(${owner},${provider},${session},${expires}) ON CONFLICT(owner_id,provider) DO UPDATE SET session_id=excluded.session_id,sandbox_id=NULL,expires_at=excluded.expires_at WHERE mowr_subscription_sessions.expires_at<${Date.now()} RETURNING session_id`;
 if(!rows.length){res.status(409).json({error:'A connection is already in progress. Finish or cancel it before starting again.'});return;}
 let sandbox:Sandbox|undefined,reservation:RuntimeReservation|undefined;
 try{
  reservation=await reserveRuntime(owner,SIGN_IN_SECONDS);
  sandbox=await Sandbox.create({name:'mowr-'+session,source:{type:'snapshot',snapshotId:process.env.SUBSCRIPTION_RUNTIME_SNAPSHOT_ID!},timeout:600000,resources:{vcpus:1},networkPolicy:{allow:provider==='openai'?['auth.openai.com','*.openai.com','chatgpt.com','*.chatgpt.com']:['accounts.x.ai','*.x.ai','grok.com','*.grok.com']}});
  await sandbox.writeFiles([{path:'/vercel/sandbox/subscription-worker.mjs',content:Buffer.from(subscriptionWorker)}]);
  await sandbox.runCommand({cmd:'node',args:['/vercel/sandbox/subscription-worker.mjs',provider],detached:true});
  const stored=await db()`UPDATE mowr_subscription_sessions SET sandbox_id=${'mowr-'+session} WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session} RETURNING session_id`;
  if(!stored.length)throw Error('This connection was cancelled.');
  res.json({sessionId:session,status:'starting',expiresAt:expires});
 }catch(e){const gone=await removed(sandbox);await db()`DELETE FROM mowr_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session}`;if(gone)await refundRuntime(reservation).catch(()=>{});throw e;}
});
// Deleting the session row claims it, so a finished sign-in is refunded once even if polls and cancel race.
async function finish(sandbox:Sandbox,owner:string,provider:string,session:string){
 const gone=await removed(sandbox);
 const rows=await db()`DELETE FROM mowr_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session} RETURNING expires_at`;
 if(gone&&rows.length)await refundRuntime(signInReservation(owner,Number(rows[0].expires_at))).catch(()=>{});
}
subscriptionsRouter.get('/:provider/:session',async(req,res)=>{
 const owner=res.locals.owner as string,provider=req.params.provider as Provider,session=String(req.params.session);
 const rows=await db()`SELECT sandbox_id,expires_at FROM mowr_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session}`;
 if(!rows.length||rows[0].expires_at<Date.now()){await cleanExpiredSubscriptionSessions();res.status(410).json({error:'This sign-in expired. Start again.'});return;}
 if(!rows[0].sandbox_id){res.json({status:'starting'});return;}
 const sandbox=await Sandbox.get({name:rows[0].sandbox_id});
 const bytes=await sandbox.readFileToBuffer({path:'/vercel/sandbox/mowr/status.json'});
 if(!bytes){res.json({status:'starting'});return;}
 const state=JSON.parse(bytes.toString());
 if(state.status==='complete'){
  try{
   const auth=await sandbox.readFileToBuffer({path:'/vercel/sandbox/mowr/'+(provider==='openai'?'.codex':'.grok')+'/auth.json'});
   if(!auth||auth.length>100000)throw Error('The provider did not save valid credentials.');
   const parsed=JSON.parse(auth.toString());if(provider==='openai'&&(!parsed.tokens||parsed.OPENAI_API_KEY))throw Error('Sign in with a ChatGPT subscription.');
   const value=encrypt(auth.toString(),owner);
   // Session predicate prevents a cancelled or replaced attempt restoring credentials.
   await db()`INSERT INTO mowr_credentials(owner_id,provider,ciphertext,nonce,key_version,metadata) SELECT ${owner},${provider},${value.ciphertext},${value.nonce},1,${JSON.stringify({kind:'subscription',model:provider==='openai'?'Codex':'Grok Build',context:32000})} WHERE EXISTS(SELECT 1 FROM mowr_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session}) ON CONFLICT(owner_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,metadata=excluded.metadata,updated_at=now()`;
  }finally{await finish(sandbox,owner,provider,session);}
 }else if(state.status==='failed')await finish(sandbox,owner,provider,session);
 res.json(state);
});
subscriptionsRouter.delete('/:provider',async(req,res)=>{
 const owner=res.locals.owner as string,provider=String(req.params.provider);
 const rows=await db()`DELETE FROM mowr_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} RETURNING sandbox_id,expires_at`;
 await db()`DELETE FROM mowr_credentials WHERE owner_id=${owner} AND provider=${provider}`;
 // More time left than a call's 210 s lock means this was a sign-in; a running call refunds its own reservation.
 for(const row of rows)if(row.sandbox_id)try{await(await Sandbox.get({name:row.sandbox_id})).delete();if(Number(row.expires_at)-Date.now()>210000)await refundRuntime(signInReservation(owner,Number(row.expires_at))).catch(()=>{});}catch{/* The VM also has a fixed timeout. */}
 res.json({ok:true});
});
