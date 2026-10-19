import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claudeSubscriptionStatus,claudeModels} from '../../desktop/claude.ts';
import {ClaudeProvider} from '../../desktop/claude.ts';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

test('Claude connection accepts only a confirmed subscription login',()=>{
  assert.equal(claudeSubscriptionStatus(JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'max',email:'claude@example.com'}),0).connected,true);
  assert.equal(claudeSubscriptionStatus(JSON.stringify({loggedIn:true,authMethod:'oauth_token',apiProvider:'firstParty'}),0).connected,false);
  assert.equal(claudeSubscriptionStatus(JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'max'}),1).connected,false);
  assert.equal(claudeSubscriptionStatus('{broken',0).connected,false);
  assert.deepEqual(claudeModels.map(model=>model.id),['claude:sonnet','claude:opus','claude:haiku']);
});

test('Claude execution confines tools, streams progress, sends pictures and returns only the confirmed result',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  let args:string[]=[];let input='';
  provider.start=async(given:string[])=>{
    args=given;
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('data',(part:Buffer)=>input+=part.toString());
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      child.stdout.write(JSON.stringify({type:'system',subtype:'init'})+'\n');
      child.stdout.write(JSON.stringify({type:'stream_event',event:{type:'content_block_start',content_block:{type:'thinking'}}})+'\n');
      child.stdout.write(JSON.stringify({type:'stream_event',event:{type:'content_block_start',content_block:{type:'text'}}})+'\n');
      child.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'Completed step',is_error:false}));
      child.emit('close',0);
    }));
    return child;
  };
  const events:any[]=[];
  await provider.run('one','Full handoff context','claude:sonnet','high',(event:any)=>events.push(event),[{mime:'image/png',data:'iVBORw0KGgo='}]);
  const sent=JSON.parse(input.trim());
  assert.equal(sent.type,'user');
  assert.deepEqual(sent.message.content[0],{type:'text',text:'Full handoff context'});
  assert.deepEqual(sent.message.content[1],{type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgo='}});
  assert.deepEqual(events.map(event=>event.type),['status','status','delta','done']);
  assert.deepEqual(events.slice(0,2).map(event=>event.text),['Thinking it through…','']);
  assert.equal(events[2].text,'Completed step');
  assert.deepEqual(args.slice(0,5),['-p','--input-format','stream-json','--output-format','stream-json']);
  assert.ok(args.includes('--tools'));
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(args.slice(-2),['--effort','high']);
});

test('Claude output split inside a multi-byte character is decoded intact',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  provider.start=async()=>{
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      const bytes=Buffer.from(JSON.stringify({type:'result',subtype:'success',result:'Café — مرحبا',is_error:false})+'\n');
      const cut=bytes.indexOf(Buffer.from('é'))+1;
      child.stdout.write(bytes.subarray(0,cut));child.stdout.write(bytes.subarray(cut));
      child.stdout.end();child.stdout.on('end',()=>child.emit('close',0));
    }));
    return child;
  };
  const events:any[]=[];
  await provider.run('one','hi','claude:sonnet',undefined,(event:any)=>events.push(event));
  assert.equal(events.find(event=>event.type==='delta').text,'Café — مرحبا');
});

test('Claude models come from Claude Code itself, so a model added to the plan appears without a Mowr update',async()=>{
  const {parseClaudeModels}=await import('../../desktop/claude.ts');
  const parsed=parseClaudeModels([
    {value:'default',displayName:'Default (recommended)',description:'Opus 5.5'},
    {value:'opus',displayName:'Opus',description:'Opus 5.5 · Most capable',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
    {value:'claude-fable-5-1',displayName:'Fable 5.1',description:'New model',supportedEffortLevels:['low','high']},
    {value:'opus[1m]',displayName:'Opus (1M context)',description:'Long context'},
    {value:'bad name; rm',displayName:'x'},
  ]);
  assert.deepEqual(parsed.map(m=>m.id),['claude:opus','claude:claude-fable-5-1','claude:opus[1m]']);
  assert.equal(parsed[0].name,'Claude Opus 5.5');assert.equal(parsed[0].description,'Most capable');assert.equal(parsed[1].name,'Claude Fable 5.1');assert.equal(parsed[2].name,'Claude Opus (1M context)');assert.equal(parsed[0].defaultReasoningEffort,'high');
  assert.deepEqual(parsed[0].reasoningEfforts.map(e=>e.reasoningEffort),['low','medium','high','xhigh','max']);
  assert.equal(parsed[2].context,1_000_000);

  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  let request:any=null;
  provider.start=async()=>{
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('data',(part:Buffer)=>{request=JSON.parse(part.toString());queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{models:[{value:'claude-fable-5-1',displayName:'Fable 5.1',description:'New'}]}}})+'\n'));});
    return child;
  };
  assert.deepEqual((await provider.models()).map((m:any)=>m.id),['claude:claude-fable-5-1']);
  assert.equal(request.request.subtype,'initialize');
  // A model the plan no longer lists is refused before anything starts.
  provider.status=async()=>({connected:true});
  await assert.rejects(provider.run('x','hi','claude:opus',undefined,()=>{}),/no longer available/);
});

test('a tool loop continues one Claude Code session: the first step names it, later steps resume it, a lost session is reported',async()=>{
  const {SessionLost}=await import('../../desktop/kinetra-turn.ts');
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  let args:string[]=[];let failure='';
  provider.start=async(given:string[])=>{
    args=given;
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      child.stdout.write(JSON.stringify(failure?{type:'result',subtype:'error_during_execution',is_error:true,result:failure}:{type:'result',subtype:'success',result:'ok',is_error:false}));
      child.emit('close',failure?1:0);
    }));
    return child;
  };
  const id='0b8f6a54-3d0e-4a39-9a0d-6d3a4b1d9c11';
  await provider.run('a','first','claude:sonnet',undefined,()=>{},[],{id,resume:false});
  assert.deepEqual(args.slice(args.indexOf('--session-id'),args.indexOf('--session-id')+2),['--session-id',id]);
  assert.ok(!args.includes('--no-session-persistence'));
  await provider.run('a','more','claude:sonnet',undefined,()=>{},[],{id,resume:true});
  assert.deepEqual(args.slice(args.indexOf('--resume'),args.indexOf('--resume')+2),['--resume',id]);
  await provider.run('a','plain','claude:sonnet',undefined,()=>{});
  assert.ok(args.includes('--no-session-persistence')&&!args.includes('--resume'));
  failure='No conversation found with session ID: '+id;
  await assert.rejects(provider.run('a','more','claude:sonnet',undefined,()=>{},[],{id,resume:true}),SessionLost);
  // The same failure on a first step is an ordinary error, not a lost session.
  await assert.rejects(provider.run('a','first','claude:sonnet',undefined,()=>{},[],{id,resume:false}),e=>!(e instanceof SessionLost));
});

test('Claude’s reply streams as partial events while it is written; text inside a tool never does',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  provider.start=async()=>{
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    const event=(e:any,parent:string|null=null)=>JSON.stringify({type:'stream_event',event:e,parent_tool_use_id:parent})+'\n';
    const text=(t:string,parent:string|null=null)=>event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:t}},parent);
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      child.stdout.write(event({type:'message_start',message:{}})+text('Let me ')+text('search.')+event({type:'message_start',message:{}},'toolu_1')+text('inside the search','toolu_1'));
      child.stdout.write(event({type:'message_start',message:{}})+text('Two ')+text('videos.'));
      child.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'Two videos.',is_error:false})+'\n');
      child.emit('close',0);
    }));
    return child;
  };
  const events:any[]=[];
  await provider.run('one','find videos','claude:sonnet',undefined,(event:any)=>events.push(event));
  assert.deepEqual(events.filter(e=>e.type==='partial').map(e=>[e.text,e.fresh]),[['Let me ',true],['search.',false],['Two ',true],['videos.',false]]);
  assert.deepEqual(events.filter(e=>e.type==='delta').map(e=>e.text),['Two videos.']);
});

test('the steps of a tool loop reuse the sign-in check; a sign-in failure makes the next step check again',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  let checks=0,reply:any={type:'result',subtype:'success',result:'ok',is_error:false};
  provider.start=async(args:string[])=>{
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    if(args[0]==='auth'){checks++;setTimeout(()=>{child.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',subscriptionType:'max'}));child.emit('close',0);});return child;}
    child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify(reply)+'\n');child.emit('close',reply.is_error?1:0);}));
    return child;
  };
  for(let step=0;step<3;step++)await provider.run('one','step','claude:sonnet',undefined,()=>{});
  assert.equal(checks,1);
  reply={type:'result',subtype:'error_during_execution',result:'Not logged in · Please run /login',is_error:true};
  await assert.rejects(()=>provider.run('one','step','claude:sonnet',undefined,()=>{}),/Sign in to Claude again/);
  reply={type:'result',subtype:'success',result:'ok',is_error:false};
  await provider.run('one','step','claude:sonnet',undefined,()=>{});
  assert.equal(checks,2);
  reply={type:'result',subtype:'error_during_execution',result:'Request failed with status 401',is_error:true};
  await assert.rejects(()=>provider.run('one','step','claude:sonnet',undefined,()=>{}));
  reply={type:'result',subtype:'success',result:'ok',is_error:false};
  await provider.run('one','step','claude:sonnet',undefined,()=>{});
  assert.equal(checks,3);
});

test('an older Claude sign-in check does not hold up an answer (it is renewed afterwards); a day-old one is checked first',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  const order:string[]=[];
  let signedIn=true;
  provider.readStatus=async()=>{order.push('check');await new Promise(r=>setTimeout(r,30));const value={installed:true,connected:signedIn};provider.statusCache={at:Date.now(),value};return value;};
  provider.start=async()=>{
    order.push('answer');
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'ok',is_error:false})+'\n');child.emit('close',0);}));
    return child;
  };
  const answer=()=>provider.run('r','hi','claude:sonnet',undefined,()=>{});
  // Never checked: the answer waits for the check.
  await answer();
  assert.deepEqual(order,['check','answer']);
  // An hour old: the answer starts at once, and the check is renewed once it is done.
  order.length=0;provider.statusCache.at-=60*60_000;
  await answer();
  assert.deepEqual(order,['answer','check']);
  await provider.statusRequest;
  // Recent: no check at all.
  order.length=0;
  await answer();
  assert.deepEqual(order,['answer']);
  // A day old: checked again before anything starts, and a lapsed sign-in is refused.
  order.length=0;signedIn=false;provider.statusCache.at-=25*60*60_000;
  await assert.rejects(answer(),/Sign in/);
  assert.deepEqual(order,['check']);
});

test('Claude model names carry their version, read from what Claude Code reports',async()=>{
  const {parseClaudeModels}=await import('../../desktop/claude.ts');
  const parsed=parseClaudeModels([
    {value:'default',resolvedModel:'claude-opus-5-5',displayName:'Default (recommended)',description:'Use the default model (currently Opus 5.5)'},
    {value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',description:'Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok'},
    {value:'claude-fable-5-1[1m]',resolvedModel:'claude-fable-5-1',displayName:'Fable',description:'Fable 5.1 · Most capable for your hardest and longest-running tasks'},
    {value:'sonnet',resolvedModel:'claude-sonnet-5-5',displayName:'Sonnet',description:'Efficient for routine tasks'},
    {value:'haiku',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku',description:'Haiku 4.5 · Fastest for quick answers'},
    {value:'opus[1m]',resolvedModel:'claude-opus-5-5',displayName:'Opus (1M context)',description:'Opus 5.5 for long sessions'},
  ]);
  assert.deepEqual(parsed.map(m=>m.name),['Claude Opus 5.5','Claude Fable 5.1','Claude Sonnet 5.5','Claude Haiku 4.5','Claude Opus 5.5 (1M context)']);
  assert.equal(parsed[0].description,'Best for everyday, complex tasks · $4/$20 per Mtok');
  assert.equal(parsed[1].context,1_000_000);
});
