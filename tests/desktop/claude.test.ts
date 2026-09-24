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

test('Claude execution confines tools and returns only the confirmed result',async()=>{
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  let args:string[]=[];let prompt='';
  provider.start=async(input:string[])=>{
    args=input;
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.on('data',(part:Buffer)=>prompt+=part.toString());
    child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify({result:'Completed step',is_error:false}));child.emit('close',0);}));
    return child;
  };
  const events:any[]=[];
  await provider.run('one','Full handoff context','claude:sonnet','high',event=>events.push(event));
  assert.equal(prompt,'Full handoff context');
  assert.deepEqual(events.map(event=>event.type),['delta','done']);
  assert.equal(events[0].text,'Completed step');
  assert.deepEqual(args.slice(0,4),['-p','--output-format','json','--model']);
  assert.ok(args.includes('--tools'));
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(args.slice(-2),['--effort','high']);
});
