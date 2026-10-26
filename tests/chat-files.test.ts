import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filesOfDeletedChat} from '../core/chat-files.ts';
import type {Chat,StoredFile} from '../core/types.ts';
const T=Date.parse('2026-09-01T00:00:00Z');
const file=(id:string,extra:Partial<StoredFile>={}):StoredFile=>({id,name:id,size:10,type:'application/pdf',created:T,spaceId:null,...extra});
const chat=(id:string,spaceId:string|null,messages:Chat['messages']):Chat=>({id,title:id,spaceId,messages,updated:T});
const sent=(ids:string[],at=T+1000)=>({id:'u'+ids.join(),role:'user' as const,content:'q',at,attachments:ids});
const made=(ids:string[])=>({id:'a'+ids.join(),role:'assistant' as const,content:'a',attachments:ids});
test('a normal chat takes its sent files and the files Clem made in it',()=>{
  const c=chat('c1',null,[sent(['up']),made(['doc'])]);
  const files=[file('up',{chatId:'c1'}),file('doc',{made:true}),file('other')];
  assert.deepEqual(filesOfDeletedChat(c,[c],files).map(f=>f.id),['up','doc']);
});
test('a project chat takes its sent files and leaves the files Clem made in the project',()=>{
  const c=chat('c1','p1',[sent(['up']),made(['doc'])]);
  const files=[file('up',{chatId:'c1',spaceId:'p1'}),file('doc',{made:true,spaceId:'p1'})];
  assert.deepEqual(filesOfDeletedChat(c,[c],files).map(f=>f.id),['up']);
});
test('a file another chat still uses stays',()=>{
  const c=chat('c1',null,[sent(['up']),made(['doc'])]),other=chat('c2',null,[sent(['doc'])]);
  assert.deepEqual(filesOfDeletedChat(c,[c,other],[file('up',{chatId:'c1'}),file('doc',{made:true})]).map(f=>f.id),['up']);
});
test('a library file picked into the chat stays; an untagged upload sent with a message goes',()=>{
  const c=chat('c1',null,[sent(['lib','old'])]);
  const files=[file('lib',{created:T-86_400_000}),file('old',{created:T})];
  assert.deepEqual(filesOfDeletedChat(c,[c],files).map(f=>f.id),['old']);
});
test('a file uploaded into another chat stays',()=>{
  const c=chat('c1',null,[sent(['x'])]);
  assert.deepEqual(filesOfDeletedChat(c,[c],[file('x',{chatId:'c0'})]),[]);
});
test('an untagged file added since uploads were tagged came from the library and stays',()=>{
  const now=Date.parse('2026-11-01T00:00:00Z'),c=chat('c1',null,[sent(['lib'],now+1000)]);
  assert.deepEqual(filesOfDeletedChat(c,[c],[file('lib',{created:now})]),[]);
});
