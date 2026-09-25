import {test} from 'node:test';
import assert from 'node:assert/strict';
import {takeTitle,hideTitleMarker,titleInstruction} from '../core/chat-title.ts';
test('a reply marker becomes the chat title and is removed from the answer',()=>{
  assert.deepEqual(takeTitle('The chain rule says…\n\n<!--title: Chain Rule for Partial Derivatives-->'),{content:'The chain rule says…',title:'Chain Rule for Partial Derivatives'});
  assert.deepEqual(takeTitle('Plain answer.'),{content:'Plain answer.',title:undefined});
  assert.equal(takeTitle('x <!--title: "Quoted."--> y <!--title: Later Topic-->').title,'Later Topic');
  assert.equal(takeTitle('x<!--title:  -->').title,undefined);
  assert.ok(takeTitle('x<!--title: '+'word '.repeat(30)+'-->').title!.length<=61);
});
test('a marker that is still streaming in never flashes on screen',()=>{
  for(const tail of ['<','<!','<!-','<!--','<!--ti','<!--title:','<!--title: Chain Ru']){const shown=hideTitleMarker('Answer.\n\n'+tail);assert.ok(shown.startsWith('Answer.')&&!shown.includes('<!'),tail);}
  assert.equal(hideTitleMarker('Answer.<!--title: Done-->'),'Answer.');
  assert.equal(hideTitleMarker('Use <!DOCTYPE html> first'),'Use <!DOCTYPE html> first');
});
test('the model is only asked to rename when the subject has moved on',()=>{
  assert.match(titleInstruction(null),/End your reply with/);
  assert.match(titleInstruction('Partial Derivatives'),/Only if the conversation as a whole has clearly moved on/);
});
