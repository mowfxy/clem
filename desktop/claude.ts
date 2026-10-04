import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installedPath,signInWindow} from './cli-install.ts';
import {SessionLost,UsageLimit,unsupportedFlag} from './kinetra-turn.ts';
import type {UsageSnapshot,UsageWindow} from '../core/account-usage.ts';

export type ClaudeImage = { mime: string; data: string };
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
/** Claude's plan windows in the same shape as ChatGPT's, so both show and switch the same way. Utilization is a
 *  fraction (0–1) when Claude Code reports it; a window it refused is shown as used up until it resets. */
export function claudeUsage(limits:ClaudeLimit[],now=Date.now()/1000):UsageSnapshot|undefined{
  if(!limits.length)return undefined;
  const window=(limit:ClaudeLimit|undefined,minutes:number):UsageWindow|null=>{
    if(!limit)return null;
    const expired=!!limit.resetsAt&&limit.resetsAt<=now;
    const used=expired?0:typeof limit.utilization==='number'?Math.max(0,Math.min(100,limit.utilization<=1?limit.utilization*100:limit.utilization)):limit.status==='rejected'?100:null;
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
  {id:'claude:sonnet',name:'Claude Sonnet',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Sonnet on your Claude subscription',reasoningEfforts:levels(['low','medium','high']),defaultReasoningEffort:'medium'},
  {id:'claude:opus',name:'Claude Opus',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Opus on your Claude subscription',reasoningEfforts:levels(['low','medium','high']),defaultReasoningEffort:'high'},
  {id:'claude:haiku',name:'Claude Haiku',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Haiku on your Claude subscription',reasoningEfforts:[],defaultReasoningEffort:''},
];
/** Model names Mowr passes to `--model`: Claude Code's aliases and ids, such as opus, claude-opus-5-5 or sonnet[1m]. */
const MODEL_NAME=/^[A-Za-z0-9._-]{1,80}(?:\[[a-z0-9]{1,8}\])?$/;

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
    const name=String(m.displayName||value).replace(/\s*\((?:recommended|default)\)\s*$/i,'').trim().slice(0,80)||value;
    models.push({id:'claude:'+value,name:/^claude\b/i.test(name)?name:'Claude '+name,provider:'Anthropic',connected:true,context:/\[1m\]$/i.test(value)?1_000_000:32000,specialties:[],tools:[],
      description:String(m.description||'On your Claude subscription').slice(0,200),reasoningEfforts:levels(efforts),defaultReasoningEffort:efforts.includes('high')&&/opus/i.test(value)?'high':efforts.includes('medium')?'medium':efforts[0]||''});
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

/** Claude Code is invoked in text mode with web search as its only tool: no files, shell, plugins, project settings or MCP. */
export class ClaudeProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  /** Set when this Claude Code refused --session-id/--resume: tool loops then run without a session. */
  private noSessions=false;
  /** Set when this Claude Code refused --system-prompt-file: Mowr's rules then go at the top of the message. */
  private noSystemFile=false;
  private statusCache:{at:number;value:ReturnType<typeof claudeSubscriptionStatus>}|null=null;
  /** The plan windows Claude Code last reported (it says so with each answer), and when. */
  private limits=new Map<string,ClaudeLimit>();
  private limitsAt=0;
  usage(){const usage=claudeUsage([...this.limits.values()]);return usage?{usage,checkedAt:this.limitsAt}:{};}
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
    return env;
  }
  private async start(args:string[]){await mkdir(this.root,{recursive:true});const child=spawn(this.executable,args,{cwd:join(this.root,'workspace'),env:this.env(),shell:false,windowsHide:true,stdio:'pipe'});return child;}
  async status(force=false){
    if(!force&&this.statusCache&&Date.now()-this.statusCache.at<30000)return this.statusCache.value;
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
  async login(){
    await mkdir(this.root,{recursive:true});
    this.statusCache=null;
    return signInWindow({title:'Sign in to Claude · Mowr',message:'Sign in with your Claude account in the browser that opens.',env:this.env(),
      command:`$env:CLAUDE_CONFIG_DIR='${this.root.replace(/'/g,"''")}'; & '${this.executable.replace(/'/g,"''")}' auth login`,
      signedIn:async()=>(await this.status(true)).connected});
  }
  /**
   * One answer on the person's Claude plan. Input and output are Claude Code's stream-json, so pictures go in as
   * image blocks and the person sees what Claude is doing (thinking, searching, writing) while it works.
   */
  async run(id:string,prompt:string,model:string,effort:string|undefined,emit:(event:any)=>void,images:ClaudeImage[]=[],session?:{id:string;resume:boolean},{system}:{system?:string}={}):Promise<void>{
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
    if(!(await this.status(true)).connected)throw Error('Sign in to a Claude subscription through Claude Code first.');
    // Web search is the only tool: it lets Claude find real, current sources (such as YouTube videos) on the person's own plan.
    const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--model',model.slice(7),'--tools','WebSearch','--allowedTools','WebSearch','--disallowedTools','mcp__*','--max-turns','6','--permission-prompts','none','--safe-mode'];
    // A tool loop keeps one Claude Code session across its steps: later steps send only the new results and Claude Code supplies the history.
    args.push(...(session?(session.resume?['--resume',session.id]:['--session-id',session.id]):['--no-session-persistence']));
    if(effort)args.push('--effort',effort);
    // Mowr's own system prompt replaces Claude Code's coding-agent one (a file: it is far past Windows' command-line limit).
    // A resumed session reuses the one it recorded; it is passed again for a Claude Code that does not record it.
    const systemFile=system?join(this.root,'workspace','.system-'+randomUUID()+'.txt'):undefined;
    if(systemFile){await mkdir(join(this.root,'workspace'),{recursive:true});await writeFile(systemFile,system!);args.push('--system-prompt-file',systemFile);}
    let child:ChildProcessWithoutNullStreams;
    try{child=await this.start(args);}catch(error){if(systemFile)await rm(systemFile,{force:true}).catch(()=>{});throw error;}
    this.active.set(id,child);
    try{
      const answer=await new Promise<string>((resolve,reject)=>{
        let buffer='',bytes=0,error='',done=false,result:any=null;
        const finish=(value?:string,failure?:Error)=>{if(done)return;done=true;clearTimeout(timer);failure?reject(failure):resolve(value||'');};
        // An inactivity limit: any output from Claude Code restarts it, so a long answer that keeps streaming is never cut off.
        let timer:ReturnType<typeof setTimeout>;
        const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>{child.kill();finish(undefined,Error('Claude took too long to respond.'));},600000);};
        touch();
        let last='';
        const read=(line:string)=>{
          if(!line.trim())return;
          let event:any;try{event=JSON.parse(line);}catch{return;}
          if(event.type==='result'){result=event;return;}
          const limit=parseRateLimit(event);
          if(limit){this.limits.set(limit.type,limit);this.limitsAt=Date.now();}
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
          if(session&&unsupportedFlag.test(detail)){this.noSessions=true;return finish(undefined,new SessionLost('This Claude Code does not keep sessions.'));}
          if(session?.resume&&/no conversation found|session.{0,40}(not found|does not exist|missing)/i.test(detail+JSON.stringify(result?.errors||'')))return finish(undefined,new SessionLost('Claude Code no longer has this session.'));
          if(usage(detail))return finish(undefined,new UsageLimit('Claude subscription usage is unavailable right now.'));
          finish(undefined,Error(/not logged in|login/i.test(detail)?'Sign in to Claude again in Settings > Models.':'Claude could not complete this request. Check its sign-in and model access.'));
        });
        child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:prompt},...images.map(image=>({type:'image',source:{type:'base64',media_type:image.mime,data:image.data}}))]}})+'\n');
      });
      emit({id,type:'delta',text:answer});emit({id,type:'done'});
    }catch(error){
      // Nothing ran: the same step again, with the rules in the message instead.
      if(error instanceof NoSystemFile)return this.run(id,prompt,model,effort,emit,images,session,{system});
      throw error;
    }finally{this.active.delete(id);if(systemFile)await rm(systemFile,{force:true}).catch(()=>{});}
  }
  /** Removes the transcript of a tool loop's session once its answer is done, so steps do not pile up on disk. */
  async endSession(sessionId:string){
    if(!/^[0-9a-f-]{36}$/i.test(sessionId))return;
    const projects=join(this.root,'projects');
    for(const folder of await readdir(projects).catch(()=>[] as string[])){
      await rm(join(projects,folder,sessionId+'.jsonl'),{force:true}).catch(()=>{});
      await rm(join(projects,folder,sessionId),{recursive:true,force:true}).catch(()=>{});
    }
  }
  /** Signs this Claude Code out (its own command), so the account's sign-in is cleared from this PC. */
  async logout(){
    this.statusCache=null;this.limits.clear();
    const child=await this.start(['auth','logout']).catch(()=>null);
    if(!child)return;
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},20000);child.stdout.resume();child.stderr.resume();child.on('error',()=>{clearTimeout(timer);resolve();});child.on('close',()=>{clearTimeout(timer);resolve();});child.stdin.end();});
  }
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
