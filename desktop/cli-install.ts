import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Installs the official command-line tools Mowr uses for Claude and Grok, so nobody has to open a terminal.
// Mowr runs each vendor's own published Windows installer, fetched over HTTPS from the vendor's domain at the moment
// the person clicks Install; nothing is bundled or redistributed, and the installer is not modified. Both install
// for the current user only (no administrator rights) into the locations below.

export type CliKind = 'claude'|'grok';
export const clis:Record<CliKind,{name:string;script:string;path:()=>string|undefined;terms:string}> = {
  claude:{name:'Claude Code',script:'https://claude.ai/install.ps1',terms:'https://www.anthropic.com/legal/consumer-terms',
    path:()=>process.env.USERPROFILE&&join(process.env.USERPROFILE,'.local','bin','claude.exe')},
  grok:{name:'Grok',script:'https://x.ai/cli/install.ps1',terms:'https://x.ai/legal/terms-of-service',
    path:()=>process.env.USERPROFILE&&join(process.env.USERPROFILE,'.grok','bin','grok.exe')},
};

/** The installed program's full path when it exists, since Mowr's PATH doesn't see a fresh install until it restarts. */
export function installedPath(kind:CliKind,fallback:string){const path=clis[kind].path();return path&&existsSync(path)?path:fallback;}

const running=new Map<CliKind,Promise<void>>();

/** Runs the vendor installer hidden and resolves when it finishes; a second click joins the running install. */
export function installCli(kind:CliKind){
  const existing=running.get(kind);if(existing)return existing;
  const {name,script}=clis[kind];
  const command=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;irm '${script}' | iex`;
  const job=new Promise<void>((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:process.env.USERPROFILE||process.cwd()});
    let log='';const keep=(d:Buffer)=>{log=(log+d.toString()).slice(-4000);};
    child.stdout.on('data',keep);child.stderr.on('data',keep);
    const timer=setTimeout(()=>{child.kill();reject(Error(`${name} took too long to install. Check your internet connection and try again.`));},10*60_000);
    child.on('error',()=>{clearTimeout(timer);reject(Error(`Windows PowerShell is needed to install ${name}.`));});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code===0&&existsSync(clis[kind].path()||''))return resolve();
      const offline=/could not be resolved|unable to connect|timed out|no such host|network/i.test(log);
      reject(Error(offline?`Couldn’t reach the ${name} download. Check your internet connection and try again.`:`${name} didn’t finish installing. Try again, or contact support@mowrai.com.`));
    });
  }).finally(()=>running.delete(kind));
  running.set(kind,job);return job;
}

/** Sign-in needs the vendor's own interactive screen, so it opens in a small titled window while the actual sign-in
 *  happens on the vendor's page in the browser. Mowr checks `signedIn` every few seconds and closes the window itself
 *  as soon as the account is connected, so the person never has to deal with it. */
export function signInWindow(options:{title:string;message:string;command:string;cwd?:string;env:NodeJS.ProcessEnv;signedIn:()=>Promise<boolean>}){
  const quote=(s:string)=>s.replace(/'/g,"''");
  const script=`$Host.UI.RawUI.WindowTitle='${quote(options.title)}'; Write-Host ''; Write-Host '  ${quote(options.message)}' -ForegroundColor Cyan; Write-Host '  Mowr closes this window when you are signed in.'; Write-Host ''; ${options.command}`;
  const child=spawn('powershell.exe',['-NoProfile','-NoExit','-Command',script],{cwd:options.cwd,env:options.env,detached:true,stdio:'ignore',windowsHide:false});
  child.unref();
  const started=Date.now();
  const close=()=>{if(child.pid)spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});};
  let exited=false;child.on('exit',()=>{exited=true;});
  const check=async()=>{
    if(exited||Date.now()-started>15*60_000)return;
    if(await options.signedIn().catch(()=>false)){close();return;}
    setTimeout(check,3000);
  };
  setTimeout(check,4000);
  return {started:true};
}
