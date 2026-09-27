import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {copyFile, mkdir, rm, writeFile} from 'node:fs/promises';
import {basename, extname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedPath} from './cli-install.ts';

// Grok through the person's own SuperGrok or X Premium+ plan, by running xAI's official, open-source Grok Build CLI
// (github.com/xai-org/grok-build, Apache-2.0) that Mowr installs with xAI's own installer. xAI documents headless mode
// as "ideal for scripts, automations, or integration into other apps" and ACP as its protocol for third-party
// integration. Mowr only starts the unmodified program on this PC: it never reads Grok's stored sign-in, never calls
// xAI's services itself, and nothing passes through Mowr's servers.

export const GROK_PREFIX = 'grok:';
export type GrokUsage = {percentUsed?:number;periodEnd?:string;plan?:string};
export type GrokStatus = {installed:boolean;connected:boolean;models:string[];defaultModel?:string;usage?:GrokUsage;error?:string};
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

export function grokModels(status:Pick<GrokStatus,'models'|'defaultModel'>):Model[] {
  const ordered=[...status.models].sort((a,b)=>Number(b===status.defaultModel)-Number(a===status.defaultModel));
  return ordered.map(id=>({id:GROK_PREFIX+id,name:grokModelName(id),provider:'xAI',connected:true,context:32000,specialties:[],tools:[],description:'Grok on your SuperGrok or X Premium+ plan, through Grok Build',reasoningEfforts:[],defaultReasoningEffort:''}));
}

/** `--output-format json` prints one (pretty-printed) object {text, stopReason, …}, or a line {type:"error", message}. */
export function parseGrokReply(raw:string):{text?:string;error?:string}{
  const candidates=[raw.trim(),...raw.trim().split(/\r?\n/).reverse()];
  for(const c of candidates){
    if(!c.startsWith('{'))continue;
    try{const o=JSON.parse(c);if(o?.type==='error')return {error:String(o.message||'error')};if(typeof o?.text==='string')return {text:o.text};}catch{}
  }
  return {};
}

/** The `_x.ai/billing` reply: {result:{config:{creditUsagePercent, billingPeriodEnd, currentPeriod}, subscription_tier}} */
export function parseBilling(result:any):GrokUsage|undefined{
  const body=result?.result??result;const config=body?.config;
  if(!config&&!body?.subscription_tier)return undefined;
  const pct=typeof config?.creditUsagePercent==='number'?Math.max(0,Math.min(100,config.creditUsagePercent)):undefined;
  const end=config?.billingPeriodEnd||config?.currentPeriod?.end;
  return {percentUsed:pct,periodEnd:typeof end==='string'?end:undefined,plan:typeof body?.subscription_tier==='string'?body.subscription_tier:undefined};
}

function friendly(detail:string){
  if(/not authenticated|authentication required|grok login|unauthori[sz]ed|401|sign in/i.test(detail))return 'Sign in to Grok again in Settings → Models.';
  if(/limit|quota|429|credits|exhausted|billing/i.test(detail))return 'Your Grok plan has no usage left right now. Try again later or pick another model.';
  if(/model/i.test(detail)&&/not (found|available|supported)|unknown/i.test(detail))return 'This Grok model is not available on your plan. Pick another one.';
  return 'Grok could not complete this request. Check Grok in Settings → Models.';
}

export class GrokProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  private statusCache:{at:number;value:GrokStatus}|null=null;
  private root:string;
  private configured:string|undefined;
  constructor(root:string,configured=process.env.MOWR_GROK_EXECUTABLE){this.root=root;this.configured=configured;}
  private executable(){return this.configured||installedPath('grok','grok');}
  private workspace(){return join(this.root,'workspace');}
  /** Only what Windows and Grok need; an XAI_API_KEY in the environment would bypass the person's own plan. */
  private env():NodeJS.ProcessEnv{
    const env:NodeJS.ProcessEnv={};
    for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','USERNAME','ProgramData','ProgramFiles','COMSPEC'])if(process.env[key])env[key]=process.env[key];
    env.NO_COLOR='1';
    return env;
  }
  // Test seam: tests swap this for a fake grok.
  async start(args:string[]){await mkdir(this.workspace(),{recursive:true});return spawn(this.executable(),args,{cwd:this.workspace(),env:this.env(),shell:false,windowsHide:true,stdio:'pipe'});}
  private async capture(args:string[],timeout:number,input?:string){
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(args);}catch{return null;}
    return new Promise<{code:number|null;out:string;err:string}|null>(resolve=>{
      let out='',err='',done=false;
      const finish=(v:{code:number|null;out:string;err:string}|null)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(v);};
      const timer=setTimeout(()=>finish({code:null,out,err:err+' timed out'}),timeout);
      child.stdout.on('data',(p:Buffer)=>{out+=p.toString();if(out.length>2_000_000)finish({code:null,out,err});});
      child.stderr.on('data',(p:Buffer)=>{err=(err+p.toString()).slice(-5000);});
      child.on('error',(e:NodeJS.ErrnoException)=>finish(e.code==='ENOENT'?null:{code:null,out,err:e.message}));
      child.on('close',code=>finish({code,out,err}));
      child.stdin.end(input);
    });
  }
  /** Asks Grok's own agent (over ACP, its protocol for integrations) how much of the plan is used this period. */
  async usage():Promise<GrokUsage|undefined>{
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(['agent','stdio']);}catch{return undefined;}
    return new Promise(resolve=>{
      let buffer='',done=false;
      const finish=(v?:GrokUsage)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(v);};
      const timer=setTimeout(()=>finish(),20000);
      const send=(msg:object)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\n');
      child.stdout.on('data',(p:Buffer)=>{
        buffer+=p.toString();let nl;
        while((nl=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;
          let msg:any;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.id===1)send({id:2,method:'_x.ai/billing',params:{}});
          else if(msg.id===2)finish(msg.error?undefined:parseBilling(msg.result));
          else if(msg.method&&msg.id!==undefined)send({id:msg.id,error:{code:-32601,message:'Not supported'}});
        }
      });
      child.stderr.resume();child.on('error',()=>finish());child.on('close',()=>finish());
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
      value={installed:true,connected,models:parsed.models,defaultModel:parsed.defaultModel,...(connected?{usage:await this.usage().catch(()=>undefined)}:{}),...(listed.code!==0&&!connected?{error:friendly(listed.err+listed.out)}:{})};
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
  async run(id:string,prompt:string,model:string,emit:(event:any)=>void,images:string[]=[]){
    const slug=model.slice(GROK_PREFIX.length);
    let status=await this.status();
    if(!status.connected||!status.models.includes(slug))status=await this.status(true);
    if(!status.installed)throw Error('Install Grok first (Settings → Models).');
    if(!status.connected)throw Error(status.error||'Sign in to Grok first (Settings → Models).');
    if(!status.models.includes(slug))throw Error('This Grok model is not available on your plan. Pick another one.');
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
      try{child=await this.start(['--prompt-file',file,'-m',slug,'--output-format','json','--permission-mode','dontAsk','--no-subagents','--no-auto-update','--cwd',this.workspace()]);}
      catch{throw Error('Grok could not start. Install it in Settings → Models.');}
      this.active.set(id,child);
      const result=await new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
        let out='',err='',done=false;
        const finish=(v?:{code:number|null;out:string;err:string},f?:Error)=>{if(done)return;done=true;clearTimeout(timer);f?reject(f):resolve(v!);};
        // An inactivity limit: any output from Grok restarts it, so a long answer that is still arriving is never cut off.
        let timer:ReturnType<typeof setTimeout>;
        const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>{child.kill();finish(undefined,Error('Grok took too long to respond.'));},330000);};
        touch();
        child.stdout.on('data',(p:Buffer)=>{if(!done)touch();out+=p.toString();if(out.length>2_000_000){child.kill();finish(undefined,Error('Grok response exceeded the safe limit.'));}});
        child.stderr.on('data',(p:Buffer)=>{if(!done)touch();err=(err+p.toString()).slice(-5000);});
        child.on('error',()=>finish(undefined,Error('Grok could not start. Install it in Settings → Models.')));
        child.on('close',code=>finish({code,out,err}));
        child.stdin.end();
      }).finally(()=>this.active.delete(id));
      const reply=parseGrokReply(result.out);
      if(reply.error||!reply.text)throw Error(friendly(reply.error||result.err||String(result.code)));
      this.statusCache=null; // usage changed
      emit({id,type:'delta',text:reply.text});emit({id,type:'done'});
    }finally{await rm(file,{force:true}).catch(()=>{});await rm(pictures,{recursive:true,force:true}).catch(()=>{});}
  }
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
