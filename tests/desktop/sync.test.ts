import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSync,validateSync} from '../../core/sync.ts';
test('essential merge preserves independent edits and deletions; conflicts do not overwrite',()=>{
 const base=[{id:'a',text:'old'},{id:'b',text:'keep'}];
 assert.deepEqual(mergeSync(base,[{id:'a',text:'local'}],[...base,{id:'c',text:'remote'}]),[{id:'a',text:'local'},{id:'c',text:'remote'}]);
 assert.throws(()=>mergeSync(base,[{id:'a',text:'local'}],[{id:'a',text:'remote'}]),/conflict/);
 assert.throws(()=>validateSync('notes',[{id:'x',text:'ok',chats:['private']}])) ;
 assert.throws(()=>validateSync('notes',[{id:'x',text:'a'},{id:'x',text:'b'}]));
});
