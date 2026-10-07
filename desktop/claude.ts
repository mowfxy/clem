import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedPath,signInWindow} from './cli-install.ts';
import {SessionLost,UsageLimit,unsupportedFlag,MAX_CALLS} from './kinetra-turn.ts';
import {kinetraMcp,claudeMcpConfig,keepingAlive,NATIVE_NOTE,CLAUDE_TOOL,TOOL_TIMEOUT_SECONDS,TOOL_OUTPUT_TOKENS,type NativeCall} from './kinetra-mcp.ts';
import {liveText} from './live-reply.ts';

/**
 * Claude Code's arguments for one answer. Web search is its only built-in tool: it lets Claude find real, current
 * sources (such as YouTube videos) on the person's own plan. With `mcpConfig` (the path of a config file holding the endpoint and its token), Kinetra is a native
 * tool as well (desktop/kinetra-mcp.ts): it is the only MCP server loaded (--strict-mcp-config), it is allowed without a
 * prompt, and one reply may make as many calls as the tool loop allows. Safe mode is left out then, since it turns off
 * every MCP server; Claude Code runs in Mowr's own configuration folder and workspace either way.
 */
export function claudeArgs(model:string,effort:string|undefined,session:{id:string;resume:boolean}|undefined,mcpConfig?:string){
  const tools=mcpConfig
    ?['--tools','WebSearch','--allowedTools',`WebSearch,${CLAUDE_TOOL}`,'--mcp-config',mcpConfig,'--strict-mcp-config','--disable-slash-commands','--max-turns',String(MAX_CALLS+10)]
    :['--tools','WebSearch','--allowedTools','WebSearch','--disallowedTools','mcp__*','--max-turns','6','--safe-mode'];
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--model',model,...tools,'--permission-prompts','none'];
  // A tool loop keeps one Claude Code session across its steps: later steps send only the new results and Claude Code supplies the history.
  args.push(...(session?(session.resume?['--resume',session.id]:['--session-id',session.id]):['--no-session-persistence']));
  if(effort)args.push('--effort',effort);
  return args;
}
/**
 * Claude Code's own tools that an answer in a working folder keeps (desktop/ai-workspace.ts): reading, searching and
 * writing files, the web, and its task list for long work. Left out: anything that runs commands or code, subagents,
 * schedules, notifications, worktrees, artifacts, the browser and computer use. (Older and newer Claude Code name the
 * task list differently; a name this one does not know is ignored.)
 */
export const CLAUDE_CLI_TOOLS='Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,TodoWrite,TaskCreate,TaskUpdate,TaskList,TaskGet,ToolSearch';
/** With a writer (claudeWriters), the tool that starts it too ("Task" in older Claude Code, "Agent" in newer). */
export const CLAUDE_AGENT_TOOLS='Task,Agent';
/** The tools a writer has: its own file tools, the web and Kinetra. It starts no further subagents. */
const WRITER_TOOLS=['Read','Write','Edit','Glob','Grep','WebSearch','WebFetch','ToolSearch',CLAUDE_TOOL];
export const WRITER='mowr-writer';
/**
 * Claude Code's subagent for one document of several (--agents, one file per answer). A request for a document per
 * lecture used to read every lecture into one conversation, and every later step re-read all of them; a writer reads
 * only its own sources, so each step carries a third of that, and the documents are written side by side. It has the
 * same rules, tool guide and recipes as the answer itself (`prompt`), and reports back in a few lines.
 */
export function claudeWriters(prompt:string){
  return JSON.stringify({[WRITER]:{
    description:'Writes ONE complete document (pdf or docx) for the person from given source files, at full depth, and makes it with Kinetra. Use one per document when a request needs two or more documents; start them together.',
    prompt:`${prompt}\n\nYOU ARE A MOWR DOCUMENT WRITER: Mowr's main assistant started you for ONE document. Your task says what the person asked (word for word), which document you write, its sources and its draft file. Read those sources yourself (a PDF's text first, then every page whose drawing you need), check every number with Kinetra, write the draft at full depth (everything the request and the sources call for; nothing summarised away), make the file with one pdf or docx request, look at what comes back and fix what is wrong. Then reply in a few lines: the file's id and name, what it covers, and anything you could not do. The document is for the person, not for the assistant.`,
    tools:WRITER_TOOLS,model:'inherit'}});
}
/** What the answer itself is told about its writers (the guide in its prompt explains documents; this, when to delegate). */
export const WRITERS_NOTE=`SEVERAL DOCUMENTS: when the request needs two or more documents (one per lecture, chapter or file), give each one to a ${WRITER} subagent and start them all in the same turn (parallel calls), rather than reading every source yourself: each writer reads only its own sources, so the work is faster and uses far less of the person's plan. Tell each writer: the person's request word for word, the one document it writes (title, kind, everything it must cover), its source files (paths in your working folder) and pages, and its draft file (in your drafts folder, one file each). Read a source yourself only as far as you need to divide the work. When the writers finish, check each report (the file was made, nothing was left out), fix or redo what is missing, then answer the person. One document: write it yourself.`;
/**
 * Claude Code as itself, for an answer with tools: its own system prompt (Mowr's rules are appended to it), its own
 * file tools working in the conversation's folder, and Kinetra as its one MCP server. --restricted removes every tool
 * that runs commands or code, keeps the file tools inside the working directories (the folder and `addDirs`), and
 * ignores the person's own Claude Code settings; `settingsFile` adds the rules for this answer (linked folders are
 * read-only). acceptEdits lets it write in its folder without asking; anything else that would ask is refused.
 */
export function claudeCliArgs(model:string,effort:string|undefined,session:{id:string;resume:boolean}|undefined,{mcpConfig,addDirs=[],settingsFile,agentsFile}:{mcpConfig?:string;addDirs?:string[];settingsFile?:string;agentsFile?:string}={}){
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--model',model,
    '--restricted','--no-chrome','--strict-mcp-config','--tools',agentsFile?CLAUDE_CLI_TOOLS+','+CLAUDE_AGENT_TOOLS:CLAUDE_CLI_TOOLS,'--allowedTools',`WebSearch,WebFetch${mcpConfig?','+CLAUDE_TOOL:''}${agentsFile?','+CLAUDE_AGENT_TOOLS:''}`,
    '--permission-mode','acceptEdits','--permission-prompts','none','--disable-slash-commands','--max-turns',String(MAX_CALLS+10),
    ...(mcpConfig?['--mcp-config',mcpConfig]:[]),...(settingsFile?['--settings',settingsFile]:[]),...(agentsFile?['--agents',agentsFile]:[]),...addDirs.flatMap(dir=>['--add-dir',dir])];
  args.push(...(session?(session.resume?['--resume',session.id]:['--session-id',session.id]):['--no-session-persistence']));
  if(effort)args.push('--effort',effort);
  return args;
}
/** A path as Claude Code's permission rules name it: "//c/Users/…" for C:\Users\… (an absolute path from the root). */
export const rulePath=(path:string)=>'//'+path.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,d:string)=>d.toLowerCase()).replace(/^\/+/,'').replace(/\/+$/,'');
/** The settings for one answer: the linked folders it may read but never change itself (edits to them are proposed). */
export function claudeCliSettings(readOnly:string[]){
  return JSON.stringify({permissions:{deny:readOnly.flatMap(dir=>[`Edit(${rulePath(dir)}/**)`,`Write(${rulePath(dir)}/**)`,`NotebookEdit(${rulePath(dir)}/**)`])}});
}
/** Where one answer runs as Claude Code itself: its working folder and the linked folders it may read. `writer`: what a
 *  document writer is told beyond the system prompt (this request's figure recipes and design guides); with it, the
 *  answer may hand documents to writers (claudeWriters). */
export type ClaudeWorkspace={root:string;readOnly?:string[];writer?:string};
import type {UsageSnapshot,UsageWindow} from '../core/account-usage.ts';

/** One answer's tokens in the console (counts only, never content), to measure efficiency work before and after a change. */
function logUsage(model:string,result:any){
  const u=result?.usage;if(!u)return;
  const n=(x:unknown)=>Number(x)||0;
  console.log(`[mowr tokens] ${model} steps=${n(result.num_turns)} input=${n(u.input_tokens)} cache-write=${n(u.cache_creation_input_tokens)} cache-read=${n(u.cache_read_input_tokens)} output=${n(u.output_tokens)} ms=${n(result.duration_ms)}`);
}
export type ClaudeImage = { mime: string; data: string };
export type ClaudePdf = { name: string; data: string };
/** A Claude Code too old for --system-prompt-file: the step is run again with the rules in the message. */
class NoSystemFile extends Error {}
/** A few words on what Claude is doing, from one stream-json event (null when the event says nothing new). */
export function claudeStatus(event:any):string|null{
  const block=event?.type==='stream_event'&&event.event?.type==='content_block_start'?event.event.content_block:null;
  if(block?.type==='thinking')return 'Thinking it through…';
  if(block?.type==='text')return 'Writing the answer…';
  if(block?.type==='server_tool_use'||block?.type==='tool_use')return block.name==='web_search'||block.name==='WebSearch'?'Searching the web…':'Using a tool…';
  if(event?.type==='assistant')for(const part of event.message?.content||[])if((part.type==='tool_use'||part.type==='server_tool_use')&&/web_?search/i.test(part.name||'')){
    const query=String(part.input?.query||'').trim();return query?`Searching the web for “${query.slice(0,80)}”…`:'Searching the web…';
  }
  if(event?.type==='user'&&(event.message?.content||[]).some((part:any)=>part.type==='tool_result'))return 'Reading what it found…';
  return null;
}
/** One of Claude Code's `rate_limit_event` lines: how much of a plan window is used and when it resets. */
export type ClaudeLimit = {type:string;status?:string;utilization?:number;resetsAt?:number};
export function parseRateLimit(event:any):ClaudeLimit|null{
  if(event?.type!=='rate_limit_event')return null;
  const info=event.rate_limit_info||event.rateLimitInfo||event;
  const type=String(info?.rateLimitType||info?.rate_limit_type||'five_hour');
  const utilization=typeof info?.utilization==='number'&&Number.isFinite(info.utilization)?info.utilization:undefined;
  const resets=Number(info?.resetsAt??info?.resets_at);
  return {type,status:typeof info?.status==='string'?info.status:undefined,utilization,resetsAt:Number.isFinite(resets)&&resets>0?(resets>1e12?Math.round(resets/1000):resets):undefined};
}
/**
 * The plan windows from Claude's own usage endpoint (what Claude Code's /usage shows): `five_hour` and `seven_day`,
 * each with `utilization` in percent and `resets_at` as an ISO time. Kept as fractions, like Claude Code's events.
 */
export function parsePlanUsage(body:any):ClaudeLimit[]{
  const out:ClaudeLimit[]=[];
  for(const type of ['five_hour','seven_day']){
    const window=body?.[type];
    const percent=Number(window?.utilization);
    if(!window||!Number.isFinite(percent))continue;
    const resets=Date.parse(String(window.resets_at||''));
    out.push({type,status:percent>=100?'rejected':'allowed',utilization:Math.max(0,Math.min(100,percent))/100,resetsAt:Number.isFinite(resets)?Math.round(resets/1000):undefined});
  }
  return out;
}
/** Claude's plan windows in the same shape as ChatGPT's, so both show and switch the same way. Utilization is a
 *  fraction (0–1) when Claude Code reports it; a window it refused is shown as used up until it resets. */
export function claudeUsage(limits:ClaudeLimit[],now=Date.now()/1000):UsageSnapshot|undefined{
  if(!limits.length)return undefined;
  const window=(limit:ClaudeLimit|undefined,minutes:number):UsageWindow|null=>{
    if(!limit)return null;
    const expired=!!limit.resetsAt&&limit.resetsAt<=now;
    // Utilization is a fraction (Claude Code's events and parsePlanUsage both give one), so 1 is a full window, not 1%.
    const used=expired?0:typeof limit.utilization==='number'?Math.max(0,Math.min(100,limit.utilization*100)):limit.status==='rejected'?100:null;
    return {usedPercent:used,windowDurationMins:minutes,resetsAt:expired?null:limit.resetsAt??null};
  };
  const short=limits.find(l=>/five|5h|hour|session/i.test(l.type));
  const weekly=limits.find(l=>/seven|7d|week/i.test(l.type));
  const refused=limits.some(l=>l.status==='rejected'&&(!l.resetsAt||l.resetsAt>now));
  return {rateLimits:{primary:window(short,300),secondary:window(weekly,10080)},...(refused?{ordinaryUsageAllowed:false}:{})};
}
type ClaudeModel = {id:string;name:string;provider:string;connected:boolean;context:number;specialties:string[];tools:string[];description:string;reasoningEfforts:{reasoningEffort:string;description:string}[];defaultReasoningEffort:string};
const effortNames:Record<string,string>={low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'};
const levels=(names:string[])=>names.map(reasoningEffort=>({reasoningEffort,description:effortNames[reasoningEffort]||reasoningEffort}));
/** Used only until Claude Code has said which models the person's plan has (or when it cannot say). */
export const claudeModels:ClaudeModel[] = [
  {id:'claude:sonnet',name:'Claude Sonnet 5.5',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Sonnet on your Claude subscription',reasoningEfforts:levels(['low','medium','high']),defaultReasoningEffort:'medium'},
  {id:'claude:opus',name:'Claude Opus 5.5',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Opus on your Claude subscription',reasoningEfforts:levels(['low','medium','high']),defaultReasoningEffort:'high'},
  {id:'claude:haiku',name:'Claude Haiku 4.5',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Haiku on your Claude subscription',reasoningEfforts:[],defaultReasoningEffort:''},
];
/** A failure that looks like a lapsed sign-in: the next request checks the sign-in again instead of trusting the last check. */
const signedOut=/not logged in|log ?in|unauthori[sz]ed|\b401\b|authenticat|oauth token|invalid api key/i;
/** Model names Mowr passes to `--model`: Claude Code's aliases and ids, such as opus, claude-opus-5-5 or sonnet[1m]. */
const MODEL_NAME=/^[A-Za-z0-9._-]{1,80}(?:\[[a-z0-9]{1,8}\])?$/;

/**
 * Claude Code names its models by family only ("Opus", "Fable"); the version sits at the start of the description
 * ("Opus 5.5 · Best for…") and in `resolvedModel` (claude-opus-5-5). Mowr shows both, as "Claude Opus 5.5",
 * keeping a qualifier such as "(1M context)".
 */
export function claudeModelName(m:any,value:string){
  const shown=String(m?.displayName||value).replace(/\s*\((?:recommended|default)\)\s*$/i,'').trim().slice(0,80)||value;
  const tail=shown.match(/\s*\([^)]*\)\s*$/)?.[0]||'';
  const family=shown.slice(0,shown.length-tail.length).replace(/^claude\s+/i,'').trim();
  let description=String(m?.description||'').trim();
  let version='';
  const lead=description.match(/^([A-Za-z]+)\s+(\d+(?:\.\d+)*)\s*(?:·|—|-|$)\s*/);
  const resolved=String(m?.resolvedModel||value).match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[|$)/i);
  if(lead&&lead[1].toLowerCase()===family.toLowerCase()){version=lead[2];description=description.slice(lead[0].length);}
  else if(resolved&&resolved[1].toLowerCase()===family.toLowerCase())version=resolved[2]+(resolved[3]?'.'+resolved[3]:'');
  const base=/\d/.test(family)?family:[family,version].filter(Boolean).join(' ');
  return {name:['Claude',base,tail.trim()].filter(Boolean).join(' ').slice(0,80),description:(description||'On your Claude subscription').slice(0,200)};
}

/**
 * The models Claude Code offers this account, from its own startup handshake (the list its model picker shows),
 * so a model added to the person's plan appears without a Mowr update. "default" only repeats one of the others.
 */
export function parseClaudeModels(list:any):ClaudeModel[]{
  if(!Array.isArray(list))return [];
  const seen=new Set<string>();const models:ClaudeModel[]=[];
  for(const m of list){
    const value=String(m?.value||'');
    if(!MODEL_NAME.test(value)||value==='default'||seen.has(value))continue;
    seen.add(value);
    const listed=(Array.isArray(m.supportedEffortLevels)?m.supportedEffortLevels:[]).filter((e:any)=>typeof e==='string'&&/^[a-z]{2,12}$/.test(e));
    // A model that supports effort without naming its levels gets Claude Code's standard three, so Claude has a thinking picker like ChatGPT.
    const efforts=m.supportsEffort===false||/haiku/i.test(value)&&!listed.length?[]:listed.length?listed:['low','medium','high'];
    const {name,description}=claudeModelName(m,value);
    models.push({id:'claude:'+value,name,provider:'Anthropic',connected:true,context:/\[1m\]$/i.test(value)?1_000_000:32000,specialties:[],tools:[],
      description,reasoningEfforts:levels(efforts),defaultReasoningEffort:efforts.includes('high')&&/opus/i.test(value)?'high':efforts.includes('medium')?'medium':efforts[0]||''});
  }
  return models;
}

const EFFORT_ORDER=['low','medium','high','xhigh','max'];
/**
 * The thinking level for one request. A model's default stays medium (high for Opus) so chat stays quick, but a
 * multi-step tool or document task at medium plans less: a document stops at a sketch, numbers go unverified, broken
 * requests repeat. When the level is still the default and the request may use tools (needsKinetra), it goes up to
 * high. A level the person picked is never changed, nor one the model does not list.
 */
export function toolEffort(models:ClaudeModel[],model:string,effort:string|undefined,chosen:boolean,toolWork:boolean){
  if(chosen||!toolWork)return effort;
  const levels=models.find(m=>m.id===model)?.reasoningEfforts.map(e=>e.reasoningEffort)||[];
  if(!levels.includes('high'))return effort;
  return EFFORT_ORDER.indexOf(effort||'')>=EFFORT_ORDER.indexOf('high')?effort:'high';
}

export function claudeSubscriptionStatus(raw:string,code:number|null) {
  if(code!==0)return {installed:true,connected:false};
  try {const status=JSON.parse(raw);return {installed:true,connected:status.loggedIn===true && status.authMethod==='claude.ai' && !!status.subscriptionType,email:typeof status.email==='string'?status.email:undefined,plan:typeof status.subscriptionType==='string'?status.subscriptionType:undefined};}
  catch{return {installed:true,connected:false};}
}

/**
 * Claude Code on the person's plan. An answer with tools runs it as itself in the conversation's working folder
 * (claudeCliArgs: its own prompt and file tools, no commands or code); short internal requests run it with web search
 * only. Either way no plugins or settings of the person's own, and no MCP server but Mowr's Kinetra one (desktop/kinetra-mcp.ts).
 */
export class ClaudeProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  /** Set when this Claude Code refused --session-id/--resume: tool loops then run without a session. */
  private noSessions=false;
  /** Set when this Claude Code refused --system-prompt-file: Mowr's rules then go at the top of the message. */
  private noSystemFile=false;
  /** Set when this Claude Code refused --agents: answers then write every document themselves. */
  private noAgents=false;
  private statusCache:{at:number;value:ReturnType<typeof claudeSubscriptionStatus>}|null=null;
  /** The last sign-in check while it is recent: each step of a tool loop reuses it instead of starting `claude auth status` again. */
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
  /** The plan windows Claude Code last reported (it says so with each answer), and when. */
  private limits=new Map<string,ClaudeLimit>();
  private limitsAt=0;
  usage(){const usage=claudeUsage([...this.limits.values()]);return usage?{usage,checkedAt:this.limitsAt}:{};}
  /** Claude Code's events usually leave out how much is used (they carry it only near a limit): a window's last known
   *  share is kept while the window is the same, so an event without it does not blank the meter. */
  private noteLimit(limit:ClaudeLimit){
    const before=this.limits.get(limit.type);
    const same=before&&(!limit.resetsAt||!before.resetsAt||limit.resetsAt===before.resetsAt);
    this.limits.set(limit.type,limit.utilization===undefined&&same&&before.utilization!==undefined?{...limit,utilization:before.utilization,resetsAt:limit.resetsAt??before.resetsAt}:limit);
    this.limitsAt=Date.now();
  }
  private planRead:Promise<void>|null=null;
  private planAt=0;
  /**
   * Reads how much of the plan's session and weekly windows is used from Claude's usage endpoint, with this account's
   * own sign-in (the one Claude Code keeps in its folder), at most once a minute unless `force`. An expired sign-in is
   * left for Claude Code to renew; the windows Claude Code reported with its answers are shown meanwhile.
   */
  async readUsage(force=false){
    if(!force&&Date.now()-this.planAt<60_000)return this.usage();
    this.planRead??=(async()=>{
      try{
        const saved=JSON.parse(await readFile(join(this.root,'.credentials.json'),'utf8'))?.claudeAiOauth;
        const token=typeof saved?.accessToken==='string'?saved.accessToken:'';
        if(!token||Number(saved.expiresAt)&&Number(saved.expiresAt)<Date.now()+30_000)return;
        const response=await fetch('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:'Bearer '+token,'anthropic-beta':'oauth-2025-04-20','Content-Type':'application/json'},signal:AbortSignal.timeout(10_000)});
        if(!response.ok)return;
        const windows=parsePlanUsage(await response.json());
        if(!windows.length)return;
        for(const limit of windows)this.limits.set(limit.type,limit);
        this.limitsAt=Date.now();this.planAt=Date.now();
      }catch{}
    })().finally(()=>{this.planRead=null;});
    await this.planRead;
    return this.usage();
  }
  /** Whether a request is running on this account (an account is never switched or removed mid-answer). */
  get busy(){return this.active.size>0;}
  private configured:string;
  /** Re-resolved each time so a Claude Code that Mowr just installed is found without restarting. */
  private get executable(){return this.configured==='claude'?installedPath('claude','claude'):this.configured;}
  private root:string;
  constructor(executable:string,root:string){this.configured=executable;this.root=root;}
  private env():NodeJS.ProcessEnv {
    const env:NodeJS.ProcessEnv={};
    for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOMEDRIVE','HOMEPATH'])if(process.env[key])env[key]=process.env[key];
    env.CLAUDE_CONFIG_DIR=this.root;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';
    // The longest reply each model allows, so one part of a long document is not cut off mid-request.
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS='64000';
    // Native Kinetra calls (desktop/kinetra-mcp.ts): as long as a tool may take, and results passed whole, as in the text protocol.
    env.MCP_TOOL_TIMEOUT=String(TOOL_TIMEOUT_SECONDS*1000);
    env.MAX_MCP_OUTPUT_TOKENS=String(TOOL_OUTPUT_TOKENS);
    return env;
  }
  private async start(args:string[],cwd=join(this.root,'workspace')){await mkdir(this.root,{recursive:true});await mkdir(cwd,{recursive:true});const child=spawn(this.executable,args,{cwd,env:this.env(),shell:false,windowsHide:true,stdio:'pipe'});return child;}
  private statusRequest:Promise<ReturnType<typeof claudeSubscriptionStatus>>|null=null;
  /** One check at a time: callers that arrive while one runs share it. */
  async status(force=false){
    if(!force&&this.statusCache&&Date.now()-this.statusCache.at<30000)return this.statusCache.value;
    this.statusRequest??=this.readStatus().finally(()=>{this.statusRequest=null;});
    return this.statusRequest;
  }
  private async readStatus(){
    await mkdir(join(this.root,'workspace'),{recursive:true});
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(['auth','status']);}catch{return {installed:false,connected:false};}
    const value=await new Promise<ReturnType<typeof claudeSubscriptionStatus>>(resolve=>{
      let output='';let done=false;
      const finish=(result:ReturnType<typeof claudeSubscriptionStatus>)=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(result);};
      const timer=setTimeout(()=>finish({installed:true,connected:false}),10000);
      child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{output+=part;if(output.length>16000)finish({installed:true,connected:false});});
      child.stderr.resume();child.on('error',()=>finish({installed:false,connected:false}));child.on('close',code=>finish(claudeSubscriptionStatus(output,code)));
    });
    this.statusCache={at:Date.now(),value};return value;
  }
  forget(){this.statusCache=null;this.catalog=null;}
  private catalog:{at:number;models:ClaudeModel[]}|null=null;
  /** The models known now, without waiting for Claude Code: the account's list once read, the fixed one until then. */
  get listed(){return this.catalog?.models||claudeModels;}
  private catalogRequest:Promise<ClaudeModel[]>|null=null;
  /** The models this Claude account can use, read from Claude Code every ten minutes; the fixed list if it cannot say. */
  async models():Promise<ClaudeModel[]>{
    if(this.catalog&&Date.now()-this.catalog.at<10*60_000)return this.catalog.models;
    if(!this.catalogRequest)this.catalogRequest=this.readModels().then(models=>{
      if(models.length)this.catalog={at:Date.now(),models};
      return models.length?models:this.catalog?.models||claudeModels;
    }).finally(()=>{this.catalogRequest=null;});
    return this.catalogRequest;
  }
  /** Opens Claude Code's stream-json control channel, asks `initialize` (which lists the models) and stops before any prompt. */
  private async readModels():Promise<ClaudeModel[]>{
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--tools','WebSearch','--allowedTools','WebSearch','--disallowedTools','mcp__*','--max-turns','1','--permission-prompts','none','--safe-mode','--no-session-persistence']);}catch{return [];}
    return new Promise(resolve=>{
      let buffer='',done=false;
      const finish=(models:ClaudeModel[])=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(models);};
      const timer=setTimeout(()=>finish([]),25000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(part:string)=>{
        buffer+=part;if(buffer.length>4_000_000){finish([]);return;}
        let newline;
        while((newline=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
          let event:any;try{event=JSON.parse(line);}catch{continue;}
          if(event.type!=='control_response'||event.response?.request_id!=='mowr-models')continue;
          finish(parseClaudeModels(event.response?.response?.models??event.response?.models));
        }
      });
      child.stderr.resume();child.on('error',()=>finish([]));child.on('close',()=>finish([]));
      child.stdin.write(JSON.stringify({type:'control_request',request_id:'mowr-models',request:{subtype:'initialize'}})+'\n');
    });
  }
  /** Claude Code's own updater, at most once a day: a new model can need a newer Claude Code. Mowr turns off
   *  Claude Code's background traffic, which includes its automatic updates, so Mowr asks for them here instead. */
  async update(){
    if(!(await this.status()).installed)return;
    const child=await this.start(['update']).catch(()=>null);
    if(!child)return;
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill(),5*60_000);child.stdout.resume();child.stderr.resume();child.on('error',()=>{clearTimeout(timer);resolve();});child.on('close',()=>{clearTimeout(timer);resolve();});child.stdin.end();});
    this.catalog=null;
  }
  /** `page`: opens Claude's sign-in page in a Mowr window (see signInWindow); without it the default browser is used. */
  async login(page?:(url:string)=>()=>void){
    await mkdir(this.root,{recursive:true});
    this.statusCache=null;
    return signInWindow({title:'Sign in to Claude · Mowr',message:page?'Sign in with your Claude account in the Mowr window that opens.':'Sign in with your Claude account in the browser that opens.',env:this.env(),
      ...(page?{page:{hosts:/^(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)$/,open:page}}:{}),
      command:`$env:CLAUDE_CONFIG_DIR='${this.root.replace(/'/g,"''")}'; & '${this.executable.replace(/'/g,"''")}' auth login`,
      signedIn:async()=>(await this.status(true)).connected});
  }
  /**
   * One answer on the person's Claude plan. Input and output are Claude Code's stream-json, so pictures go in as
   * image blocks and the person sees what Claude is doing (thinking, searching, writing) while it works.
   * The reply streams as `partial` events while it is written (desktop/live-reply.ts); the final `delta` is the
   * confirmed result, which alone is read for tool requests.
   */
  /** `native`: Kinetra's tool calls for this reply, offered as a native tool through a local MCP endpoint. `system`: Mowr's system prompt.
   *  `pdfs`: PDFs read whole as document blocks, as claude.ai takes an upload (every page as drawn plus its text). */
  async run(id:string,prompt:string,model:string,effort:string|undefined,emit:(event:any)=>void,images:ClaudeImage[]=[],session?:{id:string;resume:boolean},native?:NativeCall,{system,pdfs=[],workspace}:{system?:string;pdfs?:ClaudePdf[];workspace?:ClaudeWorkspace}={}):Promise<void>{
    // The request as asked: a step run again (NoSystemFile below) adds its own notes to it, not to this one's.
    const asked=prompt;
    // A Claude Code that refused the session flags once runs every later step without them (the tool loop resends everything).
    if(this.noSessions)session=undefined;
    // One without --system-prompt-file gets Mowr's rules ahead of the request, as before, rather than not at all.
    if(system&&this.noSystemFile){prompt=system+'\n\n'+prompt;system=undefined;}
    if(!model.startsWith('claude:')||!MODEL_NAME.test(model.slice(7)))throw Error('Choose a supported Claude model.');
    // Checked against the account's own list when Mowr has it; otherwise Claude Code itself refuses an unknown model.
    const listed=this.listed;
    const selected=listed.find(item=>item.id===model);
    if(!selected&&this.catalog)throw Error('That Claude model is no longer available on your plan. Pick another one.');
    if(effort&&selected&&!selected.reasoningEfforts.some(item=>item.reasoningEffort===effort))throw Error('Choose a supported Claude thinking level.');
    // A sign-in that lapsed since fails the step itself, which clears the check (below); only a signed-out one is checked again now.
    if(!(this.knownStatus()?.connected||(await this.status(true)).connected))throw Error('Sign in to a Claude subscription through Claude Code first.');
    // A new session learns that requests go to the tool (a resumed one already has it in its history).
    if(native&&!session?.resume)prompt=NATIVE_NOTE+prompt;
    // While a native Kinetra call runs Claude Code prints nothing, so the inactivity limit below is kept from firing.
    let alive=()=>{};
    // Mowr's own system prompt replaces Claude Code's coding-agent one (a file: it is far past Windows' command-line limit).
    // A resumed session reuses the one it recorded; it is passed again for a Claude Code that does not record it.
    const systemFile=system?join(this.root,'workspace','.system-'+randomUUID()+'.txt'):undefined;
    // In a working folder Claude Code keeps its own prompt and Mowr's rules follow it; the linked folders it may only read go in its settings.
    const settingsFile=workspace?.readOnly?.length?join(this.root,'workspace','.settings-'+randomUUID()+'.json'):undefined;
    if(settingsFile){await mkdir(join(this.root,'workspace'),{recursive:true});await writeFile(settingsFile,claudeCliSettings(workspace!.readOnly!));}
    // Writers need Kinetra, so they come only with the native tool; a Claude Code too old for --agents runs without them.
    const agentsFile=workspace&&native&&system&&workspace.writer!==undefined&&!this.noAgents?join(this.root,'workspace','.agents-'+randomUUID()+'.json'):undefined;
    if(agentsFile){await mkdir(join(this.root,'workspace'),{recursive:true});await writeFile(agentsFile,claudeWriters(system+(workspace!.writer?'\n\n'+workspace!.writer:'')));}
    if(agentsFile&&!session?.resume)prompt=WRITERS_NOTE+'\n\n'+prompt;
    if(systemFile){await mkdir(join(this.root,'workspace'),{recursive:true});await writeFile(systemFile,system!);}
    const endpoint=native?await kinetraMcp.open(request=>keepingAlive(()=>native(request),()=>alive())):undefined;
    // The endpoint's token goes in a file in this account's own folder (owner-only), never on the command line, which
    // other programs and process listings can read.
    const mcpFile=endpoint?join(this.root,'workspace','.mcp-'+randomUUID()+'.json'):undefined;
    const removeFiles=async()=>{for(const file of [systemFile,mcpFile,settingsFile,agentsFile])if(file)await rm(file,{force:true}).catch(()=>{});};
    let child:ChildProcessWithoutNullStreams;
    try{
      if(mcpFile){await mkdir(join(this.root,'workspace'),{recursive:true});await writeFile(mcpFile,claudeMcpConfig(endpoint!),{mode:0o600});}
      child=workspace
        ?await this.start([...claudeCliArgs(model.slice(7),effort,session,{mcpConfig:mcpFile,addDirs:workspace.readOnly,settingsFile,agentsFile}),...(systemFile?['--append-system-prompt-file',systemFile]:[])],workspace.root)
        :await this.start([...claudeArgs(model.slice(7),effort,session,mcpFile),...(systemFile?['--system-prompt-file',systemFile]:[])]);
    }
    catch(error){endpoint?.close();await removeFiles();throw error;}
    this.active.set(id,child);
    try{
      const answer=await new Promise<string>((resolve,reject)=>{
        let buffer='',bytes=0,error='',done=false,result:any=null;
        const finish=(value?:string,failure?:Error)=>{if(done)return;done=true;clearTimeout(timer);failure?reject(failure):resolve(value||'');};
        // An inactivity limit: any output from Claude Code restarts it, so a long answer that keeps streaming is never cut off.
        let timer:ReturnType<typeof setTimeout>;
        const touch=()=>{if(done)return;clearTimeout(timer);timer=setTimeout(()=>{child.kill();finish(undefined,Error('Claude took too long to respond.'));},600000);};
        touch();alive=touch;
        let last='';
        const live=liveText((text,fresh)=>emit({id,type:'partial',text,fresh}));
        const read=(line:string)=>{
          if(!line.trim())return;
          let event:any;try{event=JSON.parse(line);}catch{return;}
          if(event.type==='result'){result=event;logUsage(model,event);return;}
          live(event);
          const limit=parseRateLimit(event);
          if(limit)this.noteLimit(limit);
          const status=claudeStatus(event);
          if(status&&status!==last){last=status;emit({id,type:'status',text:status});}
        };
        // Decoded as a stream: a character split between two chunks (é, —, Arabic) must not turn into �.
        child.stdout.setEncoding('utf8');
        child.stdout.on('data',(part:string)=>{
          if(!done)touch();
          bytes+=part.length;if(bytes>64_000_000){child.kill();finish(undefined,Error('Claude response exceeded the safe limit.'));return;}
          buffer+=part;let newline;
          while((newline=buffer.indexOf('\n'))>=0){read(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
        });
        child.stderr.setEncoding('utf8');child.stderr.on('data',(part:string)=>{error=(error+part).slice(-5000);});
        child.on('error',()=>finish(undefined,Error('Claude Code could not start. Install its native CLI.')));
        child.on('close',code=>{
          read(buffer);
          const usage=(text:string)=>/limit|quota|429/i.test(text);
          if(result&&!result.is_error&&result.subtype==='success'&&typeof result.result==='string'&&code===0){finish(result.result);return;}
          const detail=String(result?.result||'')+' '+error;
          if(systemFile&&unsupportedFlag.test(detail)&&/system-prompt/i.test(detail)){this.noSystemFile=true;return finish(undefined,new NoSystemFile());}
          // Nothing ran: the same step again without writers.
          if(agentsFile&&unsupportedFlag.test(detail)&&/agents/i.test(detail)){this.noAgents=true;return finish(undefined,new NoSystemFile());}
          if(session&&unsupportedFlag.test(detail)){this.noSessions=true;return finish(undefined,new SessionLost('This Claude Code does not keep sessions.'));}
          if(session?.resume&&/no conversation found|session.{0,40}(not found|does not exist|missing)/i.test(detail+JSON.stringify(result?.errors||'')))return finish(undefined,new SessionLost('Claude Code no longer has this session.'));
          if(usage(detail))return finish(undefined,new UsageLimit('Claude subscription usage is unavailable right now.'));
          if(signedOut.test(detail))this.statusCache=null;
          finish(undefined,Error(/not logged in|login/i.test(detail)?'Sign in to Claude again in Settings > Models.':'Claude could not complete this request. Check its sign-in and model access.'));
        });
        // A Claude Code that exits without reading the message (a flag it refuses) fails the pending write: its exit says why, above.
        child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content:[...pdfs.map(pdf=>({type:'document',source:{type:'base64',media_type:'application/pdf',data:pdf.data},title:pdf.name})),{type:'text',text:prompt},...images.map(image=>({type:'image',source:{type:'base64',media_type:image.mime,data:image.data}}))]}})+'\n');
      });
      emit({id,type:'delta',text:answer});emit({id,type:'done'});
    }catch(error){
      // Nothing ran: the same step again, with the rules in the message instead.
      if(error instanceof NoSystemFile)return this.run(id,asked,model,effort,emit,images,session,native,{system,pdfs,workspace});
      throw error;
    }finally{this.active.delete(id);endpoint?.close();this.recheck();void this.readUsage(true);await removeFiles();}
  }
  /** Removes the transcript of a tool loop's session once its answer is done, so steps do not pile up on disk.
   *  MOWR_KEEP_SESSIONS=1 keeps them, to see afterwards what every step sent and cost. */
  async endSession(sessionId:string){
    if(!/^[0-9a-f-]{36}$/i.test(sessionId)||process.env.MOWR_KEEP_SESSIONS)return;
    const projects=join(this.root,'projects');
    for(const folder of await readdir(projects).catch(()=>[] as string[])){
      await rm(join(projects,folder,sessionId+'.jsonl'),{force:true}).catch(()=>{});
      await rm(join(projects,folder,sessionId),{recursive:true,force:true}).catch(()=>{});
    }
  }
  /** Signs this Claude Code out (its own command), so the account's sign-in is cleared from this PC. */
  async logout(){
    this.statusCache=null;this.limits.clear();this.planAt=0;
    const child=await this.start(['auth','logout']).catch(()=>null);
    if(!child)return;
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},20000);child.stdout.resume();child.stderr.resume();child.on('error',()=>{clearTimeout(timer);resolve();});child.on('close',()=>{clearTimeout(timer);resolve();});child.stdin.end();});
  }
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
