import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clemSkills,clemSkillsFor,clemSkillText,documentsNote,capabilityIndex,type SkillContext} from '../core/clem-skills.ts';
import {parseChecks} from '../core/checks.ts';
import {relevantSkills,builtinSkills} from '../core/skills.ts';
import {isEditRequest,isDocumentChange} from '../src/files/intent.ts';
import {validatePlan,parseLeadPlan,plannerInstructions,MIN_STEPS,MAX_STEPS} from '../core/orchestration.ts';

test('asking for videos brings the video playbook, with web search and visible links',()=>{
  const ids=clemSkillsFor('give me youtube videos explaining this').map(s=>s.id);
  assert.ok(ids.includes('videos'));
  const text=clemSkillText('send me the link to a video on photosynthesis');
  assert.match(text,/search the web first/);
  assert.match(text,/visible text/);
  assert.equal(relevantSkills('youtube videos explaining partial derivatives')[0].id,'youtube');
});
test('document revision is taught only when the conversation has documents',()=>{
  assert.ok(!clemSkillsFor('make it longer').some(s=>s.id==='revise'));
  assert.ok(clemSkillsFor('make it longer',{documents:true}).some(s=>s.id==='revise'));
  const note=documentsNote([{id:'11111111-1111-4111-8111-111111111111',name:'Notes.pdf'}]);
  assert.match(note,/"revise":"<id>"/);assert.match(note,/Notes\.pdf/);
  assert.equal(documentsNote([]),'');
});
test('the capability index is always present and short',()=>{
  assert.ok(clemSkillText('hello').startsWith(capabilityIndex));
  assert.ok(capabilityIndex.length<2200);
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
test('each request gets the playbooks it needs and not the ones it does not',()=>{
  const ids=(q:string,c:SkillContext={})=>clemSkillsFor(q,c).map(s=>s.id);
  const cases:[string,SkillContext,string[],string[]][]=[
    ['give me youtube videos explaining this',{},['videos'],['visuals','study']],
    ['every morning at 8, summarise the latest AI news',{},['automations','web'],['documents']],
    ['can you do flashcards on the krebs cycle',{subject:true},['study'],[]],
    ['what does week 3 say?',{drive:true},['drive'],[]],
    ['fix the bug in utils.ts',{folders:true},['folders'],[]],
    ['fix the bug in utils.ts',{},[],['folders']],
    ['remember that I am a second-year physics student',{},['memory'],['automations']],
    ['what files can you see?',{},['files','context'],[]],
    ['share my flashcards with my classmates',{},['study-packs'],[]],
    ['What is the difference between a subject and a project in Clem?',{},['spaces'],[]],
    ['create a skill for grading essays',{},['own-skills'],[]],
    ['this is too big, can you run it as a long task',{},['long-tasks'],[]],
    ['make a pdf study guide on cell biology with a mind map',{},['documents','visuals'],[]],
    ['export this as a powerpoint',{},['export'],['documents']],
    ['make it longer',{documents:true},['revise'],[]],
    ['what is an ion channel',{},[],['videos']],
    ['explain these notes',{},[],['documents']],
    ['what is my daily routine',{},[],['automations']],
    ['what is the cube root of 27',{},[],['3d']],
    ['help me with my project',{},[],['spaces']],
    ['hello',{},[],['videos','documents','files','web','memory']],
  ];
  for(const [q,c,yes,no] of cases){
    const got=ids(q,c);
    for(const id of yes) assert.ok(got.includes(id),`${q} should bring ${id}, got ${got}`);
    for(const id of no) assert.ok(!got.includes(id),`${q} should not bring ${id}, got ${got}`);
  }
  assert.deepEqual(ids('hello'),[]);
});
test('explicit feature requests survive the per-request limit',()=>{
  const busy='Every Monday at 7, look up the latest papers and news on the physics of 3d magnetic field visuals, make a pdf report with a chart and cite sources from my attached files';
  const all=clemSkillsFor(busy,{},99).map(s=>s.id);
  assert.ok(all.length>6,'the request matches more playbooks than the limit');
  const chosen=clemSkillsFor(busy).map(s=>s.id);
  assert.equal(chosen.length,6);
  assert.equal(chosen[0],'automations');
  assert.ok(chosen.includes('documents'));
  assert.ok(!chosen.includes('notation'),'general helpers give way to the features asked for');
});
test('playbooks are complete, distinct and listed in the capability index',()=>{
  assert.equal(new Set(clemSkills.map(s=>s.id)).size,clemSkills.length);
  for(const s of clemSkills){assert.ok(s.steps.length>=3,s.id);assert.ok(s.steps.every(x=>x.length>30),s.id);}
  for(const word of ['Web search','Videos','Google Drive','Documents','Visuals','Checks','Files','Subjects','Memory','Routines','Long tasks','Export','```edit']) assert.ok(capabilityIndex.includes(word),word);
  assert.ok(capabilityIndex.length<2200);
});
test('playbook formats match the parsers that read them',()=>{
  const numbers=clemSkills.find(s=>s.id==='numbers')!.steps.join('\n');
  const example=/(\{"checks":\[.*?\]\})/.exec(numbers)![1];
  assert.deepEqual(parseChecks(example).map(r=>r.status),['ok']);
  const automations=clemSkills.find(s=>s.id==='automations')!.steps.join('\n');
  for(const key of ['"name"','"prompt"','"repeat"','"time"','"day"','09:00']) assert.ok(automations.includes(key),key);
  const folders=clemSkills.find(s=>s.id==='folders')!.steps.join('\n');
  for(const key of ['"path"','"find"','"replace"','"summary"','"content"','256 KB','exactly once']) assert.ok(folders.includes(key),key);
  const visuals=clemSkills.find(s=>s.id==='visuals')!.steps.join('\n');
  for(const key of ['"title"','6 sliders','24 nodes']) assert.ok(visuals.includes(key),key);
  const study=clemSkills.find(s=>s.id==='study')!.steps.join('\n');
  assert.match(study,/no set was saved/);assert.match(study,/\/flashcards/);
});
test('built-in workflows are not triggered by passing words',()=>{
  const ids=(q:string)=>relevantSkills(q).map(s=>s.id);
  assert.ok(!ids('find a video under 20 minutes on entropy').includes('meeting-notes'));
  assert.ok(ids('write up the minutes of the meeting').includes('meeting-notes'));
  assert.ok(!ids('explain page 3 of the pdf').includes('report'));
  assert.ok(ids('turn this into a pdf report').includes('report'));
  // A technical report only when one is asked for: never for a PDF of notes or a question about a report.
  for(const q of ['make a pdf of my lecture notes','what does the report say about friction?','summarise this lab report','create a pdf explaining lectures 1-2'])assert.ok(!ids(q).includes('report'),q);
  for(const q of ['write a technical report on friction','draft a report about our survey results','make me a white paper on solar'])assert.ok(ids(q).includes('report'),q);
  assert.ok(!ids('explain subject-verb agreement and relative clauses').includes('legal'));
  assert.ok(ids('draft an employment agreement for a freelancer').includes('legal'));
  assert.ok(ids('help me with statistics homework').includes('analysis'));
  assert.ok(!ids('show me videos on photosynthesis').includes('visual'));
  assert.ok(!ids('find the video about entropy').includes('problem-solving'));
  assert.ok(ids('find the derivative of x^2 sin x').includes('problem-solving'));
  assert.ok(!ids('revise the document with a new intro').includes('tutor'));
  assert.equal(ids('make a pdf study guide on cell biology')[0],'study-guide');
});

test('an answer in a CLI working folder gets no playbook that contradicts its Markdown-draft tool guide',()=>{
  const ids=(context:SkillContext)=>clemSkillsFor('make a pdf of lecture 3 notes and then fix the intro',{documents:true,...context}).map(s=>s.id);
  assert.ok(ids({}).includes('documents')&&ids({}).includes('revise'));
  assert.ok(!ids({cli:true}).includes('documents')&&!ids({cli:true}).includes('revise'));
  // A slash command that forces the playbook does not bring it back either.
  assert.ok(!clemSkillsFor('/pdf lecture 3',{cli:true,force:['documents']}).some(s=>s.id==='documents'));
  assert.ok(!clemSkillText('make a pdf study guide',{cli:true}).includes('one reply holds about 3–5 pages'));
});
