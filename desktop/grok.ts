import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {describeTool,StepCounter} from './tool-status.ts';
import {copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {basename, extname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedPath} from './cli-install.ts';
import {SessionLost,UsageLimit,unsupportedFlag} from './kinetra-turn.ts';
import {liveText,NOTE_HOLD} from './live-reply.ts';
import {followGrokLog} from './grok-log.ts';
import {kinetraMcp,keepingAlive,GROK_MCP_CONFIG,GROK_NATIVE_NOTE,GROK_TOOL,grokMcpEnv,type NativeCall} from './kinetra-mcp.ts';
/** One Kinetra request for Grok's native tool: its result, and pictures (files on this PC) that go with it. */
export type GrokNative=(request:Record<string,unknown>)=>Promise<{result:unknown;pictures:{path:string;mime?:string}[]}>;
import type {UsageSnapshot} from '../core/account-usage.ts';

// Grok through the person's own SuperGrok or X Premium+ plan, by running xAI's official, open-source Grok Build CLI
// (github.com/xai-org/grok-build, Apache-2.0) that Clem installs with xAI's own installer. xAI documents headless mode
// as "ideal for scripts, automations, or integration into other apps" and ACP as its protocol for third-party
// integration. Clem only starts the unmodified program on this PC: it never reads Grok's stored sign-in, never calls
// xAI's services itself, and nothing passes through Clem's servers.

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
 * Grok's headless output. Clem asks for `streaming-messages-json` (one Anthropic-style message per line, then a
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
  // With partial messages a block says what it is when it opens, long before its whole message arrives.
  const block=event?.type==='stream_event'&&!event.parent_tool_use_id&&event.event?.type==='content_block_start'?event.event.content_block:null;
  if(block?.type==='thinking')return 'Thinking it through…';
  // A tool request's input arrives whole when its block ends (one input_json_delta), which for a long document can take
  // minutes: the person is told the next step is being written from the moment the block opens.
  if(block?.type==='tool_use')return describeTool(block.name,block.input)||'Writing the next step…';
  // The answer itself shows as it is written: no status line under it.
  if(block?.type==='text')return '';
  if(event?.type==='assistant'){
    const parts:any[]=event.message?.content||[];
    const tool=parts.find(p=>p?.type==='tool_use');
    if(tool)return describeTool(tool.name,tool.input)||'Using a tool…';
    if(parts.some(p=>p?.type==='text'&&String(p.text||'').trim()))return '';
    if(parts.some(p=>p?.type==='thinking'))return 'Thinking it through…';
  }
  if(event?.type==='user'&&(event.message?.content||[]).some((p:any)=>p?.type==='tool_result'))return 'Reading what it found…';
  return null;
}
/**
 * Native Kinetra needs the working folder trusted (--trust), since Grok loads a folder's MCP servers only then. Trust
 * also loads a folder's hooks, instruction files and other MCP sources, and Grok may write in its folder, so before each
 * answer Clem removes any it finds and writes its own .grok/config.toml, and the answer may not write them (grokNativeArgs).
 */
const GUARDED_FOLDERS=['.grok','.claude','.cursor','.agents'],GUARDED_FILES=['.mcp.json','.envrc','AGENTS.md','AGENT.md','GROK.md','CLAUDE.md'];
export async function grokNativeFolder(cwd:string){
  await Promise.all([...GUARDED_FOLDERS.filter(name=>name!=='.grok'),...GUARDED_FILES].map(name=>rm(join(cwd,name),{recursive:true,force:true}).catch(()=>{})));
  // Everything in .grok but its config goes (hooks, skills, rules); the config is replaced whole. Two answers in one folder
  // write the same file, so neither can leave the other without its server.
  await mkdir(join(cwd,'.grok'),{recursive:true});
  for(const entry of await readdir(join(cwd,'.grok')).catch(()=>[]))if(entry!=='config.toml')await rm(join(cwd,'.grok',entry),{recursive:true,force:true}).catch(()=>{});
  const temp=join(cwd,'.grok','config.toml.'+randomUUID());
  await writeFile(temp,GROK_MCP_CONFIG);
  await rename(temp,join(cwd,'.grok','config.toml')).catch(async()=>{await rm(temp,{force:true}).catch(()=>{});await writeFile(join(cwd,'.grok','config.toml'),GROK_MCP_CONFIG);});
}
/**
 * Grok passes an MCP tool's pictures to the model as base64 text, which it cannot see: a Kinetra result's pictures
 * (pages it asked to look at) are copied into its folder instead and named in the result, to open with read_file, as the
 * text protocol does.
 */
export function picturesAsFiles(native:GrokNative,cwd:string,id:string):NativeCall{
  let n=0;
  return async(request)=>{
    const {result,pictures}=await native(request);
    if(!pictures.length)return {result,pictures:[]};
    const folder='.kinetra-'+id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
    await mkdir(join(cwd,folder),{recursive:true});
    const names=await Promise.all(pictures.map(async picture=>{const name=`${folder}/${++n}${extname(picture.path)||'.png'}`;await copyFile(picture.path,join(cwd,name));return name;}));
    const look=`Open ${names.length===1?'this picture':'these '+names.length+' pictures'} with read_file now to see ${names.length===1?'it':'them'}${names.length>1?' (all in one step, one read_file call each)':''}: ${names.join(', ')}`;
    const base:Record<string,unknown>=result&&typeof result==='object'&&!Array.isArray(result)?{...(result as Record<string,unknown>)}:{result};
    if(typeof base.note==='string')base.note=base.note.replace('These pictures are attached: look at them now.','').trim()||undefined;
    return {result:{...base,pictures:names,look},pictures:[]};
  };
}
/**
 * The line of a Grok error that says what it refused ("error: unexpected argument '--x' found"). Grok's usage line
 * after it repeats every flag Clem passed, so matching the whole error blamed --include-partial-messages and --tools for
 * any one refused flag: replies then arrived in one piece, and with Grok's full tool list, for every later answer.
 */
export const grokRefusal=(err:string)=>err.split(/\r?\n/).find(line=>unsupportedFlag.test(line))||'';
export const grokNativeArgs=()=>['--trust','--allow',`MCPTool(${GROK_TOOL})`,...GUARDED_FOLDERS.flatMap(name=>['--deny',`Edit(./${name}/**)`]),...GUARDED_FILES.flatMap(name=>['--deny',`Edit(./${name})`])];
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

/** Windows passes at most 32,767 characters of command line, and Grok's --rules takes only literal text (no file). */
export const GROK_RULES_MAX=24_000;
/**
 * Clem's system prompt as Grok's --rules (added to Grok's own system prompt; replacing that prompt made Grok fetch pages
 * instead of searching). A prompt too long for the command line returns undefined and goes at the top of the message.
 */
export function grokRules(system?:string,inFolder=false){
  const rules=system?system+'\n\n'+(inFolder?GROK_FOLDER_NOTE:GROK_NOTE):undefined;
  return rules&&rules.length<=GROK_RULES_MAX?rules:undefined;
}
/**
 * Grok Build is a coding agent: in Clem its own tools only open the pictures a message names and reach the web. Without
 * this, Grok read its bundled pdf skill (SKILL.md, 11k characters) before each document, and each picture cost a step of
 * its own; every extra step re-reads the whole conversation.
 */
export const GROK_NOTE='IN CLEM: your own tools are only for opening the pictures and PDFs a message names (read_file) and for the web. Files, documents, figures and calculations go only through Clem\'s {"kinetra":…} requests: never read Grok\'s own skills (SKILL.md) or other files on this PC. When a message names several pictures or PDF page ranges, open all of them in the same step (one read_file call each, sent together).';
/** Where one turn's PDFs sit in Grok's working folder for read_file: kept for the whole turn, so a later step can open more pages. */
export const grokPdfPath=(turn:string,index:number,name:string)=>`.pdfs-${turn}/${index+1}-${name.replace(/\.pdf$/i,'').replace(/[^\p{L}\p{N}._ -]+/gu,'_').slice(0,80)}.pdf`;
/**
 * Grok's built-in tools Clem keeps: read_file opens the pictures named in a prompt, web_search is xAI's own search
 * (it runs on xAI's side, but only when listed here). The other 24 (shell, editing, subagents, schedulers, video…)
 * cost about 10k input tokens on every step. web_fetch is left out: in dontAsk mode a call to it cancelled the run.
 */
export const GROK_TOOLS='read_file,web_search';
/**
 * In a working folder of the person's files (desktop/ai-workspace.ts) Grok works as itself: it lists, searches, reads
 * and writes files there with its own tools. Still left out: the terminal and code, subagents, schedulers, media and
 * the rest. Every name must be one Grok knows: a single unknown name makes Grok ignore the list and load all of its
 * tools, the terminal included (checked against the tool_definitions.json of the sessions it records).
 */
export const GROK_FOLDER_TOOLS='read_file,list_dir,grep,search_replace,write,web_search,todo_write';
export const GROK_FOLDER_NOTE='IN CLEM: your working folder holds the person\'s files; list, search, read and write them with your own file tools, as in any project. Run no commands. Never read Grok\'s own skills (SKILL.md) or files outside the working folder. When you need several files or page ranges, open them in the same step (one call each, sent together).';

const outOfUsage=(detail:string)=>/limit|quota|429|credits|exhausted|billing/i.test(detail);
const signedOut=/not authenticated|authentication required|grok login|unauthori[sz]ed|401|sign in/i;
/** Without stdout or log activity for this long Grok is taken as stuck; a request in flight may run up to the second. */
export const GROK_IDLE_LIMIT=10*60_000,GROK_REQUEST_LIMIT=60*60_000;
/** Silence after which the person is told Grok is still working. */
export const GROK_QUIET_NOTE=2*60_000;
const GROK_OFFLINE='Grok lost its connection to xAI and could not get it back. Check your internet connection, then send your message again.';
function friendly(detail:string){
  if(detail.includes(GROK_OFFLINE))return GROK_OFFLINE;
  if(signedOut.test(detail))return 'Sign in to Grok again in Settings → Models.';
  if(outOfUsage(detail))return 'Your Grok plan has no usage left right now. Try again later or pick another model.';
  if(/model/i.test(detail)&&/not (found|available|supported)|unknown/i.test(detail))return 'This Grok model is not available on your plan. Pick another one.';
  return 'Grok could not complete this request. Check Grok in Settings → Models.';
}

export class GrokProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  /** Sessions whose Grok is still exiting after its answer (saving the session and its usage.json), by session id. */
  private exiting=new Map<string,Promise<void>>();
  /** Set when this CLI refused --session-id/--resume: tool loops then run without a session. */
  private noSessions=false;
  /** Set when this CLI refused --include-partial-messages: replies then arrive in one piece. */
  private noPartial=false;
  /** Restarts a running answer's inactivity limit, by request id. */
  private alive=new Map<string,()=>void>();
  /** Set when this CLI refused --trust or an MCPTool rule (an older build): Kinetra then goes through the text protocol. */
  private noNative=false;
  /** Set when this CLI refused --tools or --no-plan (an older build): it then runs with its default tools. */
  private noToolList=false;
  private statusCache:{at:number;value:GrokStatus}|null=null;
  /** Set after each answer: the plan's usage changed, so the next status the window asks for is read again. */
  private usageStale=false;
  /** The last check while it is recent: each step of a tool loop reuses it instead of starting `grok models` and Grok's agent again. */
  private recentStatus(){return this.statusCache&&Date.now()-this.statusCache.at<10*60_000?this.statusCache.value:undefined;}
  /**
   * The last check an answer may start on without waiting for a new one: a recent one as it is, an older one (up to a
   * day) too, checked again once the answer is done (beside it, the check slowed the answer's own start). A sign-in
   * that lapsed meanwhile fails the answer itself, which clears the check, so the person is still told to sign in again.
   */
  private knownStatus(){
    if(!this.statusCache||Date.now()-this.statusCache.at>=24*60*60_000)return undefined;
    return this.statusCache.value;
  }
  /** After an answer that started on an older check: checks again for the next one. */
  private recheck(){if(this.statusCache&&!this.recentStatus())void this.status(true).catch(()=>{});}
  /**
   * Gets this account ready for a message. `ahead` (the window coming back into view, well before a message): an older
   * check is renewed while the person types. Otherwise the message is being sent now, and only an account with no usable
   * check is checked, so the answer can share that check instead of starting its own.
   */
  prepare(ahead=false){if(ahead?!this.recentStatus():!this.knownStatus())void this.status().catch(()=>{});}
  private root:string;
  private configured:string|undefined;
  /** GROK_HOME for this account: each added Grok account keeps its own sign-in there. Unset for the first one (~/.grok). */
  private home:string|undefined;
  constructor(root:string,configured=process.env.CLEM_GROK_EXECUTABLE,home?:string){this.root=root;this.configured=configured;this.home=home;}
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
  async start(args:string[],cwd=this.workspace(),extraEnv:Record<string,string>={}){await mkdir(cwd,{recursive:true});if(this.home)await mkdir(this.home,{recursive:true});return spawn(this.executable(),args,{cwd,env:{...this.env(),...extraEnv},shell:false,windowsHide:true,stdio:'pipe'});}
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
      send({id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},_meta:{clientType:'clem',clientVersion:'1'}}});
    });
  }
  private statusRequest:Promise<GrokStatus>|null=null;
  /** One check at a time: callers that arrive while one runs share it. */
  async status(force=false):Promise<GrokStatus>{
    if(!force&&!this.usageStale&&this.statusCache&&Date.now()-this.statusCache.at<30000)return this.statusCache.value;
    this.statusRequest??=this.readStatus().finally(()=>{this.statusRequest=null;});
    return this.statusRequest;
  }
  private async readStatus():Promise<GrokStatus>{
    this.usageStale=false;
    // The model list and the agent's handshake (usage, reasoning levels) are read side by side: each is a program start.
    const handshake=this.handshake().catch(()=>undefined);
    const listed=await this.capture(['models'],30000);
    let value:GrokStatus;
    if(!listed)value={installed:false,connected:false,models:[]};
    else{
      const parsed=parseModels(listed.out);
      const connected=parsed.loggedIn&&parsed.models.length>0;
      // Waited for only when signed in; signed out, its answer is not needed.
      const shake=connected?await handshake:undefined;
      value={installed:true,connected,models:parsed.models,defaultModel:parsed.defaultModel,...(shake?.usage?{usage:shake.usage}:{}),...(shake?.efforts&&Object.keys(shake.efforts).length?{efforts:shake.efforts}:{}),...(listed.code!==0&&!connected?{error:friendly(listed.err+listed.out)}:{})};
    }
    this.statusCache={at:Date.now(),value};return value;
  }
  forget(){this.statusCache=null;}
  /** `grok login --oauth` opens xAI's sign-in page in the browser and finishes by itself; no window is shown. */
  /** The sign-in running now: a second click replaces it rather than leaving one more `grok login` waiting. */
  private loginChild:ChildProcessWithoutNullStreams|null=null;
  async login(openUrl:(url:string)=>void){
    this.loginChild?.kill();
    const child=await this.start(['login','--oauth']);
    this.loginChild=child;
    let seen='',opened=false;
    const look=(p:Buffer)=>{seen=(seen+p.toString()).slice(-8000);const url=seen.match(/https:\/\/[^\s"'<>]*(?:x\.ai|grok\.com)[^\s"'<>]*/)?.[0];if(url&&!opened){opened=true;setTimeout(()=>openUrl(url),2500);}};
    child.stdout.on('data',look);child.stderr.on('data',look);
    // grok opens the browser itself; the fallback above only fires if that failed and it printed the link instead.
    const timer=setTimeout(()=>child.kill(),15*60_000);
    child.on('close',()=>{opened=true;this.statusCache=null;clearTimeout(timer);if(this.loginChild===child)this.loginChild=null;});
    child.on('error',()=>{});
    this.statusCache=null;
    return {started:true};
  }
  /** Pictures are copied into Grok's own workspace and named in the prompt, so Grok opens them with its file tool. */
  /** `pdfs`: the conversation's PDFs, saved where read_file opens them (grokPdfPath) until dropPdfs ends the turn. */
  /** `workspace`: the conversation's folder of files Grok runs in as itself (its PDFs are there, so none are copied). */
  /** `native`: Kinetra's tool calls for this reply, offered as a native MCP tool (desktop/kinetra-mcp.ts) instead of the
   *  {"kinetra":…} text protocol, so a Kinetra request no longer ends Grok's turn and costs a re-read of the conversation. */
  async run(id:string,prompt:string,model:string,emit:(event:any)=>void,images:string[]=[],session?:{id:string;resume:boolean},effort?:string,{system,pdfs=[],workspace,native}:{system?:string;pdfs?:{name:string;data:Uint8Array}[];workspace?:{root:string};native?:GrokNative}={}){
    const rules=grokRules(system,!!workspace);
    if(system&&!rules)prompt=system+'\n\n'+(workspace?GROK_FOLDER_NOTE:GROK_NOTE)+'\n\n'+prompt;
    const cwd=workspace?.root||this.workspace();
    // A Grok CLI that refused the session flags once runs every later step without them (the tool loop resends everything).
    // A session to go on cannot be resumed by a CLI that keeps none: the message is sent again with everything instead.
    if(this.noSessions){if(session?.resume)throw new SessionLost('This Grok CLI does not keep sessions.');session=undefined;}
    const slug=model.slice(GROK_PREFIX.length);
    let status=this.knownStatus()||await this.status();
    if(!status.connected||!status.models.includes(slug))status=await this.status(true);
    if(!status.installed)throw Error('Install Grok first (Settings → Models).');
    if(!status.connected)throw Error(status.error||'Sign in to Grok first (Settings → Models).');
    if(!status.models.includes(slug))throw Error('This Grok model is not available on your plan. Pick another one.');
    // A level this model does not list is left to Grok's default rather than failing the request.
    if(effort&&!/^[a-z]{2,12}$/.test(effort))effort=undefined;
    if(effort&&status.efforts&&!status.efforts[slug]?.levels.includes(effort))effort=undefined;
    // The prompt goes in a file so long conversations don't hit Windows' command-line length limit.
    const file=join(cwd,'.prompt-'+randomUUID()+'.txt');
    const pictures=join(cwd,'.images-'+randomUUID());
    await mkdir(cwd,{recursive:true});
    if(pdfs.length){
      await mkdir(join(this.workspace(),'.pdfs-'+id),{recursive:true});
      // Written on the turn's first step; later steps find them there.
      await Promise.all(pdfs.map((pdf,index)=>{const path=join(this.workspace(),grokPdfPath(id,index,pdf.name));return stat(path).then(()=>{},()=>writeFile(path,pdf.data));}));
    }
    const named:string[]=[];
    if(images.length){
      await mkdir(pictures,{recursive:true});
      named.push(...images.map((path,index)=>basename(pictures)+'/'+(index+1)+extname(path)));
      await Promise.all(images.map((path,index)=>copyFile(path,join(cwd,named[index]))));
    }
    const endpoint=native&&!this.noNative?await kinetraMcp.open(request=>keepingAlive(()=>picturesAsFiles(native,cwd,id)(request),()=>this.alive.get(id)?.())):undefined;
    if(endpoint){await grokNativeFolder(cwd);if(!session?.resume)prompt=GROK_NATIVE_NOTE+prompt;}
    await writeFile(file,named.length?prompt+'\n\nThe user attached '+(named.length===1?'a picture':named.length+' pictures')+' to this message, saved in the working folder as: '+named.join(', ')+'. Open and look at '+(named.length===1?'it':'them')+' before answering'+(named.length>1?', all in one step (one read_file call each, sent together)':'')+'.':prompt);
    try{
      // In a folder Grok may write there and only there: dontAsk runs only what is allowed, and Edit(./**) (which covers
      // its write tool too) is the working folder. Reading needs no rule.
      const args=()=>['--prompt-file',file,'-m',slug,'--output-format','streaming-messages-json',...(this.noPartial?[]:['--include-partial-messages']),'--permission-mode','dontAsk',...(workspace?['--allow','Edit(./**)']:[]),'--no-subagents',...(this.noToolList?[]:['--no-plan','--tools',workspace?GROK_FOLDER_TOOLS:GROK_TOOLS]),'--no-auto-update','--cwd',cwd,...(effort?['--reasoning-effort',effort]:[]),...(rules?['--rules',rules]:[]),...(session?[session.resume?'--resume':'--session-id',session.id]:[]),...(endpoint&&!this.noNative?grokNativeArgs():[])];
      const env=endpoint?grokMcpEnv(endpoint):{};
      if(session)await this.exited(session.id);
      let result=await this.attempt(id,args(),emit,env);
      // A Grok without folder trust answers with the text protocol, which the instructions still describe.
      // Each fallback reads only the flag Grok named as refused (grokRefusal), never its usage line.
      if(endpoint&&!this.noNative&&/--trust|MCPTool/.test(grokRefusal(result.err))){this.noNative=true;result=await this.attempt(id,args(),emit,env);}
      // A Grok build without partial messages still answers, in one piece.
      if(!this.noPartial&&/include-partial-messages/.test(grokRefusal(result.err))){this.noPartial=true;console.warn('[grok] this Grok refused --include-partial-messages: its replies now arrive in one piece');result=await this.attempt(id,args(),emit,env);}
      // An older Grok without the tool list still answers, with all of its own tools.
      if(!this.noToolList&&/--tools|no-plan/.test(grokRefusal(result.err))){this.noToolList=true;result=await this.attempt(id,args(),emit,env);}
      const reply=parseGrokReply(result.out);
      if(session&&(reply.error||!reply.text)&&/--session-id|--resume/.test(grokRefusal((reply.error||'')+'\n'+result.err))){this.noSessions=true;throw new SessionLost('This Grok CLI does not keep sessions.');}
      if(session?.resume&&(reply.error||!reply.text)&&/session/i.test((reply.error||'')+result.err)&&/not found|no such|unknown|does not exist|invalid/i.test((reply.error||'')+result.err))throw new SessionLost('Grok no longer has this session.');
      if((reply.error||!reply.text)&&outOfUsage(reply.error||result.err))throw new UsageLimit(friendly(reply.error||result.err));
      if((reply.error||!reply.text)&&signedOut.test((reply.error||'')+result.err))this.statusCache=null;
      if(reply.error||!reply.text)throw Error(friendly(reply.error||result.err||String(result.code)));
      this.usageStale=true;
      emit({id,type:'delta',text:reply.text});emit({id,type:'done'});
    }finally{endpoint?.close();if(endpoint)await rm(join(cwd,'.kinetra-'+id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)),{recursive:true,force:true}).catch(()=>{});this.recheck();await rm(file,{force:true}).catch(()=>{});await rm(pictures,{recursive:true,force:true}).catch(()=>{});}
  }
  /**
   * One headless run. Each streamed line says what Grok is doing (thinking, searching, writing), and the reply streams
   * as `partial` events while it is written (desktop/live-reply.ts). Those lines are not kept: `out` holds the whole
   * messages and the result, which parseGrokReply reads.
   */
  private async attempt(id:string,args:string[],emit:(event:any)=>void,env:Record<string,string>={}){
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(args,undefined,env);}
    catch{throw Error('Grok could not start. Install it in Settings → Models.');}
    this.active.set(id,child);
    // The session this run holds until Grok exits (it may exit after the answer is done): its next run waits for it.
    const at=args.findIndex(a=>a==='--resume'||a==='--session-id'),session=at>=0?args[at+1]:undefined;
    let exited=()=>{};
    if(session){const gone=new Promise<void>(resolve=>{exited=resolve;});this.exiting.set(session,gone);void gone.then(()=>{if(this.exiting.get(session)===gone)this.exiting.delete(session);});}
    let early=false;
    return new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
      let out='',err='',done=false;
      const finish=(v?:{code:number|null;out:string;err:string},f?:Error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(quiet);log?.stop();f?reject(f):resolve(v!);};
      // An inactivity limit: any output from Grok, or any line in Grok's own log for this process, restarts it, so a
      // long answer that is still arriving is never cut off. While a model request is in flight (Grok prints nothing
      // while it thinks or writes a long document, and retries a dropped connection itself) the limit waits for it:
      // Grok's own network client decides when a request has failed, and Grok then ends with an error.
      let timer:ReturnType<typeof setTimeout>,inFlight=false,seen=Date.now(),retried=false;
      const limit=()=>{
        if(done)return;
        if(inFlight&&Date.now()-seen<GROK_REQUEST_LIMIT){timer=setTimeout(limit,GROK_IDLE_LIMIT);return;}
        child.kill();finish(undefined,Error(retried?GROK_OFFLINE:'Grok took too long to respond.'));
      };
      // Two minutes with nothing from Grok (a long request in flight) is said on screen once, so a silent wait is not
      // taken for a frozen app; the person can stop it there.
      let quiet:ReturnType<typeof setTimeout>|undefined;
      const hush=()=>{clearTimeout(quiet);quiet=setTimeout(()=>{if(!done)emit({id,type:'status',text:'Grok is still working on it. You can stop it at any time.'});},GROK_QUIET_NOTE);quiet.unref?.();};
      const touch=()=>{seen=Date.now();clearTimeout(timer);timer=setTimeout(limit,GROK_IDLE_LIMIT);hush();};
      touch();
      let log:{stop():void}|undefined;
      if(child.pid)void followGrokLog(this.home||join(process.env.USERPROFILE||'','.grok'),child.pid,event=>{
        if(done)return;
        touch();
        if(event.kind==='start')inFlight=true;
        else if(event.kind==='done'){inFlight=false;if(retried){retried=false;emit({id,type:'status',text:'Connected again. Working…'});}}
        else if(event.kind==='retry'){inFlight=true;retried=true;emit({id,type:'status',text:`Connection to Grok dropped. Trying again${event.attempt?` (${event.attempt}${event.max?' of '+event.max:''})`:''}…`});}
      }).then(follow=>{if(done)follow.stop();else log=follow;},()=>{});
      // While a native Kinetra call runs Grok prints nothing; the call keeps this limit from firing (keepingAlive).
      this.alive.set(id,touch);
      // Decoded as a stream: a character split between two chunks (é, —, Arabic) must not turn into �.
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      let pending='',last='',bytes=0;
      let pieces=0;
      const live=liveText((text,fresh)=>{pieces++;emit({id,type:'partial',text,fresh});});
      // How many model steps asked for tools, and how many calls each carried (the timing log; desktop/tool-status.ts).
      const steps=new StepCounter();
      const read=(line:string)=>{
        if(!line.trim())return;
        let event:any;try{event=JSON.parse(line);}catch{out+=line+'\n';return;}
        steps.read(event);
        const status=grokStatus(event);if(status!==null&&status!==last){last=status;emit({id,type:'status',text:status});}
        if(event?.type==='stream_event')live(event);else out+=line+'\n';
        // Grok takes about three seconds to exit after its result (it saves the session meanwhile): a finished reply is
        // the answer now, and the session's next message waits for that exit instead (exiting, in run).
        if(event?.type==='result')this.noteUnstreamed(pieces,args,parseGrokReply(out).text);
        if(event?.type==='result'&&event.subtype==='success'&&!event.is_error&&parseGrokReply(out).text){
          if(steps.calls)emit({id,type:'toolsteps',steps:steps.steps,calls:steps.calls});
          early=true;finish({code:0,out,err});
        }
      };
      child.stdout.on('data',(p:string)=>{if(!done)touch();bytes+=p.length;if(bytes>256_000_000||out.length>64_000_000){child.kill();finish(undefined,Error('Grok response exceeded the safe limit.'));return;}
        pending+=p;let nl;while((nl=pending.indexOf('\n'))>=0){read(pending.slice(0,nl));pending=pending.slice(nl+1);}});
      child.stderr.on('data',(p:string)=>{if(!done)touch();err=(err+p).slice(-5000);});
      child.on('error',()=>{exited();finish(undefined,Error('Grok could not start. Install it in Settings → Models.'));});
      child.on('close',code=>{exited();if(early)return;read(pending);pending='';if(steps.calls)emit({id,type:'toolsteps',steps:steps.steps,calls:steps.calls});finish({code,out,err:retried?(err+' '+GROK_OFFLINE).slice(-5000):err});});
      child.stdin.end();
    }).finally(()=>{this.active.delete(id);this.alive.delete(id);});
  }
  private warnedUnstreamed=false;
  /** A long reply asked for in pieces that arrived whole says Grok's stream changed shape: logged once, with no text. */
  private noteUnstreamed(pieces:number,args:string[],reply?:string){
    if(this.warnedUnstreamed||pieces||!args.includes('--include-partial-messages')||(reply||'').length<NOTE_HOLD)return;
    this.warnedUnstreamed=true;
    console.warn(`[grok] a ${reply!.length}-character reply arrived with no partial text: check Grok's stream_event lines`);
  }
  /** Removes a turn's PDFs from the working folder once its answer is done. */
  async dropPdfs(turn:string){if(/^[0-9a-f-]{36}$/i.test(turn))await rm(join(this.workspace(),'.pdfs-'+turn),{recursive:true,force:true}).catch(()=>{});}
  /** Grok keeps headless sessions under ~/.grok/sessions; the ones a finished tool loop made are removed (best effort: its layout is not documented). */
  /** The tokens a session has used so far, from Grok's own usage.json (its input counts the cached part too); undefined when there is none. */
  async sessionTokens(sessionId:string):Promise<{input:number;cacheRead:number;cacheWrite:number;output:number}|undefined>{
    if(!/^[0-9a-f-]{36}$/i.test(sessionId))return undefined;
    // Written as Grok exits, which may be after its answer was shown.
    await this.exited(sessionId);
    const base=join(this.home||join(process.env.USERPROFILE||'','.grok'),'sessions');
    for(const folder of await readdir(base).catch(()=>[] as string[])){
      // A usage file Grok is still writing (or left damaged) is skipped, not an error.
      let s:any;try{s=JSON.parse(await readFile(join(base,folder,sessionId,'usage.json'),'utf8'))?.session;}catch{continue;}
      if(!s||typeof s!=='object')continue;
      const n=(v:unknown)=>Math.max(0,Number(v)||0);
      const read=n(s.cachedReadTokens),write=n(s.cacheCreationTokens);
      return {input:Math.max(0,n(s.inputTokens)-read-write),cacheRead:read,cacheWrite:write,output:n(s.outputTokens)};
    }
    return undefined;
  }
  /** Waits (at most 20 s) for the Grok that holds this session to exit. */
  private exited(sessionId:string){const gone=this.exiting.get(sessionId);return gone?Promise.race([gone,new Promise<void>(resolve=>{setTimeout(resolve,20_000).unref?.();})]):Promise.resolve();}
  async endSession(sessionId:string){
    await this.exited(sessionId);
    if(!/^[0-9a-f-]{36}$/i.test(sessionId)||!this.home&&!process.env.USERPROFILE||process.env.CLEM_KEEP_SESSIONS)return;
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
  stop(){for(const child of this.active.values())child.kill();this.loginChild?.kill();}
}
