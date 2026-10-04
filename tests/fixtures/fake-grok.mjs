// Stands in for xAI's `grok` (Grok Build) in tests, matching its source: `grok models` text, ACP over
// `grok agent stdio`, and `--output-format streaming-messages-json` (messages, then a result). FAKE_GROK=signed-out | limit | split | lost | old (no session flags) | steps (notes between tool uses) | stream (partial messages) | nopartial (a build without --include-partial-messages) | ok (default)
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
    if(m.method==='initialize')stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{},_meta:{modelState:{availableModels:[{modelId:'grok-4.6',_meta:{supportsReasoningEffort:true,reasoningEffort:'high',reasoningEfforts:[{value:'xhigh'},{value:'high',default:true},{value:'medium'},{value:'low'}]}},{modelId:'grok-build-0.1',_meta:{supportsReasoningEffort:false}}]}}}})+'\n');
    else if(m.method==='_x.ai/billing')stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{result:{config:{creditUsagePercent:37.4,billingPeriodEnd:'2026-10-01T00:00:00Z'},subscription_tier:'SUPERGROK'}}})+'\n');
    else stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'nope'}})+'\n');}});
  stdin.on('end',()=>exit(0));
}
else {
  if(args.includes('--always-approve')||args.includes('--yolo')){stderr.write('Mowr must never auto-approve tools\n');exit(9);}
  const mode2=args[args.indexOf('--permission-mode')+1];
  if(mode2!=='dontAsk'){stderr.write('expected dontAsk, got '+mode2+'\n');exit(2);}
  const prompt=readFileSync(args[args.indexOf('--prompt-file')+1],'utf8'),model=args[args.indexOf('-m')+1];
  if(args[args.indexOf('--output-format')+1]!=='streaming-messages-json'){stderr.write('expected streaming-messages-json\n');exit(2);}
  const effort=args.includes('--reasoning-effort')?args[args.indexOf('--reasoning-effort')+1]:'';
  const line=o=>JSON.stringify(o)+'\n';
  const said=(text,extra=[])=>line({type:'assistant',message:{role:'assistant',content:[{type:'text',text},...extra]}});
  if(mode==='old'&&(args.includes('--session-id')||args.includes('--resume'))){stderr.write("error: unknown option '"+(args.includes('--resume')?'--resume':'--session-id')+"'\n");exit(2);}
  if(mode==='lost'&&args.includes('--resume')){stdout.write(JSON.stringify({type:'error',message:'Session 1234 not found'})+'\n');exit(1);}
  if(mode==='nopartial'&&args.includes('--include-partial-messages')){stderr.write("error: unexpected argument '--include-partial-messages' found\n");exit(2);}
  if(mode==='limit'){stdout.write(JSON.stringify({type:'error',message:'Rate limit exceeded for your plan'})+'\n');exit(1);}
  // A reply written in two pipe chunks that cut through a multi-byte character.
  if(mode==='split'){const bytes=Buffer.from(line({type:'result',subtype:'success',is_error:false,result:'Caf\u00e9 \u2014 \u0645\u0631\u062d\u0628\u0627'})),cut=bytes.indexOf(0xc3)+1;stdout.write(bytes.subarray(0,cut),()=>setTimeout(()=>stdout.write(bytes.subarray(cut),()=>exit(0)),50));}
  // Grok's own agent may note what it is doing and use its tools before the reply: only the last message is the reply.
  else if(mode==='steps'){stdout.write(line({type:'system',subtype:'init'})+said("I'll read the pages.",[{type:'tool_use',id:'t1',name:'read_file',input:{}}])+line({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t1'}]}})+said('The pages are in.')+said('{"kinetra":{"action":"help"}}')+line({type:'result',subtype:'success',is_error:false,result:'{"kinetra":{"action":"help"}}'}),()=>exit(0));}
  // With --include-partial-messages each message also arrives as stream_event pieces: a note, a tool use, then the reply.
  else if(mode==='stream'&&args.includes('--include-partial-messages')){
    const event=e=>line({type:'stream_event',event:e,parent_tool_use_id:null});
    const message=(pieces,extra=[])=>event({type:'message_start',message:{content:[]}})+event({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+pieces.map(text=>event({type:'content_block_delta',index:0,delta:{type:'text_delta',text}})).join('')+event({type:'message_stop'})+said(pieces.join(''),extra);
    stdout.write(line({type:'system',subtype:'init'})+message(["I'll look ","at it."],[{type:'tool_use',id:'t1',name:'read_file',input:{}}])+line({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t1'}]}})+message(['The picture ','shows a ','pulley.'])+line({type:'result',subtype:'success',is_error:false,result:'The picture shows a pulley.'}),()=>exit(0));
  }
  else{
  const reply=`[${model}${effort?' '+effort:''}] ${prompt}`;
  stdout.write(line({type:'system',subtype:'init'})+said(reply)+line({type:'result',subtype:'success',is_error:false,result:reply}),()=>exit(0));}
}
