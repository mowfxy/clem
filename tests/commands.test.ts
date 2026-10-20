import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCommand,expandCommand,commandsFor,slashCommands,leadingCommand} from '../core/commands.ts';
import {clemSkills,clemSkillsFor} from '../core/clem-skills.ts';
import {builtinSkills} from '../core/skills.ts';

test('a command is read at the start of a message or after a space, and moves to the front',()=>{
  assert.equal(readCommand('/pdf photosynthesis')?.command.id,'pdf');
  assert.equal(readCommand('/pdf')?.rest,'');
  assert.equal(readCommand('make a /pdf about cells')?.command.id,'pdf');
  assert.equal(readCommand('make a /pdf about cells')?.rest,'make a about cells');
  assert.equal(leadingCommand('explain gravity /research'),'/research explain gravity');
  assert.equal(readCommand('see /usr/bin now'),null);
  assert.equal(readCommand('a/pdf b'),null);
  assert.equal(readCommand('/nothing here'),null);
  assert.equal(readCommand('/pdfs please'),null);
});

test('/compact and /handoff work on the conversation with no words after them',()=>{
  assert.match(expandCommand('/compact'),/^Compact this conversation/);
  assert.match(expandCommand('/handoff write the report'),/The next chat will: write the report\./);
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
    for(const id of c.skills||[]) assert.ok(clemSkills.some(s=>s.id===id),`${c.id} → ${id}`);
    if(c.workflow) assert.ok(builtinSkills.some(s=>s.id===c.workflow),`${c.id} → ${c.workflow}`);
  }
  assert.equal(clemSkillsFor('hello',{force:['automations']})[0].id,'automations');
});
