// Runs inside an isolated VM. Do not log provider credentials or raw auth output.
export const subscriptionWorker = String.raw`
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createInterface} from 'node:readline';
const provider=process.argv[2];
const root='/vercel/sandbox/clem';
mkdirSync(root,{recursive:true,mode:0o700});
mkdirSync(root+'/.codex',{recursive:true,mode:0o700});
mkdirSync(root+'/.grok',{recursive:true,mode:0o700});
const status=value=>{writeFileSync(root+'/status.tmp',JSON.stringify(value),{mode:0o600});renameSync(root+'/status.tmp',root+'/status.json');};
const env={HOME:root,PATH:process.env.PATH,CODEX_HOME:root+'/.codex',TERM:'dumb',NO_COLOR:'1'};
const bin='/vercel/sandbox/runtime/node_modules/.bin/';
status({status:'starting'});
let child,complete=false;
const fail=()=>{status({status:'failed',error:'Subscription sign-in did not complete. Please start again.'});child?.kill();};
setTimeout(fail,540000).unref();
if(provider==='openai'){
 child=spawn(bin+'codex',['app-server'],{env,stdio:['pipe','pipe','pipe'],cwd:root});
 const send=v=>child.stdin.write(JSON.stringify(v)+'\n');
 createInterface({input:child.stdout}).on('line',line=>{try{
  const m=JSON.parse(line);
  if(m.id===1){if(m.error)return fail();send({method:'initialized'});send({id:2,method:'account/login/start',params:{type:'chatgptDeviceCode'}});}
  if(m.id===2){if(m.error)return fail();const v=m.result;const url=new URL(v.verificationUrl);if(url.origin!=='https://auth.openai.com')return fail();status({status:'pending',verificationUrl:url.href,userCode:v.userCode});}
  if(m.method==='account/login/completed'){if(!m.params.success)return fail();complete=true;status({status:'complete'});child.kill();}
 }catch{fail();}});
 child.stderr.resume();
 child.on('exit',()=>{if(!complete)fail();});
 send({id:1,method:'initialize',params:{clientInfo:{name:'clem',version:'1.0.0'}}});
}else if(provider==='xai'){
 child=spawn(bin+'grok',['login','--device-auth'],{env,stdio:['ignore','pipe','pipe'],cwd:root});
 let buffer='';
 const parse=data=>{buffer=(buffer+data.toString()).slice(-12000);const match=buffer.match(/https:\/\/accounts\.x\.ai\/oauth2\/device\?user_code=([A-Z0-9-]+)/);if(match)status({status:'pending',verificationUrl:match[0],userCode:match[1]});};
 child.stdout.on('data',parse);child.stderr.on('data',parse);
 child.on('exit',code=>{if(code===0){try{JSON.parse(readFileSync(root+'/.grok/auth.json','utf8'));status({status:'complete'});}catch{fail();}}else fail();});
}else fail();
child?.on('error',fail);
`;
