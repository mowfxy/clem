import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSync,validateSync} from '../../core/sync.ts';
test('essential merge preserves independent edits and deletions; conflicts resolve per record',()=>{
 const base=[{id:'a',text:'old'},{id:'b',text:'keep'}];
 assert.deepEqual(mergeSync(base,[{id:'a',text:'local'}],[...base,{id:'c',text:'remote'}]),[{id:'a',text:'local'},{id:'c',text:'remote'}]);
 // Both edited, no timestamps: both copies are kept (the local one under a derived id); the rest still merges.
 const both=mergeSync(base,[{id:'a',text:'local'},{id:'b',text:'keep'},{id:'d',text:'new'}],[{id:'a',text:'remote'},{id:'b',text:'keep'}]);
 assert.deepEqual(both.map(x=>x.text),['remote','local','keep','new']);
 assert.match(both[1].id,/^a-copy-/);assert.doesNotThrow(()=>validateSync('notes',both));
 // Every device derives the same id for the kept copy, so the next sync settles.
 assert.deepEqual(mergeSync(both,both,both),both);
 // Edit beats delete, on either side.
 assert.deepEqual(mergeSync(base,[{id:'a',text:'local'},{id:'b',text:'keep'}],[{id:'b',text:'keep'}]),[{id:'a',text:'local'},{id:'b',text:'keep'}]);
 assert.deepEqual(mergeSync(base,[{id:'b',text:'keep'}],[{id:'a',text:'remote'},{id:'b',text:'keep'}]),[{id:'a',text:'remote'},{id:'b',text:'keep'}]);
 // Timestamped records: newest update wins regardless of side.
 const tb=[{id:'m',text:'old',updatedAt:'2026-01-01T00:00:00.000Z'}];
 const newer={id:'m',text:'local',updatedAt:'2026-03-01T00:00:00.000Z'},older={id:'m',text:'remote',updatedAt:'2026-02-01T00:00:00.000Z'};
 assert.deepEqual(mergeSync(tb,[newer],[older]),[newer]);
 assert.deepEqual(mergeSync(tb,[older],[newer]),[newer]);
 // A forgotten memory stays forgotten even if another device touched it.
 assert.deepEqual(mergeSync(tb,[],[newer]),[]);
 assert.deepEqual(mergeSync(tb,[newer],[]),[]);
 assert.throws(()=>validateSync('notes',[{id:'x',text:'ok',chats:['private']}])) ;
 assert.throws(()=>validateSync('notes',[{id:'x',text:'a'},{id:'x',text:'b'}]));
});
