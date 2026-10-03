import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileTool,fileToolsGuide,findFile,readFile,searchFiles,READ_LIMIT,type LibraryFile} from '../core/file-tools.ts';

const lecture=(n:number,pages:string[])=>({name:`Lecture_0${n}.pdf`,text:pages.map((p,i)=>`\n[Lecture_0${n}.pdf, page ${i+1}]\n${p}\n`).join('')});
const files:LibraryFile[]=[
  lecture(1,['Cells are the unit of life.','Mitochondria make ATP by oxidative phosphorylation.']),
  lecture(3,['Enzymes lower activation energy.','Michaelis-Menten kinetics: v = Vmax[S]/(Km+[S]).','Competitive inhibition raises the apparent Km.']),
  {name:'src/app.ts',text:'export const answer = 42;\n'.repeat(5),kind:'folder'},
];

test('files are found by exact name, path tail, partial name or "lecture 3"',()=>{
  assert.equal(findFile(files,'Lecture_01.pdf')?.name,'Lecture_01.pdf');
  assert.equal(findFile(files,'lecture_03.PDF')?.name,'Lecture_03.pdf');
  assert.equal(findFile(files,'app.ts')?.name,'src/app.ts');
  assert.equal(findFile(files,'lecture 3')?.name,'Lecture_03.pdf');
  assert.equal(findFile(files,'Lecture'),undefined,'ambiguous names match nothing');
});

test('reading a page starts at its marker and says what comes next',()=>{
  const page=readFile(files,{file:'Lecture_03.pdf',page:2}) as any;
  assert.match(page.text,/^\[Lecture_03\.pdf, page 2\]\nMichaelis/);
  assert.equal(page.complete,'This is the end of the file.');
  assert.match((readFile(files,{file:'Lecture_03.pdf',page:9}) as any).error,/has 3 pages/);
  const whole=readFile(files,{file:'Lecture_01.pdf'}) as any;
  assert.equal(whole.complete,'This is the whole file.');
  assert.match((readFile(files,{file:'nope.pdf'}) as any).error,/No file named/);
});

test('a long file is read in parts that join up exactly',()=>{
  const big:LibraryFile={name:'big.txt',text:Array.from({length:9000},(_,i)=>`line ${i} of the long file`).join('\n')};
  let from=0,joined='',parts=0;
  for(;;){const part=readFile([big],{file:'big.txt',from}) as any;assert.ok(part.text.length<=READ_LIMIT);joined+=part.text;parts++;if(!part.next)break;from=part.next.from;}
  assert.equal(joined,big.text);assert.ok(parts>1);
});

test('search ranks the passage with the rare words and gives its page',()=>{
  const found=searchFiles(files,{query:'competitive inhibition Km'}) as any;
  assert.equal(found.results[0].file,'Lecture_03.pdf');
  assert.equal(found.results[0].page,3);
  assert.deepEqual(found.results[0].read,{action:'read',file:'Lecture_03.pdf',from:found.results[0].from});
  assert.equal((searchFiles(files,{query:'ATP',file:'Lecture_03.pdf'}) as any).results.length,0);
  assert.match((searchFiles(files,{query:'  '}) as any).error,/query/);
});

test('only file actions are handled, and the guide appears only when there are files',()=>{
  assert.equal(fileTool(files,{action:'pdf'}),undefined);
  assert.equal((fileTool(files,{action:'files'}) as any).files.length,3);
  assert.equal((fileTool(files,{action:'files'}) as any).files[1].pages,3);
  assert.equal(fileToolsGuide([]),'');
  assert.match(fileToolsGuide(files),/"action":"read"/);
});
