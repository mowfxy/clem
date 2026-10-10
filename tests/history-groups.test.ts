import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayLabel,groupHistory} from '../core/history-groups.ts';
const now=new Date(2026,9,10,15,0).getTime(), at=(m:number,d:number,h=12,y=2026)=>new Date(y,m,d,h).getTime();
test('days read Today, Yesterday, then a short date, with the year only when it differs',()=>{
  assert.equal(dayLabel(at(9,10,0),now),'Today');
  assert.equal(dayLabel(at(9,9,23),now),'Yesterday');
  assert.equal(dayLabel(at(9,9,0),now),'Yesterday');
  assert.equal(dayLabel(at(9,8),now),'Oct 8');
  assert.equal(dayLabel(at(11,30,12,2025),now),'Dec 30, 2025');
  assert.equal(dayLabel(now+3600e3,now),'Today');
});
test('pinned chats come first, then one group per day, newest first',()=>{
  const chats=[{id:'a',updated:at(9,8)},{id:'b',updated:at(9,10,9)},{id:'c',updated:at(9,10,14)},{id:'d',updated:at(1,1),pinned:true},{id:'e',updated:at(9,9)}];
  const groups=groupHistory(chats,now);
  assert.deepEqual(groups.map(g=>g.label),['Pinned','Today','Yesterday','Oct 8']);
  assert.deepEqual(groups.map(g=>g.items.map(c=>c.id)),[['d'],['c','b'],['e'],['a']]);
});
test('the limit trims older unpinned chats but never pinned ones',()=>{
  const chats=Array.from({length:10},(_,i)=>({id:String(i),updated:now-i*864e5,pinned:i===9}));
  const groups=groupHistory(chats,now,3);
  assert.equal(groups.flatMap(g=>g.items).length,4);
  assert.equal(groups[0].items[0].id,'9');
});
