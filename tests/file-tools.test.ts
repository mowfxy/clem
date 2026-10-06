import {test} from 'node:test';
import assert from 'node:assert/strict';
import {distinctNames,fileTool,fileToolsGuide,findFile,readFile,relevantPages,searchFiles,READ_LIMIT,type LibraryFile} from '../core/file-tools.ts';

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

test('only file actions are handled; the guide always offers finding other files, and the file tools only with files',()=>{
  assert.equal(fileTool(files,{action:'pdf'}),undefined);
  assert.equal((fileTool(files,{action:'files'}) as any).files.length,3);
  assert.equal((fileTool(files,{action:'files'}) as any).files[1].pages,3);
  assert.match(fileToolsGuide([]),/"action":"find"/);
  assert.doesNotMatch(fileToolsGuide([]),/"action":"read"/);
  assert.match(fileToolsGuide(files),/"action":"attach"/);
  assert.match(fileToolsGuide(files),/"action":"read"/);
});

test('page markers work for names with brackets, and quoted marker text in a page is not a page',()=>{
  const odd:LibraryFile={name:'Notes [final].pdf',text:'\n[Notes [final].pdf, page 1]\nSee the note ", page 2]\n" above.\n\n[Notes [final].pdf, page 2]\nSecond page about enzymes.\n'};
  assert.equal((fileTool([odd],{action:'files'}) as any).files[0].pages,2);
  assert.match((readFile([odd],{file:'Notes [final].pdf',page:2}) as any).text,/^\[Notes \[final\]\.pdf, page 2\]\nSecond page/);
  assert.equal((searchFiles([odd],{query:'enzymes'}) as any).results[0].page,2);
});

test('same-named files are both readable, and search offsets survive letters whose lower case is longer',()=>{
  const twins=distinctNames<LibraryFile>([{name:'notes.pdf',text:'first copy'},{name:'Notes.pdf',text:'second copy'},{name:'other.txt',text:'x'}]);
  assert.deepEqual(twins.map(f=>f.name),['notes.pdf','Notes.pdf (2)','other.txt']);
  assert.equal((readFile(twins,{file:'Notes.pdf (2)'}) as any).text,'second copy');
  const turkish:LibraryFile={name:'tr.txt',text:'İİİİ '.repeat(400)+'mitochondria power'};
  const hit=(searchFiles([turkish],{query:'mitochondria'}) as any).results[0];
  assert.ok(turkish.text.slice(hit.from).includes('mitochondria'));
  assert.equal(hit.text,turkish.text.slice(hit.from,hit.from+1400));
});

test('a citation of "notes.pdf (2)" opens the second file of that name',async()=>{
  const {matchSource}=await import('../core/citations.ts');
  const stored=[{id:'a',name:'notes.pdf'},{id:'b',name:'notes.pdf'}];
  assert.equal(matchSource(stored,'notes.pdf (2)')?.id,'b');
  assert.equal(matchSource(stored,'notes.pdf')?.id,'a');
  assert.equal(matchSource([{id:'c',name:'Report (2)'}],'Report (2)')?.id,'c','a real name ending in (2) still matches itself');
});

test('a long PDF is seen by the pages a question is about, rarer words first',()=>{
  const book=lecture(9,Array.from({length:300},(_,i)=>i===141?'The Thevenin equivalent of a circuit: open-circuit voltage and Thevenin resistance.':i===220?'Norton and Thevenin are related by source transformation.':`Chapter text about circuits on page ${i+1}.`));
  const pages=relevantPages(book.text,'Explain the Thevenin equivalent of this circuit',4);
  assert.equal(pages[0],142);
  assert.ok(pages.includes(221));
  // Words on every page say nothing about where to look.
  assert.deepEqual(relevantPages(book.text,'explain the circuits please',4).length<=4,true);
  assert.deepEqual(relevantPages(book.text,'the and for',4),[]);
  assert.deepEqual(relevantPages('no page markers here','Thevenin',4),[]);
});
