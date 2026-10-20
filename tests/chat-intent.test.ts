import {test} from 'node:test';
import assert from 'node:assert/strict';
import {smallTalk} from '../core/chat-intent.ts';

test('greetings and thanks skip file reading; anything that may need files does not',()=>{
  for(const t of ['hey','Hey!','hi there','thanks so much!','thank you','how are you?','good morning clem','lol','bye, see you later','who are you?',"what's up",'no worries'])assert.equal(smallTalk(t),true,t);
  // "yes"/"ok" may agree to an offer ("Shall I make the PDF?"), which needs the files.
  for(const t of ['ok','yes','sure','what is it','explain chapter 3','hey can you summarize the pdf','thanks, now make it a PDF','what can you do',''])assert.equal(smallTalk(t),false,t);
});
