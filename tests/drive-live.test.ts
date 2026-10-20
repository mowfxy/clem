import {test} from 'node:test';
import assert from 'node:assert/strict';
import {driveIntent,driveTerms,driveQuery,viewFormat,driveContext,linkedDriveIds} from '../core/drive-search.ts';
import {DriveLive,uploadType} from '../desktop/drive-live.ts';

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

// The fake 900 MB video's bytes: byte n is n % 251, so any range can be checked.
const pattern=(a:number,b:number)=>Uint8Array.from({length:b-a+1},(_,i)=>(a+i)%251);
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
    if(u.pathname==='/drive/v3/files/vid1234567890'&&u.searchParams.get('alt')==='media'){const [,a,b]=/bytes=(\d+)-(\d+)/.exec(headers.Range)!;return new Response(pattern(Number(a),Number(b)),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':`bytes ${a}-${b}/900000000`,'Content-Length':String(Number(b)-Number(a)+1)}});}
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
    assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 100-103/900000000');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),pattern(100,103));
    // A range across block boundaries, far into the file, comes back byte for byte.
    const far=await fetch(url,{headers:{Range:'bytes=500000000-503000000'}});
    assert.equal(far.headers.get('content-length'),'3000001');assert.deepEqual(new Uint8Array(await far.arrayBuffer()),pattern(500000000,503000000));
    assert.equal((await fetch(url.replace(/k=\w+/,'k=wrong'))).status,404);
  }finally{server.stop();}
  assert.equal(playableType('application/octet-stream','clip.mov'),'video/mp4');
  assert.equal(playableType('video/webm','x.webm'),'video/webm');
});
test('Drive shortcuts open what they point to: a shortcut to a folder is a folder',async()=>{
  const S='application/vnd.google-apps.shortcut',F='application/vnd.google-apps.folder';
  const files:Record<string,any[]>={root:[{id:'short1234567',name:'Physics',mimeType:S,shortcutDetails:{targetId:'target123456',targetMimeType:F},parents:['root']},{id:'short7654321',name:'Notes link',mimeType:S,shortcutDetails:{targetId:'doc987654321',targetMimeType:'application/pdf'},parents:['root']}],
    target123456:[{id:'inner1234567',name:'Week 1.pdf',mimeType:'application/pdf',parents:['target123456']}]};
  const drive=new DriveLive(async()=>'s',(async(input:any)=>{const url=new URL(String(input));if(url.pathname.endsWith('/token'))return Response.json({accessToken:'t',expiresIn:3300});const q=url.searchParams.get('q')||'';return Response.json({files:[...q.matchAll(/'([\w-]+)' in parents/g)].flatMap(m=>files[m[1]]||[])});}) as any,'https://x.example');
  const list=await drive.list({folder:'root'});
  assert.deepEqual(list.files.map(f=>[f.id,f.name,!!f.folder]),[['target123456','Physics',true],['doc987654321','Notes link',false]]);
  const tree=await drive.tree('root');
  assert.equal(tree.items.find(i=>i.id==='inner1234567')?.path,'Physics','files inside a shortcut folder are reached');
});
test('an MP4 written as many small mdat boxes is served as one, so Chromium starts it without walking the file',async()=>{
  const {DriveMediaServer}=await import('../desktop/drive-live.ts');
  const box=(type:string,body:Uint8Array)=>{const b=new Uint8Array(8+body.length);new DataView(b.buffer).setUint32(0,b.length);b.set(new TextEncoder().encode(type),4);b.set(body,8);return b;};
  const join=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
  const video=(fragmented:boolean)=>join(box('ftyp',new Uint8Array(8)),box('moov',join(box('mvhd',new Uint8Array(100)),...(fragmented?[box('mvex',new Uint8Array(0))]:[]))),box('mdat',new Uint8Array(3000).fill(7)),box('mdat',new Uint8Array(2_000_000).fill(9)));
  const files:Record<string,Uint8Array>={many12345678:video(false),frag12345678:video(true)};
  const drive=new DriveLive(async()=>'s',(async(input:any,init:any={})=>{const u=new URL(String(input));if(u.pathname.endsWith('/token'))return Response.json({accessToken:'t',expiresIn:3300});const id=u.pathname.split('/').pop()!,f=files[id];
    if(u.searchParams.get('alt')!=='media')return Response.json({id,name:id+'.mp4',mimeType:'video/mp4',size:String(f.length)});
    const [,a,b]=/bytes=(\d+)-(\d+)/.exec(init.headers.Range)!;return new Response(f.slice(Number(a),Number(b)+1),{status:206});}) as any,'https://x.example');
  const server=new DriveMediaServer(drive,async()=>true);
  try{
    const mdat=16+8+108,size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,files.many12345678.length-mdat);
    const plain=new Uint8Array(await (await fetch(await server.url('many12345678'))).arrayBuffer());
    assert.deepEqual(plain.subarray(mdat,mdat+4),size,'the first mdat runs to the end of the file');
    assert.deepEqual(plain.subarray(mdat+4),files.many12345678.subarray(mdat+4),'every other byte is unchanged');
    const part=new Uint8Array(await (await fetch(await server.url('many12345678'),{headers:{Range:`bytes=${mdat+2}-${mdat+9}`}})).arrayBuffer());
    assert.deepEqual(part,Uint8Array.from([...size.subarray(2),...files.many12345678.subarray(mdat+4,mdat+10)]),'a range starting inside the header gets the rewritten bytes too');
    const frag=new Uint8Array(await (await fetch(await server.url('frag12345678'))).arrayBuffer());
    assert.deepEqual(frag,files.frag12345678,'fragmented MP4s are served untouched');
  }finally{server.stop();}
});

test('saving into a folder asks for a reconnect under the old read-only scope, and goes through once Drive is fully granted',async()=>{
  let scope='https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file',created=0;
  const drive=new DriveLive(async()=>'s',(async(input:any)=>{const url=String(input);
    if(url.endsWith('/api/drive/token'))return Response.json({accessToken:'t',expiresIn:3300,scope});
    if(url.includes('uploadType=resumable'))return new Response('{}',{headers:{Location:'https://upload.example/session'}});
    created++;return Response.json({id:'new-file-id-123'});}) as any,'https://x.example');
  await assert.rejects(drive.upload('folder-id-12345','a.txt','text/plain',new Uint8Array([1])),/Reconnect Google Drive/);
  assert.equal(created,0);
  scope='https://www.googleapis.com/auth/drive';
  assert.deepEqual(await drive.upload('folder-id-12345','a.txt','text/plain',new Uint8Array([1])),{id:'new-file-id-123'});
});

test('a file renamed or moved to the trash from Mowr is changed in Drive itself, in place',async()=>{
  const calls:{url:string;method?:string;body?:string}[]=[];
  const drive=new DriveLive(async()=>'s',(async(input:any,init:any={})=>{const url=String(input);
    if(url.endsWith('/api/drive/token'))return Response.json({accessToken:'t',expiresIn:3300,scope:'https://www.googleapis.com/auth/drive'});
    calls.push({url,method:init.method,body:init.body});
    return Response.json({id:'file-id-12345',name:JSON.parse(init.body||'{}').name,modifiedTime:'2026-10-05T10:00:00Z'});}) as any,'https://x.example');
  assert.deepEqual(await drive.rename('file-id-12345','Week 2.pdf'),{id:'file-id-12345',name:'Week 2.pdf',modifiedTime:'2026-10-05T10:00:00Z'});
  assert.deepEqual(await drive.trash('file-id-12345'),{ok:true});
  assert.deepEqual(calls.map(c=>[c.method,new URL(c.url).pathname,JSON.parse(c.body!)]),[['PATCH','/drive/v3/files/file-id-12345',{name:'Week 2.pdf'}],['PATCH','/drive/v3/files/file-id-12345',{trashed:true}]]);
});

test('a saved file reports Drive’s modified time, so Mowr knows its own upload is not a change made in Drive',async()=>{
  const drive=new DriveLive(async()=>'s',(async(input:any)=>{const url=String(input);
    if(url.endsWith('/api/drive/token'))return Response.json({accessToken:'t',expiresIn:3300,scope:'https://www.googleapis.com/auth/drive'});
    if(url.includes('uploadType=resumable')){assert.match(url,/fields=id,modifiedTime/);return new Response('{}',{headers:{Location:'https://upload.example/session'}});}
    return Response.json({id:'new-file-id-123',modifiedTime:'2026-10-05T10:00:00Z'});}) as any,'https://x.example');
  assert.deepEqual(await drive.upload('folder-id-12345','a.txt','text/plain',new Uint8Array([1])),{id:'new-file-id-123',modifiedTime:'2026-10-05T10:00:00Z'});
  assert.deepEqual(await drive.update('new-file-id-123','text/plain',new Uint8Array([2])),{id:'new-file-id-123',modifiedTime:'2026-10-05T10:00:00Z'});
});

test('a file goes to Drive under the type its bytes and name show, so a PDF kept without a type is not shown as raw text',async()=>{
  const pdf=new TextEncoder().encode('%PDF-1.7 rest');
  assert.equal(uploadType('','Notes.pdf',pdf),'application/pdf');
  assert.equal(uploadType('text/plain','Notes.pdf',pdf),'application/pdf');
  assert.equal(uploadType('application/octet-stream','Deck.pptx',new Uint8Array([0x50,0x4b,3,4])),'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(uploadType('text/markdown','a.md',new TextEncoder().encode('# Hi')),'text/markdown');
  let sent='',meta:any;
  const drive=new DriveLive(async()=>'s',(async(input:any,init:any={})=>{const url=String(input);
    if(url.endsWith('/api/drive/token'))return Response.json({accessToken:'t',expiresIn:3300,scope:'https://www.googleapis.com/auth/drive'});
    if(url.includes('uploadType=resumable')){sent=init.headers['X-Upload-Content-Type'];meta=JSON.parse(init.body);return new Response('{}',{headers:{Location:'https://upload.example/session'}});}
    return Response.json({id:'new-file-id-123'});}) as any,'https://x.example');
  await drive.upload('folder-id-12345','Notes.pdf','',pdf);
  assert.equal(sent,'application/pdf');assert.equal(meta.mimeType,'application/pdf');
});

test('a dropped connection or a busy Google is tried again, and many requests share one token request',async()=>{
  let tokens=0,lists=0;
  const fetcher=(async(input:any)=>{
    const url=String(input);
    if(url.endsWith('/api/drive/token')){tokens++;await new Promise(r=>setTimeout(r,20));return Response.json({accessToken:'tok',expiresIn:3300});}
    lists++;
    if(lists===1)throw new TypeError('fetch failed');
    if(lists===2)return new Response('{}',{status:503});
    return Response.json({files:[{id:'doc1234567890',name:'Notes',mimeType:'text/plain'}]});
  }) as typeof fetch;
  const drive=new DriveLive(async()=>'session',fetcher,'https://mowrai.example');
  const [a,b]=await Promise.all([drive.list({folder:'root'}),drive.list({folder:'root'})]);
  assert.equal(tokens,1);
  assert.deepEqual([a.files.length,b.files.length],[1,1]);
  // Never reaching Google ends in a plain message, not "fetch failed".
  const offline=new DriveLive(async()=>'session',(async(input:any)=>{if(String(input).endsWith('/api/drive/token'))return Response.json({accessToken:'tok',expiresIn:3300});throw new TypeError('fetch failed');}) as typeof fetch,'https://mowrai.example');
  await assert.rejects(offline.list({folder:'root'}),/couldn't reach Google Drive/);
});
test('a linked folder listing answers from what it has and is read again beside it',async()=>{
  let lists=0;
  const fetcher=(async(input:any)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith('/api/drive/token'))return Response.json({accessToken:'tok',expiresIn:3300});
    if(/in parents/.test(url.searchParams.get('q')||'')&&!/fullText/.test(url.searchParams.get('q')||''))lists++;
    return Response.json({files:[]});
  }) as typeof fetch;
  const drive=new DriveLive(async()=>'session',fetcher,'https://mowrai.example');
  const first=await drive.tree('rootFolder123');
  (first as {at:number}).at-=5*60_000;
  const again=await drive.tree('rootFolder123');
  assert.equal(again,first);
  await new Promise((done)=>setTimeout(done,10));
  assert.equal(lists,2);
  assert.notEqual(await drive.tree('rootFolder123'),first);
});
