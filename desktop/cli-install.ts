import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
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
const signIns=new Set<string>();
/** Where a CLI's sign-in page may be opened by Mowr itself: the vendor's own https sign-in hosts only. */
export function signInPageUrl(text:string,hosts:RegExp){
  const raw=text.trim().replace(/^"|"$/g,'').trim();
  try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&hosts.test(url.hostname)?url.href:null;}catch{return null;}
}

/** `page`: Mowr opens the sign-in page in its own window instead of the default browser (the CLI's BROWSER is pointed
 *  at a tiny script that hands the address back). In the default browser an installed Claude desktop app took over
 *  claude.ai's sign-in, so the person ended up signed in to that app and the CLI was never authorised. Returns a closer. */
export async function signInWindow(options:{title:string;message:string;command:string;cwd?:string;env:NodeJS.ProcessEnv;signedIn:()=>Promise<boolean>;page?:{hosts:RegExp;open:(url:string)=>()=>void}}){
  // One window per account: clicking Sign in again while one is open leaves that one to finish.
  if(signIns.has(options.command))return {started:true};
  signIns.add(options.command);
  let handoff:string|undefined,closePage=()=>{};
  if(options.page){
    handoff=join(tmpdir(),'mowr-signin-'+randomBytes(8).toString('hex'));
    await mkdir(handoff,{recursive:true});
    // %* keeps the quotes the CLI puts round the address, so the & in it stays literal for cmd.
    await writeFile(join(handoff,'open.cmd'),`@echo %*> "${join(handoff,'url.txt')}"\r\n`);
    options={...options,env:{...options.env,BROWSER:join(handoff,'open.cmd')}};
  }
  const cleanup=()=>{closePage();closePage=()=>{};if(handoff)void rm(handoff,{recursive:true,force:true}).catch(()=>{});};
  const quote=(s:string)=>s.replace(/'/g,"''");
  const script=`$Host.UI.RawUI.WindowTitle='${quote(options.title)}'; Write-Host ''; Write-Host '  ${quote(options.message)}' -ForegroundColor Cyan; Write-Host '  Mowr closes this window when you are signed in.'; Write-Host ''; ${options.command}`;
  // The window is opened by Start-Process, not spawned directly: a spawned console gets Node's standard handles
  // (stdin is NUL), so PowerShell read end-of-input and closed at once, and the CLI, seeing no terminal, fell back to
  // a paste-the-code sign-in nobody could finish. Start-Process gives it a real console of its own.
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  let pid:number;
  try{
    pid=await new Promise<number>((resolve,reject)=>{
      const launcher=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NoExit','-EncodedCommand','${encoded}' -PassThru).Id`],
        {cwd:options.cwd,env:options.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='';launcher.stdout.setEncoding('utf8');launcher.stdout.on('data',(part:string)=>{output+=part;});launcher.stderr.resume();
      const timer=setTimeout(()=>{launcher.kill();reject(Error('The sign-in window took too long to open. Try again.'));},20000);
      launcher.on('error',()=>{clearTimeout(timer);reject(Error('Windows PowerShell is needed to sign in.'));});
      launcher.on('close',()=>{clearTimeout(timer);const id=Number(output.trim());Number.isInteger(id)&&id>0?resolve(id):reject(Error('The sign-in window could not open. Try again.'));});
    });
  }catch(error){signIns.delete(options.command);cleanup();throw error;}
  const started=Date.now();
  const close=()=>spawn('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
  const open=()=>{try{process.kill(pid,0);return true;}catch{return false;}};
  // Each check starts the CLI, so checks space out (3 s, then up to 15 s) while the person takes their time.
  let wait=3000;
  const check=async()=>{
    // Closed by the person: the next click opens a new window.
    if(!open()){signIns.delete(options.command);cleanup();return;}
    if(Date.now()-started>15*60_000){close();signIns.delete(options.command);cleanup();return;}
    if(await options.signedIn().catch(()=>false)){close();signIns.delete(options.command);cleanup();return;}
    setTimeout(check,wait);wait=Math.min(15000,Math.round(wait*1.3));
  };
  setTimeout(check,4000);
  // The address arrives within a few seconds of the window opening; it is looked for for up to a minute.
  if(options.page&&handoff){
    const page=options.page,file=join(handoff,'url.txt');
    const look=async(tries:number)=>{
      const url=signInPageUrl(await readFile(file,'utf8').catch(()=>''),page.hosts);
      if(url&&signIns.has(options.command)){closePage=page.open(url);return;}
      if(tries>0&&signIns.has(options.command))setTimeout(()=>void look(tries-1),500);
    };
    void look(120);
  }
  return {started:true};
}
