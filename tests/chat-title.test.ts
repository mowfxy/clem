import {test} from 'node:test';
import assert from 'node:assert/strict';
import {takeTitle,hideTitleMarker,titleInstruction,chaptersOf} from '../core/chat-title.ts';
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
  assert.match(titleInstruction(null),/Begin your reply with <!--title/);
  assert.match(titleInstruction('Partial Derivatives'),/Only if the conversation as a whole has clearly moved on/);
});
test('a chat the person named is never retitled, but still gets its chapters and summary',()=>{
  const fixed=titleInstruction('My exam notes',undefined,[],true);
  assert.doesNotMatch(fixed,/<!--title/);
  assert.match(fixed,/^Also add <!--chapter: Name-->/);
  assert.match(fixed,/<!--summary/);
});
test('the model can pick the mark of the chat\'s subject or project',()=>{
  assert.deepEqual(takeTitle('Answer.\n<!--title: Limits-->\n<!--summary: How limits describe approach.-->\n<!--mark: Maths-->'),{content:'Answer.',title:'Limits',summary:'How limits describe approach.',mark:'maths'});
  assert.equal(hideTitleMarker('Answer.\n<!--ma'),'Answer.');
  assert.match(titleInstruction(null,{kind:'subject',name:'Unit 4',description:'',keys:['maths','other']}),/<!--mark: key-->[\s\S]*maths, other/);
  assert.doesNotMatch(titleInstruction(null),/mark: key/);
});

test('a reply that starts a new topic names its chapter, hidden while streaming',()=>{
  assert.deepEqual(takeTitle('Answer.\n<!--chapter: Integration by Parts-->\n<!--summary: Derivatives, then integration by parts.-->'),{content:'Answer.',title:undefined,summary:'Derivatives, then integration by parts.',chapter:'Integration by Parts'});
  for(const tail of ['<!--c','<!--chap','<!--chapter: Integr']) assert.equal(hideTitleMarker('Answer.\n'+tail),'Answer.');
  assert.match(titleInstruction(null),/<!--chapter: Name-->/);
  assert.match(titleInstruction('Calculus',undefined,['Derivatives','Limits']),/current chapter “Limits”/);
});

test('chapters start at the question whose reply named them',()=>{
  const m=(id:string,role:'user'|'assistant',chapter?:string)=>({id,role,content:id,...(chapter?{chapter}:{})});
  const chat={title:'Calculus help',messages:[m('q1','user'),m('a1','assistant','Derivatives'),m('q2','user'),m('a2','assistant'),m('q3','user'),m('a3','assistant','Integration'),m('q4','user'),m('a4','assistant','integration')]};
  assert.deepEqual(chaptersOf(chat),[{id:'q1',title:'Derivatives'},{id:'q3',title:'Integration'}]);
  assert.deepEqual(chaptersOf({title:'Old chat',messages:[m('q1','user'),m('a1','assistant'),m('q2','user'),m('a2','assistant','Vectors')]}),[{id:'q1',title:'Old chat'},{id:'q2',title:'Vectors'}]);
  assert.deepEqual(chaptersOf({title:'Short',messages:[m('q1','user'),m('a1','assistant')]}),[{id:'q1',title:'Short'}]);
});

test('a marker still arriving stays hidden when it has a space before its name or a ">" in its text',()=>{
  for(const tail of ['<!-- ','<!-- ti','<!--summary: Forces -> acceleration','<!--title: A -> B --']) assert.equal(hideTitleMarker('Answer.\n\n'+tail),'Answer.',tail);
  assert.equal(hideTitleMarker('If a -> b then c.'),'If a -> b then c.');
  assert.equal(hideTitleMarker('Answer.<!--summary: A -> B.-->'),'Answer.');
});

test("a reply that used tools splits into the notes written on the way and the answer", async () => {
  const { splitWork, workTime } = await import("../core/chat-title.ts");
  const reply = "I'll solve each circuit first.\n\nNow writing the PDF.\n\nThe worked solutions are in the PDF.<!--title: Circuits-->";
  const at = reply.indexOf("The worked");
  assert.deepEqual(splitWork(reply, at, 134_400), { answer: "The worked solutions are in the PDF.", work: { ms: 134400, notes: "I'll solve each circuit first.\n\nNow writing the PDF." } });
  // Tools ran before anything was written: no notes.
  assert.deepEqual(splitWork("Here it is.", 0, 900), { answer: "Here it is.", work: { ms: 900 } });
  // Nothing after the notes: they are the answer, so the reply stays whole.
  assert.deepEqual(splitWork("Only notes.", 11, 5000), { work: { ms: 5000 } });
  assert.equal(workTime(900), "1s");
  assert.equal(workTime(14_000), "14s");
  assert.equal(workTime(134_400), "2m 14s");
  assert.equal(workTime(3_780_000), "1h 3m");
});
