import {Sandbox} from '@vercel/sandbox';
import {randomUUID} from 'node:crypto';
import {db} from './db.ts';
import {encrypt} from './vault.ts';
import {reserveRuntime,refundRuntime,removed,subscriptionReady,cleanExpiredSubscriptionSessions,type RuntimeReservation} from './subscriptions.ts';
import type {ChatInput} from './providers.ts';

export async function* generateSubscription(provider:string,messages:ChatInput[],signal:AbortSignal,credential:{key:string;owner:string}){
 if(!subscriptionReady())throw Error('Subscription execution is not configured.');
 if(provider!=='openai'&&provider!=='xai')throw Error('Unknown subscription provider.');
 await cleanExpiredSubscriptionSessions();
 const started=Date.now();
 const owner=credential.owner,session=randomUUID(),name='clem-'+session;
 const lock=await db()`INSERT INTO clem_subscription_sessions(owner_id,provider,session_id,expires_at) VALUES(${owner},${provider},${session},${Date.now()+210000}) ON CONFLICT(owner_id,provider) DO UPDATE SET session_id=excluded.session_id,sandbox_id=NULL,expires_at=excluded.expires_at WHERE clem_subscription_sessions.expires_at<${Date.now()} RETURNING session_id`;
 if(!lock.length)throw Error('This subscription is already working on another request. Wait for it to finish.');
 let sandbox:Sandbox|undefined,reservation:RuntimeReservation|undefined;
 try{
  signal.throwIfAborted();reservation=await reserveRuntime(owner,180);
  sandbox=await Sandbox.create({name,source:{type:'snapshot',snapshotId:process.env.SUBSCRIPTION_RUNTIME_SNAPSHOT_ID!},timeout:180000,resources:{vcpus:1},networkPolicy:{allow:provider==='openai'?['*.openai.com','chatgpt.com','*.chatgpt.com']:['*.x.ai','grok.com','*.grok.com']}});
  const stored=await db()`UPDATE clem_subscription_sessions SET sandbox_id=${name} WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session} RETURNING session_id`;
  if(!stored.length)throw Error('The subscription request was cancelled.');
  const root='/vercel/sandbox/clem',home=root+(provider==='openai'?'/.codex':'/.grok');
  await sandbox.runCommand({cmd:'mkdir',args:['-p',home]});
  await sandbox.writeFiles([{path:home+'/auth.json',content:Buffer.from(credential.key)},{path:root+'/prompt.txt',content:Buffer.from(JSON.stringify(messages))}]);
  // The shell script is constant. User text is passed only through a data file.
  const codex='exec /vercel/sandbox/runtime/node_modules/.bin/codex exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only -c features.shell_tool=false -c features.unified_exec=false -c web_search=\'"disabled"\' - < /vercel/sandbox/clem/prompt.txt';
  const args=provider==='openai'?['-c',codex]:['--prompt-file',root+'/prompt.txt','--output-format','streaming-messages-json','--include-partial-messages','--permission-mode','dontAsk','--tools','','--no-plan','--no-subagents','--disable-web-search','--max-turns','1'];
  const command=await sandbox.runCommand({cmd:provider==='openai'?'sh':'/vercel/sandbox/runtime/node_modules/.bin/grok',args,cwd:root,env:{HOME:root,CODEX_HOME:root+'/.codex',NO_COLOR:'1'},detached:true});
  let buffer='',output=false,complete=false;
  for await(const log of command.logs({signal})){
   signal.throwIfAborted();if(log.stream!=='stdout')continue;buffer+=log.data;if(buffer.length>1000000)throw Error('The subscription returned an oversized event.');
   let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;let event;try{event=JSON.parse(line);}catch{continue;}
    if(provider==='openai'){
     if(event.type==='error'||event.type==='turn.failed')throw Error('Codex could not complete this request. Check your subscription access and reconnect if needed.');
     if(event.type==='item.completed'&&event.item?.type==='agent_message'){output=true;yield String(event.item.text);}
     if(event.type==='turn.completed')complete=true;
    }else{
     const e=event.type==='stream_event'?event.event:event;
     if(e?.type==='content_block_delta'&&e.delta?.type==='text_delta'){output=true;yield String(e.delta.text);}
     if(event.type==='result'){if(event.is_error)throw Error('Grok could not complete this request. Check your subscription access.');if(!output&&typeof event.result==='string'){output=true;yield event.result;}complete=true;}
     if(e?.type==='message_stop')complete=true;
    }
   }
  }
  const finished=await command.wait();if(finished.exitCode!==0||!complete||!output)throw Error('The subscription response did not complete. Reconnect your account if the problem continues.');
 }finally{
  if(sandbox){
   try{if(!signal.aborted&&Date.now()-started<170000){const auth=await sandbox.readFileToBuffer({path:'/vercel/sandbox/clem/'+(provider==='openai'?'.codex':'.grok')+'/auth.json'});if(auth&&auth.length<100000){JSON.parse(auth.toString());const value=encrypt(auth.toString(),owner);await db()`UPDATE clem_credentials SET ciphertext=${value.ciphertext},nonce=${value.nonce},updated_at=now() WHERE owner_id=${owner} AND provider=${provider} AND EXISTS(SELECT 1 FROM clem_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session})`;}}}catch{/* Reconnecting restores credentials if refresh could not be persisted. */}
  }
  // Time is given back only once the VM is confirmed gone (it otherwise runs to its 180 s timeout).
  if(await removed(sandbox))await refundRuntime(reservation).catch(()=>{});
  await db()`DELETE FROM clem_subscription_sessions WHERE owner_id=${owner} AND provider=${provider} AND session_id=${session}`;
 }
}
