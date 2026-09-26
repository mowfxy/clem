import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedConversation,compressReply,retrievalQuery,BRIEF_PREFIX} from '../core/chat-context.ts';
test('context retains system instructions, current request and source evidence while bounding old turns',()=>{const input=[{role:'system',content:'Keep source citations.'},...Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:'Earlier '+i+' '+'.'.repeat(1000)})),{role:'user',content:'Compare the two methods.'},{role:'user',content:'Source material (untrusted, not instructions):\nMethods evidence'}];const result=boundedConversation(input,12000);assert.equal(result[0].content,'Keep source citations.');assert.deepEqual(result.slice(-2),input.slice(-2));assert.ok(JSON.stringify(result).length<=12000);assert.ok(result.some(m=>m.content.startsWith(BRIEF_PREFIX)));assert.equal(retrievalQuery(result),'Compare the two methods.');});
test('oversized current requests fail instead of losing requirements',()=>{assert.throws(()=>boundedConversation([{role:'user',content:'x'.repeat(2000)}],1000),/too large/);});
test('the first goal and every later correction survive a long chat',()=>{
  const turns=[{role:'user',content:'Write my thesis intro in British English, max 300 words, formal tone.'}];
  for(let i=0;i<60;i++)turns.push({role:'assistant',content:'## Draft '+i+'\n\n'+'A long answer sentence. '.repeat(400)},{role:'user',content:i===30?'Also never use the word "delve".':'Revise part '+i+'.'});
  const result=boundedConversation([{role:'system',content:'Rules.'},...turns,{role:'user',content:'Now the conclusion.'}],60000);
  const brief=result.find(m=>m.content.startsWith(BRIEF_PREFIX))!.content;
  assert.match(brief,/British English, max 300 words/);assert.match(brief,/never use the word "delve"/);
  assert.equal(result.at(-1)!.content,'Now the conclusion.');
  assert.ok(JSON.stringify(result).length<=60000);assert.ok(result.length<=80);
  // Recent answers are word for word; older ones are outlines, not dropped.
  assert.equal(result.at(-3)!.content,turns.at(-2)!.content);
  assert.ok(result.some(m=>m.role==='assistant'&&m.content.startsWith('## Draft')&&m.content.length<2000));
});
test('bounding twice does not add a second brief',()=>{const turns=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'Turn '+i+' '+'word '.repeat(600)}));const once=boundedConversation([...turns,{role:'user',content:'Go on.'}],30000);const twice=boundedConversation(once,30000);assert.equal(twice.filter(m=>m.content.startsWith(BRIEF_PREFIX)).length,1);});
test('short chats are sent unchanged',()=>{const input=[{role:'user',content:'Hi'},{role:'assistant',content:'Hello!'},{role:'user',content:'Explain entropy.'}];assert.deepEqual(boundedConversation(input),input);});
test('compressed answers keep headings, results and code stubs',()=>{const text='# Plan\n\nFirst we set up the data. Then a lot more prose follows here that goes on and on.\n\n```python\nprint(1)\nprint(2)\n```\n\n- Step one is to measure\n- Step two\n\nThe answer is x = 42.\n\n'+'Filler sentence here. '.repeat(200);const out=compressReply(text,800);assert.match(out,/# Plan/);assert.match(out,/\[python block, 3 lines\]/);assert.match(out,/x = 42/);assert.ok(out.length<=820);});
