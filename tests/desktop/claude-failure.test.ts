import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ClaudeProvider,claudeFailure,claudeUsage} from '../../desktop/claude.ts';
import {UsageLimit,Transient} from '../../desktop/kinetra-turn.ts';

test('a usage limit is recognised wherever Claude Code reports it',()=>{
  // The synthetic assistant message carries the kind; the result may have no text at all.
  assert.equal(claudeFailure({apiError:'rate_limit',apiText:'You’ve hit your session limit · resets 3pm (Africa/Cairo)',result:{subtype:'success',is_error:true}}).kind,'limit');
  assert.equal(claudeFailure({result:{subtype:'error_during_execution',is_error:true,errors:['You\'ve hit your weekly limit · resets Oct 16, 9am']}}).kind,'limit');
  assert.equal(claudeFailure({refused:true,result:{subtype:'error_during_execution',is_error:true}}).kind,'limit');
  assert.equal(claudeFailure({apiText:'You\'re out of usage credits. Switch to another model'}).kind,'limit');
  assert.equal(claudeFailure({apiError:'billing_error'}).kind,'limit');
  assert.match(claudeFailure({apiError:'rate_limit',apiText:'You’ve hit your session limit · resets 3pm'}).message,/session limit/);
});

test('other failures say what happened instead of one generic line',()=>{
  assert.equal(claudeFailure({apiError:'authentication_failed',apiText:'Please run /login'}).kind,'signin');
  assert.equal(claudeFailure({apiError:'overloaded',apiText:'API Error: 529 Overloaded'}).kind,'busy');
  assert.equal(claudeFailure({apiText:'API Error: Connection error.'}).kind,'busy');
  // Once the reply has started streaming, running it again would repeat it: not a quiet retry.
  assert.notEqual(claudeFailure({apiError:'overloaded',streamed:true}).kind,'busy');
  assert.equal(claudeFailure({result:{subtype:'error_max_turns',is_error:true}}).kind,'turns');
  assert.equal(claudeFailure({apiText:'Prompt is too long'}).kind,'context');
  assert.equal(claudeFailure({apiError:'max_output_tokens',apiText:'Claude\'s response exceeded the 64000 output token maximum.'}).kind,'length');
  const other=claudeFailure({result:{subtype:'error_during_execution',is_error:true,errors:['Something unexpected']}});
  assert.equal(other.kind,'other');assert.match(other.message,/Something unexpected/);
});

test('a refused window shows as used up even when a share was reported',()=>{
  const usage=claudeUsage([{type:'five_hour',status:'rejected',utilization:0.93,resetsAt:Date.now()/1000+3600}]);
  assert.equal(usage?.rateLimits?.primary?.usedPercent,100);
});

function fake(lines:any[],code=1){
  const provider:any=new ClaudeProvider('fixture','C:/fixture');
  provider.status=async()=>({connected:true});
  provider.readUsage=async()=>({});
  provider.start=async()=>{
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin.resume();
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      for(const line of lines)child.stdout.write(JSON.stringify(line)+'\n');
      child.emit('close',code);
    }));
    return child;
  };
  return provider;
}

test('a limit mid-answer ends the run as a usage limit, with the reset time Claude Code gave',async()=>{
  const resets=Math.round(Date.now()/1000)+7200;
  const provider=fake([
    {type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'five_hour',resetsAt:resets}},
    {type:'assistant',error:'rate_limit',isApiErrorMessage:true,message:{model:'<synthetic>',content:[{type:'text',text:'You’ve hit your session limit · resets 5pm'}]}},
    {type:'result',subtype:'success',is_error:true,result:'You’ve hit your session limit · resets 5pm'},
  ]);
  const events:any[]=[];
  await assert.rejects(provider.run('a','hello','claude:sonnet',undefined,(e:any)=>events.push(e)),(error:any)=>error instanceof UsageLimit&&error.resetsAt===resets*1000);
  // The limit's text is not streamed as if it were the answer.
  assert.ok(!events.some(e=>e.type==='partial'&&/session limit/.test(e.text||'')));
});

test('an overloaded service before anything was written can be retried',async()=>{
  const provider=fake([
    {type:'assistant',error:'overloaded',isApiErrorMessage:true,message:{model:'<synthetic>',content:[{type:'text',text:'API Error: 529 Overloaded'}]}},
    {type:'result',subtype:'success',is_error:true,result:'API Error: 529 Overloaded'},
  ]);
  await assert.rejects(provider.run('b','hello','claude:sonnet',undefined,()=>{}),(error:any)=>error instanceof Transient);
});

test('a finished answer is kept even when Claude Code exits with an error code',async()=>{
  const provider=fake([{type:'result',subtype:'success',is_error:false,result:'Done.'}],1);
  const events:any[]=[];
  await provider.run('c','hello','claude:sonnet',undefined,(e:any)=>events.push(e));
  assert.ok(events.some(e=>e.type==='delta'&&e.text==='Done.'));
});
