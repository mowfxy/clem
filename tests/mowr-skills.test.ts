import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mowrSkillsFor,mowrSkillText,documentsNote,capabilityIndex} from '../core/mowr-skills.ts';
import {relevantSkills,builtinSkills} from '../core/skills.ts';
import {isEditRequest,isDocumentChange} from '../src/files/intent.ts';
import {validatePlan,parseLeadPlan,plannerInstructions,MIN_STEPS,MAX_STEPS} from '../core/orchestration.ts';

test('asking for videos brings the video playbook, with web search and visible links',()=>{
  const ids=mowrSkillsFor('give me youtube videos explaining this').map(s=>s.id);
  assert.ok(ids.includes('videos'));
  const text=mowrSkillText('send me the link to a video on photosynthesis');
  assert.match(text,/search the web first/);
  assert.match(text,/visible text/);
  assert.equal(relevantSkills('youtube videos explaining partial derivatives')[0].id,'youtube');
});
test('document revision is taught only when the conversation has documents',()=>{
  assert.ok(!mowrSkillsFor('make it longer').some(s=>s.id==='revise'));
  assert.ok(mowrSkillsFor('make it longer',{documents:true}).some(s=>s.id==='revise'));
  const note=documentsNote([{id:'11111111-1111-4111-8111-111111111111',name:'Notes.pdf'}]);
  assert.match(note,/"revise":"<id>"/);assert.match(note,/Notes\.pdf/);
  assert.equal(documentsNote([]),'');
});
test('the capability index is always present and short',()=>{
  assert.ok(mowrSkillText('hello').startsWith(capabilityIndex));
  assert.ok(capabilityIndex.length<1600);
});
test('every built-in skill is detailed',()=>{
  for(const s of builtinSkills){assert.ok(s.steps.length>=5,s.id);assert.ok(s.steps.every(x=>x.length>20),s.id);}
  assert.ok(!builtinSkills.some(s=>s.steps.some(x=>/no web access/i.test(x))),'skills no longer claim there is no web access');
});
test('change requests to an open file are recognised in plain words',()=>{
  for(const t of ['the diagram is wrong, redo it','I want more examples','make it longer','it should have a table of contents','redo page 2','add a section on enzymes']) assert.equal(isEditRequest(t),true,t);
  for(const t of ['what does page 2 say?','explain the diagram','make flashcards from this','summarize this']) assert.equal(isEditRequest(t),false,t);
  assert.equal(isDocumentChange('make the pdf longer'),true);
  assert.equal(isDocumentChange('add salt to the soup'),false);
});
test('long tasks have as many steps as the work needs',()=>{
  const models=[{id:'m',name:'m',provider:'OpenAI' as const,connected:true,context:1,specialties:[],tools:[]}];
  const plan=(n:number)=>JSON.stringify({tasks:Array.from({length:n},(_,i)=>({title:'t'+i,instructions:'i',output:'o',dependsOn:i?['step-'+i]:[]}))});
  assert.equal(parseLeadPlan(plan(2),'g','m',models).tasks.length,2);
  assert.equal(parseLeadPlan(plan(11),'g','m',models).tasks.length,11);
  assert.throws(()=>parseLeadPlan(plan(MAX_STEPS+1),'g','m',models));
  assert.equal(MIN_STEPS,2);
  assert.match(plannerInstructions,/Decide how many steps/);
  void validatePlan;
});
