import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayTurns,filesNote,withoutFilesNote,notReadyNotice,CUT_OFF_NOTE,FILES_NOTE} from '../core/chat-turns.ts';
import {ChatSessions,conversationPrint} from '../desktop/chat-sessions.ts';

const names: Record<string,string> = {f1:'Lecture 3.pdf',f2:'Circuit.png',f3:'Summary.docx'};
const nameOf = (id: string) => names[id];

test('a failed reply never reaches the next AI as its own answer',()=>{
  const chat=[
    {id:'u1',role:'user',content:'Explain lecture 3'},
    {id:'a1',role:'assistant',content:'Your Claude plan has no usage left right now.',failed:true},
    {id:'u2',role:'user',content:'Explain lecture 3'},
  ];
  const sent=replayTurns(chat,{current:'u2',nameOf});
  assert.deepEqual(sent.map(m=>m.id),['u1','u2']);
});

test('a reply cut off part-way keeps its words, not the notice after them',()=>{
  const sent=replayTurns([{id:'a1',role:'assistant',content:'Step one is'+CUT_OFF_NOTE+'Connection lost.*'},{id:'u2',role:'user',content:'go on'}],{current:'u2',nameOf});
  assert.equal(sent[0].content,'Step one is');
});

test('earlier messages name their files; the message being answered is left as it is',()=>{
  const sent=replayTurns([
    {id:'u1',role:'user',content:'Summarise this',attachments:['f1','gone']},
    {id:'a1',role:'assistant',content:'Done: the summary is attached.',attachments:['f3']},
    {id:'u2',role:'user',content:'Now this one',attachments:['f2']},
  ],{current:'u2',nameOf});
  assert.equal(sent[0].content,'Summarise this'+FILES_NOTE+'Lecture 3.pdf]');
  assert.match(sent[1].content,/\[Files with this message: Summary\.docx\]$/);
  assert.equal(sent[2].content,'Now this one');
  assert.equal(filesNote([],nameOf),'');
  assert.equal(withoutFilesNote(sent[0].content),'Summarise this');
});

test('the files note does not change a kept session\'s fingerprint',()=>{
  // As the message is sent, and as it is sent again once it is earlier (with its files named).
  const now=[{role:'user',content:'Summarise this'},{role:'assistant',content:''}];
  const later=[{role:'user',content:'Summarise this'+FILES_NOTE+'Lecture 3.pdf]'},{role:'assistant',content:'Done.'}];
  assert.equal(conversationPrint(now),conversationPrint(later));
});

test('switching AI starts fresh on the new one, and switching back never resumes the old session',()=>{
  const store=new ChatSessions();
  const ended: string[]=[];
  const history=conversationPrint([{role:'user',content:'hi'},{role:'assistant',content:''}]);
  store.keep('me:chat',{provider:'claude',account:'a',model:'claude:opus',session:'claude-1',history,sent:new Set(['x']),end:()=>ended.push('claude-1')});
  // Another model on the same AI goes on the same session.
  assert.equal(store.take('me:chat',{provider:'claude',account:'a',model:'claude:sonnet',history})?.session,'claude-1');
  store.keep('me:chat',{provider:'claude',account:'a',model:'claude:sonnet',session:'claude-1',history,sent:new Set(['x']),end:()=>ended.push('claude-1')});
  // Another AI: the Claude session is ended, nothing is resumed.
  assert.equal(store.take('me:chat',{provider:'codex',account:'b',model:'gpt',history}),undefined);
  assert.deepEqual(ended,['claude-1']);
  const after=conversationPrint([{role:'user',content:'hi'},{role:'assistant',content:''},{role:'user',content:'more'},{role:'assistant',content:''}]);
  store.keep('me:chat',{provider:'codex',account:'b',model:'gpt',session:'thread-1',history:after,sent:new Set(),end:()=>ended.push('thread-1')});
  // Back to Claude: the Codex thread ends and Claude starts a new session with the whole chat.
  assert.equal(store.take('me:chat',{provider:'claude',account:'a',model:'claude:opus',history:after}),undefined);
  assert.deepEqual(ended,['claude-1','thread-1']);
  assert.equal(store.size,0);
});

test('a chat whose AI is not signed in says which, keeps the message and offers the ways back',()=>{
  const models=[{id:'claude:opus',name:'Claude Opus',connected:false},{id:'gpt-5',name:'GPT-5',connected:true}];
  const other=notReadyNotice('claude:opus',models);
  assert.match(other,/Claude Opus\*\* isn't signed in/);assert.match(other,/message is kept/);assert.match(other,/model menu/);assert.match(other,/Settings → Models/);
  const alone=notReadyNotice('claude:opus',[models[0]]);
  assert.doesNotMatch(alone,/model menu/);assert.match(alone,/Retry/);
  assert.match(notReadyNotice('',[]),/Connect an AI/);
});
