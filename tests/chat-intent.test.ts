import {test} from 'node:test';
import assert from 'node:assert/strict';
import {smallTalk} from '../core/chat-intent.ts';

test('greetings and thanks skip file reading; anything that may need files does not',()=>{
  for(const t of ['hey','Hey!','hi there','thanks so much!','thank you','how are you?','good morning clem','lol','bye, see you later','who are you?',"what's up",'no worries'])assert.equal(smallTalk(t),true,t);
  // "yes"/"ok" may agree to an offer ("Shall I make the PDF?"), which needs the files.
  for(const t of ['ok','yes','sure','what is it','explain chapter 3','hey can you summarize the pdf','thanks, now make it a PDF','what can you do',''])assert.equal(smallTalk(t),false,t);
});

test('asking to keep sent files in the subject or project is recognised; ordinary questions are not', async () => {
  const { asksToKeepInSpace } = await import('../core/chat-intent.ts');
  for (const yes of ['Save this to the project', 'add these to my subject files', 'please keep it in Biology 101', 'Upload this into the class folder', 'store the PDF under this course'])
    assert.ok(asksToKeepInSpace(yes, 'Biology 101'), yes);
  for (const no of ['Summarise this file', 'Make a worksheet PDF from these notes', 'What does this project need next?', 'Add a summary to the notes', 'save me some time and explain osmosis'])
    assert.ok(!asksToKeepInSpace(no, 'Biology 101'), no);
});
