import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

// Gemini through the person's own Google AI Pro/Ultra plan, by running Google's official Antigravity CLI (`agy`)
// that they installed and signed in to themselves. Mowr only starts that unmodified program on this PC, the way
// a terminal would: it never reads, copies or stores Google credentials (they stay in Windows Credential Manager,
// owned by agy), never talks to Google's services itself, and nothing passes through Mowr's servers.
// Google has not confirmed this use is allowed (its Antigravity terms bar "third party software" accessing the
// service), so nothing runs until the person accepts that risk in Settings → Models (see `consented` in main.ts).

export const ANTIGRAVITY_PREFIX = 'antigravity:';
export const antigravityInstallUrl = 'https://antigravity.google/docs/getting-started?tab=cli';
export type AntigravityStatus = {installed:boolean;connected:boolean;models:string[];error?:string};
type Model = {id:string;name:string;provider:string;connected:boolean;context:number;specialties:string[];tools:string[];description:string;reasoningEfforts:{reasoningEffort:string;description:string}[];defaultReasoningEffort:string};

/** `agy models` prints one slug per line (e.g. gemini-3.8-flash-high). Only Gemini models are offered in Mowr. */
export function parseModelList(raw:string) {
  return [...new Set(raw.split(/\r?\n/).map(line=>line.trim().split(/\s+/)[0]||'').filter(slug=>/^gemini-[a-z0-9.-]{1,60}$/i.test(slug)))];
}

/** gemini-3.8-flash-high → Gemini 3.8 Flash (high) */
export function modelName(slug:string) {
  const parts=slug.split('-'),effort=/^(low|medium|high|minimal)$/i.test(parts.at(-1)||'')?parts.pop():undefined;
  const name=parts.map(p=>/^\d/.test(p)?p:p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
  return effort?`${name} (${effort.toLowerCase()})`:name;
}

export function antigravityModels(slugs:string[]):Model[] {
  return slugs.map(slug=>({id:ANTIGRAVITY_PREFIX+slug,name:modelName(slug),provider:'Google',connected:true,context:32000,specialties:[],tools:[],description:'Gemini on your Google AI plan, through Antigravity CLI',reasoningEfforts:[],defaultReasoningEffort:''}));
}

/** The final JSON envelope agy prints: {status, response, error, …}. Also accepts stream-json result events. */
export function parseReply(raw:string):{text?:string;error?:string} {
  const objects:any[]=[];
  for(const line of raw.split(/\r?\n/)){const t=line.trim();if(!t.startsWith('{'))continue;try{objects.push(JSON.parse(t));}catch{}}
  if(!objects.length){try{objects.push(JSON.parse(raw));}catch{}}
  for(const item of objects.reverse()){
    const result=item?.event==='result'||item?.type==='result'?(item.result??item):item;
    const status=typeof result?.status==='string'?result.status.toUpperCase():undefined;
    if(status&&status!=='SUCCESS')return {error:typeof result.error==='string'?result.error:typeof result.error?.message==='string'?result.error.message:status};
    if(typeof result?.response==='string')return {text:result.response};
  }
  return {};
}

function friendly(detail:string) {
  if(/auth|sign.?in|log.?in|credential|unauthenti/i.test(detail))return 'Sign in to Antigravity CLI again in Settings → Models.';
  if(/quota|limit|429|exhausted|credits/i.test(detail))return 'Your Google AI plan has no Antigravity usage left right now. Try again later or pick another model.';
  if(/unknown model|model.*not (found|available)/i.test(detail))return 'This Gemini model is not available on your plan. Pick another one.';
  if(/suspend|terminat|disabled|violation/i.test(detail))return 'Google has restricted Antigravity access on this account. Stop using it in Mowr and check your Google account.';
  return 'Gemini could not complete this request. Check Antigravity CLI in Settings → Models.';
}

/** Runs `agy` with no project, no files and no permission to act: tools that need approval are refused in headless
 *  mode by default (Mowr never passes --dangerously-skip-permissions), and the working folder is an empty one Mowr owns. */
export class AntigravityProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  private statusCache:{at:number;value:AntigravityStatus}|null=null;
  private root:string;
  private configured:string|undefined;
  constructor(root:string,configured=process.env.MOWR_AGY_EXECUTABLE){this.root=root;this.configured=configured;}
  /** The installer puts agy in %LOCALAPPDATA%\agy\bin, which Mowr's PATH may not include until it restarts. */
  private executable(){
    if(this.configured)return this.configured;
    const local=process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'agy','bin','agy.exe');
    return local&&existsSync(local)?local:'agy';
  }
  private env():NodeJS.ProcessEnv {
    const env:NodeJS.ProcessEnv={};
    for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH','USERNAME','ProgramData','ProgramFiles','COMSPEC'])if(process.env[key])env[key]=process.env[key];
    env.NO_COLOR='1';
    return env;
  }
  private async start(args:string[]){const cwd=join(this.root,'workspace');await mkdir(cwd,{recursive:true});return spawn(this.executable(),args,{cwd,env:this.env(),shell:false,windowsHide:true,stdio:'pipe'});}
  /** Runs a short agy command and returns its output; `null` when agy could not be started at all. */
  private async capture(args:string[],timeout:number){
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(args);}catch{return null;}
    return new Promise<{code:number|null;out:string;err:string}|null>(resolve=>{
      let out='',err='',done=false;
      const finish=(value:{code:number|null;out:string;err:string}|null)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(value);};
      const timer=setTimeout(()=>finish({code:null,out,err:err+' timed out'}),timeout);
      child.stdout.on('data',(p:Buffer)=>{out+=p.toString();if(out.length>64000)finish({code:null,out,err});});
      child.stderr.on('data',(p:Buffer)=>{err=(err+p.toString()).slice(-4000);});
      child.on('error',(e:NodeJS.ErrnoException)=>finish(e.code==='ENOENT'?null:{code:null,out,err:e.message}));
      child.on('close',code=>finish({code,out,err}));
      child.stdin.end();
    });
  }
  async status(force=false):Promise<AntigravityStatus>{
    if(!force&&this.statusCache&&Date.now()-this.statusCache.at<30000)return this.statusCache.value;
    const version=await this.capture(['--version'],15000);
    let value:AntigravityStatus;
    if(!version)value={installed:false,connected:false,models:[]};
    else{
      // Listing models needs a signed-in account, so it doubles as the sign-in check.
      const list=await this.capture(['models'],20000);
      const models=list&&list.code===0?parseModelList(list.out):[];
      value={installed:true,connected:models.length>0,models,...(list&&list.code!==0?{error:friendly(list.err+list.out)}:{})};
    }
    this.statusCache={at:Date.now(),value};return value;
  }
  /** Opens agy in a visible window; it signs in through the person's browser and stores the result in their keyring. */
  async login(){
    const exe=this.executable().replace(/'/g,"''");
    const command=`Write-Host 'Sign in to Google in the browser window that opens. When agy is ready, type /exit or close this window and return to Mowr.'; & '${exe}'`;
    await mkdir(join(this.root,'workspace'),{recursive:true});
    const child=spawn('powershell.exe',['-NoProfile','-NoExit','-Command',command],{cwd:join(this.root,'workspace'),env:this.env(),detached:true,stdio:'ignore',windowsHide:false});
    child.unref();this.statusCache=null;
    return {started:true};
  }
  private async attempt(id:string,args:string[],stdin:string){
    const child=await this.start(args);this.active.set(id,child);
    try{
      return await new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
        let out='',err='',done=false;
        const finish=(value?:{code:number|null;out:string;err:string},failure?:Error)=>{if(done)return;done=true;clearTimeout(timer);failure?reject(failure):resolve(value!);};
        const timer=setTimeout(()=>{child.kill();finish(undefined,Error('Gemini took too long to respond.'));},330000);
        child.stdout.on('data',(p:Buffer)=>{out+=p.toString();if(out.length>2_000_000){child.kill();finish(undefined,Error('Gemini response exceeded the safe limit.'));}});
        child.stderr.on('data',(p:Buffer)=>{err=(err+p.toString()).slice(-5000);});
        child.on('error',()=>finish(undefined,Error('Antigravity CLI could not start. Install it in Settings → Models.')));
        child.on('close',code=>finish({code,out,err}));
        child.stdin.end(stdin);
      });
    }finally{this.active.delete(id);}
  }
  async run(id:string,prompt:string,model:string,emit:(event:any)=>void){
    const slug=model.slice(ANTIGRAVITY_PREFIX.length);
    let status=await this.status();
    if(!status.connected||!status.models.includes(slug))status=await this.status(true);
    if(!status.installed)throw Error('Install Antigravity CLI first (Settings → Models).');
    if(!status.connected)throw Error(status.error||'Sign in to Antigravity CLI first (Settings → Models).');
    if(!status.models.includes(slug))throw Error('This Gemini model is not available on your plan. Pick another one.');
    const base=['--model',slug,'--output-format','json','--print-timeout','5m'];
    // The prompt goes in on stdin so long conversations don't hit Windows' command-line length limit.
    let result=await this.attempt(id,[...base,'--input-format','stream-json'],JSON.stringify({event:'user',message:{content:prompt}})+'\n');
    let reply=parseReply(result.out);
    // Older agy builds without stream-json input: pass the prompt as the -p argument when it fits.
    if(!reply.text&&!reply.error&&prompt.length<24000){result=await this.attempt(id,['-p',prompt,...base],'');reply=parseReply(result.out);}
    if(reply.error||!reply.text)throw Error(friendly(reply.error||result.err||String(result.code)));
    emit({id,type:'delta',text:reply.text});emit({id,type:'done'});
  }
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
