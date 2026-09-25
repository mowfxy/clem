import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {installedPath,signInWindow} from './cli-install.ts';

export const claudeModels = [
  {id:'claude:sonnet',name:'Claude Sonnet',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Sonnet on your Claude subscription',reasoningEfforts:[{reasoningEffort:'low',description:'Low'},{reasoningEffort:'medium',description:'Medium'},{reasoningEffort:'high',description:'High'}],defaultReasoningEffort:'medium'},
  {id:'claude:opus',name:'Claude Opus',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Opus on your Claude subscription',reasoningEfforts:[{reasoningEffort:'low',description:'Low'},{reasoningEffort:'medium',description:'Medium'},{reasoningEffort:'high',description:'High'}],defaultReasoningEffort:'high'},
  {id:'claude:haiku',name:'Claude Haiku',provider:'Anthropic',connected:true,context:32000,specialties:[],tools:[],description:'Current Haiku on your Claude subscription',reasoningEfforts:[],defaultReasoningEffort:''},
] as const;

export function claudeSubscriptionStatus(raw:string,code:number|null) {
  if(code!==0)return {installed:true,connected:false};
  try {const status=JSON.parse(raw);return {installed:true,connected:status.loggedIn===true && status.authMethod==='claude.ai' && !!status.subscriptionType,email:typeof status.email==='string'?status.email:undefined,plan:typeof status.subscriptionType==='string'?status.subscriptionType:undefined};}
  catch{return {installed:true,connected:false};}
}

/** Claude Code is invoked in text mode with web search as its only tool: no files, shell, plugins, project settings or MCP. */
export class ClaudeProvider {
  private active=new Map<string,ChildProcessWithoutNullStreams>();
  private statusCache:{at:number;value:ReturnType<typeof claudeSubscriptionStatus>}|null=null;
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
      child.stdout.on('data',(part:Buffer)=>{output+=part.toString();if(output.length>16000)finish({installed:true,connected:false});});
      child.stderr.resume();child.on('error',()=>finish({installed:false,connected:false}));child.on('close',code=>finish(claudeSubscriptionStatus(output,code)));
    });
    this.statusCache={at:Date.now(),value};return value;
  }
  forget(){this.statusCache=null;}
  async login(){
    await mkdir(this.root,{recursive:true});
    this.statusCache=null;
    return signInWindow({title:'Sign in to Claude · Mowr',message:'Sign in with your Claude account in the browser that opens.',env:this.env(),
      command:`$env:CLAUDE_CONFIG_DIR='${this.root.replace(/'/g,"''")}'; & '${this.executable.replace(/'/g,"''")}' auth login`,
      signedIn:async()=>(await this.status(true)).connected});
  }
  async run(id:string,prompt:string,model:string,effort:string|undefined,emit:(event:any)=>void){
    const selected=claudeModels.find(item=>item.id===model);
    if(!selected)throw Error('Choose a supported Claude model.');
    if(effort&&!selected.reasoningEfforts.some(item=>item.reasoningEffort===effort))throw Error('Choose a supported Claude thinking level.');
    if(!(await this.status(true)).connected)throw Error('Sign in to a Claude subscription through Claude Code first.');
    // Web search is the only tool: it lets Claude find real, current sources (such as YouTube videos) on the person's own plan.
    const args=['-p','--output-format','json','--model',model.slice(7),'--tools','WebSearch','--allowedTools','WebSearch','--disallowedTools','mcp__*','--max-turns','6','--permission-prompts','none','--safe-mode','--no-session-persistence'];
    if(effort)args.push('--effort',effort);
    const child=await this.start(args);this.active.set(id,child);
    try{
      const answer=await new Promise<string>((resolve,reject)=>{
        let output='',error='',done=false;
        const finish=(value?:string,failure?:Error)=>{if(done)return;done=true;clearTimeout(timer);failure?reject(failure):resolve(value||'');};
        const timer=setTimeout(()=>{child.kill();finish(undefined,Error('Claude took too long to respond.'));},180000);
        child.stdout.on('data',(part:Buffer)=>{output+=part.toString();if(output.length>2_000_000){child.kill();finish(undefined,Error('Claude response exceeded the safe limit.'));}});
        child.stderr.on('data',(part:Buffer)=>{error=(error+part.toString()).slice(-5000);});
        child.on('error',()=>finish(undefined,Error('Claude Code could not start. Install its native CLI.')));
        child.on('close',code=>{
          if(code!==0){finish(undefined,Error(/limit|quota|429/i.test(error)?'Claude subscription usage is unavailable right now.':'Claude could not complete this request. Check its sign-in and model access.'));return;}
          try{const result=JSON.parse(output);if(result.is_error){finish(undefined,Error(/limit|quota|429/i.test(result.result||'')?'Claude subscription usage is unavailable right now.':'Claude could not complete this request.'));return;}if(typeof result.result!=='string')throw Error();finish(result.result);}catch{finish(undefined,Error('Claude returned an unreadable response.'));}
        });
        child.stdin.end(prompt);
      });
      emit({id,type:'delta',text:answer});emit({id,type:'done'});
    }finally{this.active.delete(id);}
  }
  cancel(id:string){this.active.get(id)?.kill();}
  stop(){for(const child of this.active.values())child.kill();}
}
