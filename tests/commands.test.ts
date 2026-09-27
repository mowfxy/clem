import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCommand,expandCommand,commandsFor,slashCommands} from '../core/commands.ts';
import {mowrSkills,mowrSkillsFor} from '../core/mowr-skills.ts';
import {builtinSkills} from '../core/skills.ts';

test('a command is read from the start of a message only',()=>{
  assert.equal(readCommand('/pdf photosynthesis')?.command.id,'pdf');
  assert.equal(readCommand('/pdf')?.rest,'');
  assert.equal(readCommand('make a /pdf'),null);
  assert.equal(readCommand('/nothing here'),null);
  assert.equal(readCommand('/pdfs please'),null);
});

test('commands become explicit instructions; app-handled ones pass through unchanged',()=>{
  assert.match(expandCommand('/pdf the French revolution'),/Kinetra pdf action[\s\S]*\n\nthe French revolution$/);
  assert.equal(expandCommand('/remember that I study physics at Cairo University'),'Remember that I study physics at Cairo University');
  assert.equal(expandCommand('/visual a pendulum'),'/visual a pendulum');
  assert.equal(expandCommand('/quiz cells'),'/quiz cells');
  assert.equal(expandCommand('plain question'),'plain question');
});

test('the menu filters by what is typed and hides subject-only commands outside a subject',()=>{
  assert.deepEqual(commandsFor('vi',false).map(c=>c.id).slice(0,2),['visual','videos']);
  assert.ok(!commandsFor('',false).some(c=>c.id==='quiz'));
  assert.ok(commandsFor('',true).some(c=>c.id==='quiz'));
});

test('every command names real playbooks and workflows, and forced playbooks come first',()=>{
  for(const c of slashCommands){
    for(const id of c.skills||[]) assert.ok(mowrSkills.some(s=>s.id===id),`${c.id} → ${id}`);
    if(c.workflow) assert.ok(builtinSkills.some(s=>s.id===c.workflow),`${c.id} → ${c.workflow}`);
  }
  assert.equal(mowrSkillsFor('hello',{force:['automations']})[0].id,'automations');
});
