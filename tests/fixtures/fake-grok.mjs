// Stands in for xAI's `grok` (Grok Build) in tests, matching its source: `grok models` text, ACP over
// `grok agent stdio`, and the `--output-format json` result object. FAKE_GROK=signed-out | limit | split | lost | old (no session flags) | ok (default)
import {argv,stdin,stdout,stderr,exit,env} from 'node:process';
import {readFileSync} from 'node:fs';
const args=argv.slice(2),mode=env.FAKE_GROK||'ok';
if(env.XAI_API_KEY){stderr.write('Mowr must not pass XAI_API_KEY\n');exit(9);}
if(args[0]==='models'){
  if(mode==='signed-out'){stdout.write('You are not authenticated.\n\n');stderr.write('Error: Authentication required. Run `grok login`\n');exit(1);}
  stdout.write('You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-build-0.1\n  - grok-4.3-mini\n');exit(0);
}
if(args[0]==='agent'&&args[1]==='stdio'){
  let buf='';stdin.on('data',d=>{buf+=d;let nl;while((nl=buf.indexOf('\n'))>=0){const m=JSON.parse(buf.slice(0,nl));buf=buf.slice(nl+1);
    if(m.method==='initialize')stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}})+'\n');
    else if(m.method==='_x.ai/billing')stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{result:{config:{creditUsagePercent:37.4,billingPeriodEnd:'2026-10-01T00:00:00Z'},subscription_tier:'SUPERGROK'}}})+'\n');
    else stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'nope'}})+'\n');}});
  stdin.on('end',()=>exit(0));
}
else {
  if(args.includes('--always-approve')||args.includes('--yolo')){stderr.write('Mowr must never auto-approve tools\n');exit(9);}
  const mode2=args[args.indexOf('--permission-mode')+1];
  if(mode2!=='dontAsk'){stderr.write('expected dontAsk, got '+mode2+'\n');exit(2);}
  const prompt=readFileSync(args[args.indexOf('--prompt-file')+1],'utf8'),model=args[args.indexOf('-m')+1];
  if(mode==='old'&&(args.includes('--session-id')||args.includes('--resume'))){stderr.write("error: unknown option '"+(args.includes('--resume')?'--resume':'--session-id')+"'\n");exit(2);}
  if(mode==='lost'&&args.includes('--resume')){stdout.write(JSON.stringify({type:'error',message:'Session 1234 not found'})+'\n');exit(1);}
  if(mode==='limit'){stdout.write(JSON.stringify({type:'error',message:'Rate limit exceeded for your plan'})+'\n');exit(1);}
  // A reply written in two pipe chunks that cut through a multi-byte character.
  if(mode==='split'){const bytes=Buffer.from(JSON.stringify({text:'Caf\u00e9 \u2014 \u0645\u0631\u062d\u0628\u0627'})+'\n'),cut=bytes.indexOf(0xc3)+1;stdout.write(bytes.subarray(0,cut),()=>setTimeout(()=>stdout.write(bytes.subarray(cut),()=>exit(0)),50));}
  else{
  stdout.write(JSON.stringify({text:`[${model}] ${prompt}`,stopReason:'end_turn',sessionId:'s1',requestId:'r1'},null,2)+'\n');exit(0);}
}
