import { builtinSkills } from '../core/skills.ts';
import type { Model } from '../core/types.ts';
export type ChatInput={role:'user'|'assistant'|'system';content:string};
type Config={id:string;provider:Model['provider'];prefix:string;url:string};
const configs:Config[]=[
 {id:'openai',provider:'OpenAI',prefix:'OPENAI',url:'https://api.openai.com/v1/chat/completions'},
 {id:'anthropic',provider:'Anthropic',prefix:'ANTHROPIC',url:'https://api.anthropic.com/v1/messages'},
 {id:'google',provider:'Google',prefix:'GEMINI',url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'},
 {id:'xai',provider:'xAI',prefix:'XAI',url:'https://api.x.ai/v1/chat/completions'},
];
export function modelCatalog():Model[]{return configs.map(c=>({id:c.id,name:process.env[`${c.prefix}_MODEL`]||c.provider,provider:c.provider,connected:Boolean(process.env[`${c.prefix}_API_KEY`]&&process.env[`${c.prefix}_MODEL`]),context:Number(process.env[`${c.prefix}_CONTEXT`]||32000),specialties:(process.env[`${c.prefix}_SPECIALTIES`]||'').split(',').filter(Boolean),tools:[]}));}
export function requestSpec(id:string,messages:ChatInput[],credential?:{key:string;model:string}){
 const c=configs.find(c=>c.id===id);if(!c)throw new Error('Unknown provider.');
 const key=credential?.key||process.env[`${c.prefix}_API_KEY`],model=credential?.model||process.env[`${c.prefix}_MODEL`];if(!key||!model)throw new Error('Add the provider API key and model identifier to .env.local, or connect your own model in Settings.');
 const anthropic=c.id==='anthropic';const headers:Record<string,string>={'Content-Type':'application/json'};
 if(anthropic){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}else headers.Authorization=`Bearer ${key}`;
 const body=anthropic?{model,stream:true,max_tokens:4096,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:messages.filter(m=>m.role!=='system')}:{model,messages,stream:true,...(c.id==='openai'?{max_completion_tokens:4096}:{max_tokens:4096})};
 return {url:c.url,headers,body};
}
export async function* parseProviderStream(body:ReadableStream<Uint8Array>,signal:AbortSignal):AsyncGenerator<string>{
 const reader=body.getReader(),decoder=new TextDecoder();let buffer='';let doneMarker=false;
 try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length>1_000_000)throw new Error('Provider event exceeded the safe size limit.');
  let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){doneMarker=true;continue;}if(!raw)continue;const event=JSON.parse(raw);if(event.error||event.type==='error')throw new Error('The provider interrupted its response. Try again.');if(event.type==='message_stop')doneMarker=true;const delta=event.choices?.[0]?.delta?.content??event.delta?.text;if(typeof delta==='string')yield delta;}
  if(done)break;
 }if(!doneMarker)throw new Error('The provider stream ended before completion.');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function* generate(id:string,messages:ChatInput[],signal:AbortSignal,credential?:{key:string;model:string}){const pack = builtinSkills.map(s => s.name + ':\n' + s.steps.map((step,i) => (i+1)+'. '+step).join('\n')).join('\n\n');
const policy = 'Mowr has the following built-in workflows available in every conversation. Infer the relevant workflow or combination from the request; never require the user to select or enable a skill. Follow the relevant steps, asking only for essential missing inputs. Adapt depth to the task. Never claim to have rendered, searched, validated, exported or scheduled something unless an actual tool result is present. You have text generation here; deterministic diagrams and document exports are supplied by the application. If a required tool is unavailable, state the missing evidence or tool and provide a useful bounded draft. For Long Task planning, incorporate relevant skill steps in the requested plan schema. For a single assigned subtask, perform only its requested step.\n\n'+pack;
const spec=requestSpec(id,[{role:'system',content:policy},...messages],credential);const timeout=AbortSignal.timeout(180000);const combined=AbortSignal.any([signal,timeout]);const response=await fetch(spec.url,{method:'POST',headers:spec.headers,body:JSON.stringify(spec.body),signal:combined});if(!response.ok){await response.body?.cancel();throw new Error(`Provider returned HTTP ${response.status}. Check the model, key, billing, and provider limits.`);}if(!response.body)throw new Error('Provider returned an empty response.');yield*parseProviderStream(response.body,combined);}
