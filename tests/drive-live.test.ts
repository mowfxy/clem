import {test} from 'node:test';
import assert from 'node:assert/strict';
import {driveIntent,driveTerms,driveQuery,viewFormat,driveContext,linkedDriveIds} from '../core/drive-search.ts';
import {DriveLive} from '../desktop/drive-live.ts';

test('Drive questions are recognised and turned into a Drive search',()=>{
  assert.equal(driveIntent('Which file in my drive explains partial derivatives?'),true);
  assert.equal(driveIntent('My hard drive is full'),false);
  assert.deepEqual(driveTerms('Which file in my Google Drive explains partial derivatives?'),['partial','derivatives']);
  const q=driveQuery("find the lecture video about o'neil chain rule in my drive");
  assert.match(q,/fullText contains 'lecture'/);assert.match(q,/name contains 'o\\'neil'/);assert.match(q,/mimeType contains 'video\/'/);
  assert.equal(viewFormat('application/vnd.google-apps.document').export,'application/pdf');
  assert.equal(viewFormat('application/pdf').export,undefined);
  assert.deepEqual(linkedDriveIds('See [Notes](drive:1AbCdEfGhIjK) and [Talk](drive:9ZyXwVuTsRqP), [Notes](drive:1AbCdEfGhIjK)'),['1AbCdEfGhIjK','9ZyXwVuTsRqP']);
  assert.match(driveContext([{id:'1AbCdEfGhIjK',name:'Chain rule.pdf',mimeType:'application/pdf'}],'q'),/\[File name\]\(drive:ID\)[\s\S]*id=1AbCdEfGhIjK · Chain rule\.pdf/);
});

// A fake of mowrai.com's token endpoint and Google's Drive API.
function fakeGoogle(opts:{connected?:boolean}={}){
  const calls:{url:string;headers:Record<string,string>}[]=[];
  const fetcher=(async(input:any,init:any={})=>{
    const url=String(input),headers=Object.fromEntries(Object.entries(init.headers||{})) as Record<string,string>;calls.push({url,headers});
    if(url.endsWith('/api/drive/token'))return opts.connected===false?Response.json({error:'Connect Google Drive first.'},{status:400}):Response.json({accessToken:'tok',expiresIn:3300});
    assert.equal(headers.Authorization,'Bearer tok');
    const u=new URL(url);
    if(u.pathname==='/drive/v3/files')return Response.json({files:[{id:'doc1234567890',name:'Chain rule notes',mimeType:'application/vnd.google-apps.document',modifiedTime:'2026-09-01T00:00:00Z'},{id:'vid1234567890',name:'Lecture 4.mp4',mimeType:'video/mp4',size:'900000000',videoMediaMetadata:{durationMillis:'3600000'}}]});
    if(u.pathname==='/drive/v3/files/doc1234567890/export')return new Response(u.searchParams.get('mimeType')==='text/plain'?'The chain rule for partial derivatives says…':'%PDF-1.7',{headers:{'Content-Type':'text/plain'}});
    if(u.pathname==='/drive/v3/files/vid1234567890'&&u.searchParams.get('alt')==='media')return new Response('part',{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 100-103/900000000','Content-Length':'4'}});
    return new Response('nope',{status:404});
  }) as typeof fetch;
  return {calls,drive:new DriveLive(async()=>'session',fetcher,'https://mowrai.example')};
}

test('search returns matches with an excerpt of the best text match',async()=>{
  const {drive}=fakeGoogle();
  const out=await drive.search('which file in my drive explains the chain rule?');
  assert.equal(out.connected,true);
  assert.deepEqual(out.files.map(f=>[f.id,f.durationMs]),[['doc1234567890',undefined],['vid1234567890',3600000]]);
  assert.match(out.files[0].excerpt!,/chain rule for partial derivatives/);
});
test('not connected is reported, not thrown',async()=>{
  const {drive}=fakeGoogle({connected:false});
  assert.deepEqual(await drive.search('my drive notes'),{connected:false,files:[]});
});
test('videos stream with byte ranges; Google Docs stream as PDF',async()=>{
  const {drive,calls}=fakeGoogle();
  await drive.search('drive lecture');
  const video=await drive.media('vid1234567890','bytes=100-103');
  assert.equal(video.status,206);assert.equal(video.headers.get('Content-Range'),'bytes 100-103/900000000');assert.equal(video.headers.get('Accept-Ranges'),'bytes');
  assert.equal(calls.find(c=>c.url.includes('vid1234567890?alt=media'))!.headers.Range,'bytes=100-103');
  const doc=await drive.media('doc1234567890',null);
  assert.equal(doc.headers.get('Content-Type'),'application/pdf');assert.equal(decodeURIComponent(doc.headers.get('X-Mowr-File-Name')!),'Chain rule notes.pdf');
  assert.equal(await doc.text(),'%PDF-1.7');
});

// Folders and subfolders, the way Drive's API answers `'id' in parents` queries.
function fakeTree(){
  const files:Record<string,any[]>={
    rootFolder123:[{id:'sub1234567890',name:'Week 1',mimeType:'application/vnd.google-apps.folder',parents:['rootFolder123']},{id:'pdf1234567890',name:'Syllabus.pdf',mimeType:'application/pdf',parents:['rootFolder123'],modifiedTime:'2026-09-01T00:00:00Z'}],
    sub1234567890:[{id:'vid1234567890',name:'Enzymes lecture.mp4',mimeType:'video/mp4',parents:['sub1234567890'],thumbnailLink:'https://thumb/x=s220'}],
  };
  const fetcher=(async(input:any)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/api/drive/token'))return Response.json({accessToken:'tok',expiresIn:3300});
    const q=url.searchParams.get('q')||'';
    if(/fullText/.test(q))return Response.json({files:[{id:'vid1234567890'}]});
    const parents=[...q.matchAll(/'([\w-]+)' in parents/g)].map(m=>m[1]);
    return Response.json({files:parents.flatMap(p=>files[p]||[])});
  }) as typeof fetch;
  return new DriveLive(async()=>'session',fetcher,'https://mowrai.example');
}
test('a linked folder is read live with its subfolders, and questions find the right files',async()=>{
  const drive=fakeTree();
  const list=await drive.list({folder:'rootFolder123'});
  assert.deepEqual(list.files.map(f=>[f.name,!!f.folder]),[['Week 1',true],['Syllabus.pdf',false]]);
  const found=await drive.folder('rootFolder123','the enzymes lecture');
  assert.deepEqual(found.items.find(i=>i.id==='vid1234567890')?.path,'Week 1');
  assert.equal(found.hits[0].id,'vid1234567890');
  assert.equal(found.items.find(i=>i.id==='vid1234567890')?.thumbnail,true);
});
test('the connection state survives a network hiccup instead of asking to reconnect',async()=>{
  let fail=false;
  const drive=new DriveLive(async()=>'session',(async()=>{if(fail)throw Error('offline');return Response.json({accessToken:'tok',expiresIn:3300});}) as any,'https://mowrai.example');
  assert.deepEqual(await drive.state(),{connected:true,checked:true});
  fail=true;
  const later=await drive.state(true);
  assert.equal(later.connected,true);assert.ok(later.error);
});
test('Drive video streams through a private local server with byte ranges',async()=>{
  const {DriveMediaServer,playableType}=await import('../desktop/drive-live.ts');
  const {drive}=fakeGoogle();
  await drive.search('drive lecture');
  const server=new DriveMediaServer(drive,async()=>true);
  try{
    const url=await server.url('vid1234567890');
    assert.match(url,/^http:\/\/127\.0\.0\.1:\d+\/drive\/vid1234567890\?k=[a-f0-9]{48}$/);
    const r=await fetch(url,{headers:{Range:'bytes=100-103'}});
    assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 100-103/900000000');assert.equal(await r.text(),'part');
    assert.equal((await fetch(url.replace(/k=\w+/,'k=wrong'))).status,404);
  }finally{server.stop();}
  assert.equal(playableType('application/octet-stream','clip.mov'),'video/mp4');
  assert.equal(playableType('video/webm','x.webm'),'video/webm');
});
