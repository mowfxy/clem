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
