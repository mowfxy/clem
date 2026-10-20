import {test} from 'node:test';
import assert from 'node:assert/strict';
import {submitSupport} from '../../desktop/support.ts';
import {requestSchema} from '../../desktop/contracts.ts';
const payload={category:'Contact support',subject:'A question',message:'Please help with this issue.'};
test('desktop support sends only the intended fields to the fixed authenticated endpoint',async()=>{
  const result=await submitSupport('test-token',payload,async(input,init)=>{
    assert.equal(input,'https://clem.m4labs.xyz/api/support');
    assert.equal(init?.redirect,'error');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-token');
    assert.equal(new Headers(init?.headers).get('Cookie'),null);
    assert.equal(new Headers(init?.headers).get('Origin'),'https://clem.m4labs.xyz');
    assert.deepEqual(JSON.parse(String(init?.body)),payload);
    return Response.json({ok:true,id:'receipt'});
  });
  assert.deepEqual(result,{ok:true,id:'receipt'});
});
test('support failures never report success or automatically retry',async()=>{
  for(const status of [401,403,429,500]) {
    let calls=0;
    await assert.rejects(submitSupport('test',payload,async()=>{calls++;return Response.json({error:'private diagnostics'},{status});}),error=>error instanceof Error&&!error.message.includes('private diagnostics'));
    assert.equal(calls,1);
  }
  await assert.rejects(submitSupport('test',payload,async()=>Response.json({})),/failed/);
  await assert.rejects(submitSupport('test',payload,async()=>{throw Error('offline');}),/could not be confirmed/);
});
test('desktop support validates bounded, nonempty input before IPC handling',()=>{
  assert.equal(requestSchema.safeParse({action:'supportSend',...payload}).success,true);
  for(const patch of [{subject:' '},{message:'short'},{message:'x'.repeat(10001)},{category:'untrusted'}])
    assert.equal(requestSchema.safeParse({action:'supportSend',...payload,...patch}).success,false);
});
