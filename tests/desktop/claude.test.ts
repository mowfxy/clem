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
  assert.deepEqual(events.slice(0,2).map(event=>event.text),['Thinking it through…','Writing the answer…']);
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
  assert.equal(parsed[0].name,'Claude Opus');assert.equal(parsed[0].defaultReasoningEffort,'high');
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
