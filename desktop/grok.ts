import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {copyFile, mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {basename, extname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedPath} from './cli-install.ts';
import {SessionLost,UsageLimit,unsupportedFlag} from './kinetra-turn.ts';
import type {UsageSnapshot} from '../core/account-usage.ts';

// Grok through the person's own SuperGrok or X Premium+ plan, by running xAI's official, open-source Grok Build CLI
// (github.com/xai-org/grok-build, Apache-2.0) that Mowr installs with xAI's own installer. xAI documents headless mode
// as "ideal for scripts, automations, or integration into other apps" and ACP as its protocol for third-party
// integration. Mowr only starts the unmodified program on this PC: it never reads Grok's stored sign-in, never calls
// xAI's services itself, and nothing passes through Mowr's servers.

export const GROK_PREFIX = 'grok:';
export type GrokUsage = {percentUsed?:number;periodEnd?:string;plan?:string;period?:string};
export type GrokStatus = {installed:boolean;connected:boolean;models:string[];defaultModel?:string;usage?:GrokUsage;efforts?:GrokEfforts;error?:string};
type Model = {id:string;name:string;provider:string;connected:boolean;context:number;specialties:string[];tools:string[];description:string;reasoningEfforts:{reasoningEffort:string;description:string}[];defaultReasoningEffort:string};

/** `grok models` prints "You are logged in with grok.com." then "Default model: X" and "  * id (default)" / "  - id" lines. */
export function parseModels(raw:string){
  const loggedIn=/You are logged in with /i.test(raw);
  const models=[...raw.matchAll(/^\s*[*-]\s+([A-Za-z0-9._:-]{1,80})(?:\s+\(default\))?\s*$/gm)].map(m=>m[1]);
  const defaultModel=raw.match(/^Default model:\s*(\S+)/m)?.[1];
  return {loggedIn,models:[...new Set(models)],defaultModel};
}

/** grok-4.6 → Grok 4.6, grok-build-0.1 → Grok Build 0.1, grok-4.3-mini-fast → Grok 4.3 Mini Fast */
export function grokModelName(id:string){
  return id.split(/[-_]/).map(p=>/^\d/.test(p)?p:p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
}

const effortNames:Record<string,string>={minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'};
export function grokModels(status:Pick<GrokStatus,'models'|'defaultModel'|'efforts'>):Model[] {
  const ordered=[...status.models].sort((a,b)=>Number(b===status.defaultModel)-Number(a===status.defaultModel));
  return ordered.map(id=>{
    const effort=status.efforts?.[id];
    const levels=effort?.levels||[];
    return {id:GROK_PREFIX+id,name:grokModelName(id),provider:'xAI',connected:true,context:32000,specialties:[],tools:[],description:'Grok on your SuperGrok or X Premium+ plan, through Grok Build',
      reasoningEfforts:levels.map(reasoningEffort=>({reasoningEffort,description:effortNames[reasoningEffort]||reasoningEffort})),
      defaultReasoningEffort:effort?.default&&levels.includes(effort.default)?effort.default:levels.includes('high')?'high':levels[0]||''};
  });
}

/**
 * Grok's headless output. Mowr asks for `streaming-messages-json` (one Anthropic-style message per line, then a
 * `result`), whose result is the final message only. Plain `--output-format json` joins the text of every step the
 * agent took into one string with nothing between them, which glued its interim notes ("I'll read the file.") onto
 * the reply and hid a tool request behind them. The older single object {text, stopReason} is still understood.
 */
export function parseGrokReply(raw:string):{text?:string;error?:string}{
  const lines=raw.trim().split(/\r?\n/);
  let last:string|undefined,error:string|undefined;
  for(const line of lines){
    const c=line.trim();if(!c.startsWith('{'))continue;
    let o:any;try{o=JSON.parse(c);}catch{continue;}
    if(o?.type==='error')error=String(o.message||o.error||'error');
    else if(o?.type==='result'){
      if(o.is_error||o.subtype&&o.subtype!=='success')error=String(o.result||o.error||o.subtype||'error');
      else if(typeof o.result==='string')return {text:o.result};
    }
    else if(o?.type==='assistant'&&Array.isArray(o.message?.content)){
      const text=o.message.content.filter((p:any)=>p?.type==='text'&&typeof p.text==='string').map((p:any)=>p.text).join('');
      if(text.trim())last=text;
    }
  }
  if(error)return {error};
  if(last!==undefined)return {text:last};
  for(const c of [raw.trim(),...lines.reverse()]){
    if(!c.trim().startsWith('{'))continue;
    try{const o=JSON.parse(c);if(typeof o?.text==='string')return {text:o.text};}catch{}
  }
  return {};
}
/** A few words on what Grok is doing, from one streamed message (null when it says nothing new). */
export function grokStatus(event:any):string|null{
  if(event?.type==='assistant'){
    const parts:any[]=event.message?.content||[];
    const tool=parts.find(p=>p?.type==='tool_use');
    if(tool)return /web_?search|search_web/i.test(tool.name||'')?'Searching the web…':'Using a tool…';
    if(parts.some(p=>p?.type==='text'&&String(p.text||'').trim()))return 'Writing the answer…';
    if(parts.some(p=>p?.type==='thinking'))return 'Thinking it through…';
  }
  if(event?.type==='user'&&(event.message?.content||[]).some((p:any)=>p?.type==='tool_result'))return 'Reading what it found…';
  return null;
}
/** Grok's reasoning levels, lowest first, as its agent lists them for each model. */
const EFFORT_ORDER=['minimal','low','medium','high','xhigh','max'];
export type GrokEfforts=Record<string,{levels:string[];default?:string}>;
export function parseGrokEfforts(initialize:any):GrokEfforts{
  const out:GrokEfforts={};
  for(const m of initialize?.modelState?.availableModels||initialize?._meta?.modelState?.availableModels||[]){
    const id=String(m?.modelId||'');const meta=m?._meta||{};
    if(!id||meta.supportsReasoningEffort===false||!Array.isArray(meta.reasoningEfforts))continue;
    const levels=meta.reasoningEfforts.map((e:any)=>String(e?.value||e?.id||'')).filter((v:string)=>/^[a-z]{2,12}$/.test(v));
    levels.sort((a:string,b:string)=>EFFORT_ORDER.indexOf(a)-EFFORT_ORDER.indexOf(b));
    if(levels.length)out[id]={levels,default:meta.reasoningEfforts.find((e:any)=>e?.default)?.value||meta.reasoningEffort};
  }
  return out;
}

/** The `_x.ai/billing` reply: {result:{config:{creditUsagePercent, billingPeriodEnd, currentPeriod}, subscription_tier}} */
export function parseBilling(result:any):GrokUsage|undefined{
  const body=result?.result??result;const config=body?.config;
  if(!config&&!body?.subscription_tier)return undefined;
  const pct=typeof config?.creditUsagePercent==='number'?Math.max(0,Math.min(100,config.creditUsagePercent)):undefined;
  const end=config?.billingPeriodEnd||config?.currentPeriod?.end;
  const period=config?.currentPeriod?.type;
  return {percentUsed:pct,periodEnd:typeof end==='string'?end:undefined,plan:typeof body?.subscription_tier==='string'?body.subscription_tier:undefined,...(typeof period==='string'?{period}:{})};
}
/** Grok's plan usage in the same shape as ChatGPT's (one window: the plan's weekly or monthly period). */
export function grokUsage(usage?:GrokUsage):UsageSnapshot|undefined{
  if(!usage||typeof usage.percentUsed!=='number')return undefined;
  const end=usage.periodEnd?Date.parse(usage.periodEnd):NaN;
  const minutes=/DAILY/i.test(usage.period||'')?1440:/MONTH/i.test(usage.period||'')?43200:10080;
  return {rateLimits:{primary:{usedPercent:usage.percentUsed,windowDurationMins:minutes,resetsAt:Number.isFinite(end)?Math.round(end/1000):null}}};
}

const outOfUsage=(detail:string)=>/limit|quota|429|credits|exhausted|billing/i.test(detail);
function friendly(detail:string){
  if(/not authenticated|authentication required|grok login|unauthori[sz]ed|401|sign in/i.test(detail))return 'Sign in to Grok again in Settings → Models.';
  if(outOfUsage(detail))return 'Your Grok plan has no usage left right now. Try again later or pick another model.';
  if(/model/i.test(detail)&&/not (found|available|supported)|unknown/i.test(detail))return 'This Grok model is not available on your plan. Pick another one.';
  return 'Grok could not complete this request. Check Grok in Settings → Models.';
}

export class GrokProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  /** Set when this CLI refused --session-id/--resume: tool loops then run without a session. */
  private noSessions=false;
  private statusCache:{at:number;value:GrokStatus}|null=null;
  private root:string;
  private configured:string|undefined;
  /** GROK_HOME for this account: each added Grok account keeps its own sign-in there. Unset for the first one (~/.grok). */
  private home:string|undefined;
  constructor(root:string,configured=process.env.MOWR_GROK_EXECUTABLE,home?:string){this.root=root;this.configured=configured;this.home=home;}
  private executable(){return this.configured||installedPath('grok','grok');}
  private workspace(){return join(this.root,'workspace');}
  /** Only what Windows and Grok need; an XAI_API_KEY in the environment would bypass the person's own plan. */
  private env():NodeJS.ProcessEnv{
    const env:NodeJS.ProcessEnv={};
    for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','USERNAME','ProgramData','ProgramFiles','COMSPEC'])if(process.env[key])env[key]=process.env[key];
    env.NO_COLOR='1';
    if(this.home)env.GROK_HOME=this.home;
    return env;
  }
  // Test seam: tests swap this for a fake grok.
  async start(args:string[]){await mkdir(this.workspace(),{recursive:true});if(this.home)await mkdir(this.home,{recursive:true});return spawn(this.executable(),args,{cwd:this.workspace(),env:this.env(),shell:false,windowsHide:true,stdio:'pipe'});}
  private async capture(args:string[],timeout:number,input?:string){
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(args);}catch{return null;}
    return new Promise<{code:number|null;out:string;err:string}|null>(resolve=>{
      let out='',err='',done=false;
      const finish=(v:{code:number|null;out:string;err:string}|null)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(v);};
      const timer=setTimeout(()=>finish({code:null,out,err:err+' timed out'}),timeout);
      // Decoded as a stream, so a character split between two chunks is not garbled.
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',(p:string)=>{out+=p;if(out.length>2_000_000)finish({code:null,out,err});});
      child.stderr.on('data',(p:string)=>{err=(err+p).slice(-5000);});
      child.on('error',(e:NodeJS.ErrnoException)=>finish(e.code==='ENOENT'?null:{code:null,out,err:e.message}));
      child.on('close',code=>finish({code,out,err}));
      child.stdin.end(input);
    });
  }
  /** Asks Grok's own agent (over ACP, its protocol for integrations) how much of the plan is used this period. */
  async usage():Promise<GrokUsage|undefined>{return (await this.handshake())?.usage;}
  /** One ACP handshake: the plan's usage (`_x.ai/billing`) and each model's reasoning levels (from `initialize`). */
  private async handshake():Promise<{usage?:GrokUsage;efforts:GrokEfforts}|undefined>{
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(['agent','stdio']);}catch{return undefined;}
    return new Promise(resolve=>{
      let buffer='',done=false,efforts:GrokEfforts={};
      const finish=(usage?:GrokUsage,ended=false)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(ended&&!usage&&!Object.keys(efforts).length?undefined:{usage,efforts});};
      const timer=setTimeout(()=>finish(undefined,true),20000);
      const send=(msg:object)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\n');
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(p:string)=>{
        buffer+=p;let nl;
        while((nl=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;
          let msg:any;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.id===1){efforts=parseGrokEfforts(msg.result);send({id:2,method:'_x.ai/billing',params:{}});}
          else if(msg.id===2)finish(msg.error?undefined:parseBilling(msg.result));
          else if(msg.method&&msg.id!==undefined)send({id:msg.id,error:{code:-32601,message:'Not supported'}});
        }
      });
      child.stderr.resume();child.on('error',()=>finish(undefined,true));child.on('close',()=>finish(undefined,true));
      send({id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},_meta:{clientType:'mowr',clientVersion:'1'}}});
    });
  }
  async status(force=false):Promise<GrokStatus>{
    if(!force&&this.statusCache&&Date.now()-this.statusCache.at<30000)return this.statusCache.value;
    const listed=await this.capture(['models'],30000);
    let value:GrokStatus;
    if(!listed)value={installed:false,connected:false,models:[]};
    else{
      const parsed=parseModels(listed.out);
      const connected=parsed.loggedIn&&parsed.models.length>0;
      const shake=connected?await this.handshake().catch(()=>undefined):undefined;
      value={installed:true,connected,models:parsed.models,defaultModel:parsed.defaultModel,...(shake?.usage?{usage:shake.usage}:{}),...(shake?.efforts&&Object.keys(shake.efforts).length?{efforts:shake.efforts}:{}),...(listed.code!==0&&!connected?{error:friendly(listed.err+listed.out)}:{})};
    }
    this.statusCache={at:Date.now(),value};return value;
  }
  forget(){this.statusCache=null;}
  /** `grok login --oauth` opens xAI's sign-in page in the browser and finishes by itself; no window is shown. */
  async login(openUrl:(url:string)=>void){
    const child=await this.start(['login','--oauth']);
    let seen='',opened=false;
    const look=(p:Buffer)=>{seen=(seen+p.toString()).slice(-8000);const url=seen.match(/https:\/\/[^\s"'<>]*(?:x\.ai|grok\.com)[^\s"'<>]*/)?.[0];if(url&&!opened){opened=true;setTimeout(()=>openUrl(url),2500);}};
    child.stdout.on('data',look);child.stderr.on('data',look);
    // grok opens the browser itself; the fallback above only fires if that failed and it printed the link instead.
    child.on('close',()=>{opened=true;this.statusCache=null;});
    child.on('error',()=>{});
    setTimeout(()=>child.kill(),15*60_000);
    this.statusCache=null;
    return {started:true};
  }
  /** Pictures are copied into Grok's own workspace and named in the prompt, so Grok opens them with its file tool. */
  async run(id:string,prompt:string,model:string,emit:(event:any)=>void,images:string[]=[],session?:{id:string;resume:boolean},effort?:string){
    // A Grok CLI that refused the session flags once runs every later step without them (the tool loop resends everything).
    if(this.noSessions)session=undefined;
    const slug=model.slice(GROK_PREFIX.length);
    let status=await this.status();
    if(!status.connected||!status.models.includes(slug))status=await this.status(true);
    if(!status.installed)throw Error('Install Grok first (Settings → Models).');
    if(!status.connected)throw Error(status.error||'Sign in to Grok first (Settings → Models).');
    if(!status.models.includes(slug))throw Error('This Grok model is not available on your plan. Pick another one.');
    // A level this model does not list is left to Grok's default rather than failing the request.
    if(effort&&!/^[a-z]{2,12}$/.test(effort))effort=undefined;
    if(effort&&status.efforts&&!status.efforts[slug]?.levels.includes(effort))effort=undefined;
    // The prompt goes in a file so long conversations don't hit Windows' command-line length limit.
    const file=join(this.workspace(),'.prompt-'+randomUUID()+'.txt');
    const pictures=join(this.workspace(),'.images-'+randomUUID());
    await mkdir(this.workspace(),{recursive:true});
    const named:string[]=[];
    if(images.length){
      await mkdir(pictures,{recursive:true});
      for(const [index,path] of images.entries()){const name=basename(pictures)+'/'+(index+1)+extname(path);await copyFile(path,join(this.workspace(),name));named.push(name);}
    }
    await writeFile(file,named.length?prompt+'\n\nThe user attached '+(named.length===1?'a picture':named.length+' pictures')+' to this message, saved in the working folder as: '+named.join(', ')+'. Open and look at '+(named.length===1?'it':'them')+' before answering.':prompt);
    try{
      let child:ChildProcessWithoutNullStreams;
      try{child=await this.start(['--prompt-file',file,'-m',slug,'--output-format','streaming-messages-json','--permission-mode','dontAsk','--no-subagents','--no-auto-update','--cwd',this.workspace(),...(effort?['--reasoning-effort',effort]:[]),...(session?[session.resume?'--resume':'--session-id',session.id]:[])]);}
      catch{throw Error('Grok could not start. Install it in Settings → Models.');}
      this.active.set(id,child);
      const result=await new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
        let out='',err='',done=false;
        const finish=(v?:{code:number|null;out:string;err:string},f?:Error)=>{if(done)return;done=true;clearTimeout(timer);f?reject(f):resolve(v!);};
        // An inactivity limit: any output from Grok restarts it, so a long answer that is still arriving is never cut off.
        let timer:ReturnType<typeof setTimeout>;
        const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>{child.kill();finish(undefined,Error('Grok took too long to respond.'));},330000);};
        touch();
        // Decoded as a stream: a character split between two chunks (é, —, Arabic) must not turn into �.
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        // Each streamed message also says what Grok is doing (thinking, searching, writing) while it works.
        let pending='',last='';
        const read=(line:string)=>{if(!line.trim())return;let event:any;try{event=JSON.parse(line);}catch{return;}const status=grokStatus(event);if(status&&status!==last){last=status;emit({id,type:'status',text:status});}};
        child.stdout.on('data',(p:string)=>{if(!done)touch();out+=p;if(out.length>8_000_000){child.kill();finish(undefined,Error('Grok response exceeded the safe limit.'));return;}
          pending+=p;let nl;while((nl=pending.indexOf('\n'))>=0){read(pending.slice(0,nl));pending=pending.slice(nl+1);}});
        child.stderr.on('data',(p:string)=>{if(!done)touch();err=(err+p).slice(-5000);});
        child.on('error',()=>finish(undefined,Error('Grok could not start. Install it in Settings → Models.')));
        child.on('close',code=>finish({code,out,err}));
        child.stdin.end();
      }).finally(()=>this.active.delete(id));
      const reply=parseGrokReply(result.out);
      if(session&&(reply.error||!reply.text)&&unsupportedFlag.test((reply.error||'')+result.err)){this.noSessions=true;throw new SessionLost('This Grok CLI does not keep sessions.');}
      if(session?.resume&&(reply.error||!reply.text)&&/session/i.test((reply.error||'')+result.err)&&/not found|no such|unknown|does not exist|invalid/i.test((reply.error||'')+result.err))throw new SessionLost('Grok no longer has this session.');
      if((reply.error||!reply.text)&&outOfUsage(reply.error||result.err))throw new UsageLimit(friendly(reply.error||result.err));
      if(reply.error||!reply.text)throw Error(friendly(reply.error||result.err||String(result.code)));
      this.statusCache=null; // usage changed
      emit({id,type:'delta',text:reply.text});emit({id,type:'done'});
    }finally{await rm(file,{force:true}).catch(()=>{});await rm(pictures,{recursive:true,force:true}).catch(()=>{});}
  }
  /** Grok keeps headless sessions under ~/.grok/sessions; the ones a finished tool loop made are removed (best effort: its layout is not documented). */
  async endSession(sessionId:string){
    if(!/^[0-9a-f-]{36}$/i.test(sessionId)||!this.home&&!process.env.USERPROFILE)return;
    const base=join(this.home||join(process.env.USERPROFILE!,'.grok'),'sessions');
    const sweep=async(folder:string,depth:number):Promise<void>=>{
      for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){
        const path=join(folder,entry.name);
        if(entry.name.includes(sessionId))await rm(path,{recursive:true,force:true}).catch(()=>{});
        else if(entry.isDirectory()&&depth>0)await sweep(path,depth-1);
      }
    };
    await sweep(base,2);
  }
  /** Whether a request is running on this account (an account is never switched or removed mid-answer). */
  get busy(){return this.active.size>0;}
  /** Signs this Grok out with its own command, which clears its cached sign-in. */
  async logout(){this.statusCache=null;await this.capture(['logout'],20000);}
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
