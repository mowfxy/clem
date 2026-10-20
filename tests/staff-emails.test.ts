import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {AddressInfo} from 'node:net';

// Fake account service, D1 and mail server: nothing here reaches a real inbox or database.
Object.assign(process.env,{CLEM_ACCOUNT_SERVICE:'https://accounts.test',CLOUDFLARE_DATABASE_URL:'https://d1.test',CLOUDFLARE_DATABASE_SECRET:'x',SESSION_SECRET:'secret',
  SMTP_HOST:'smtp.test',SMTP_PORT:'465',SMTP_USER:'u',SMTP_PASSWORD:'p',SMTP_FROM:'Clem <hello@m4labs.xyz>'});
const {staffEmailRouter}=await import('../server/staff-emails.ts');

const roles:Record<string,string>={'Bearer admin':'admin','Bearer owner':'owner','Bearer support':'support'};
let queries:{sql:string;params:unknown[]}[]=[];
let optedOut=false,recent=false;
const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url==='https://accounts.test/admin/me'){
    const role=roles[new Headers(init?.headers).get('authorization')||''];
    return role?Response.json({id:'staff-1',email:'staff@m4labs.xyz',role}):Response.json({error:'This account does not have staff access.'},{status:403});
  }
  if(url==='https://accounts.test/admin/cases/case-7f1a2b3c'){
    if(!roles[new Headers(init?.headers).get('authorization')||''])return Response.json({error:'Staff only.'},{status:403});
    return Response.json({case:{id:'case-7f1a2b3c',owner_id:user,subject:'PPTX export shows odd symbols',email:'Ava@Studio.co',display_name:'Ava Laurent'},
      messages:[{id:'m1',author:'staff',body:'Old reply'},{id:'m2',author:'note',body:'Internal only'},{id:'m3',author:'staff',body:'Fixed in the latest version.'}]});
  }
  if(url==='https://d1.test'){
    const {queries:batch}=JSON.parse(String(init!.body));
    queries.push(...batch);
    const results=batch.map(({sql}:{sql:string})=>{
      if(sql.includes('lower(a.email)'))return {results:[]};
      if(sql.includes('FROM desktop_activity'))return {results:[{email:'Ava@Studio.co',display_name:'Ava Laurent',username:'ava'}]};
      if(sql.includes('FROM clem_email_optout'))return {results:optedOut?[{hit:1}]:[]};
      if(sql.includes('FROM desktop_audit_log'))return {results:recent?[{hit:1}]:[]};
      return {results:[]};
    });
    return Response.json({results});
  }
  return realFetch(input,init);
}) as typeof fetch;

const outbox:{to:string;subject:string;text:string;extra:{html?:string;headers?:Record<string,string>}}[]=[];
const app=express();app.use(express.json());
app.use('/api/email/staff',staffEmailRouter(async(to,subject,text,_reply,extra={})=>{outbox.push({to,subject,text,extra});return {status:'submitted' as const,messageId:'m1'};}));
const server=app.listen(0);
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/email/staff`;
test.after(()=>{server.close();globalThis.fetch=realFetch;});
test.beforeEach(()=>{queries=[];outbox.length=0;optedOut=false;recent=false;});

const call=(path:string,body?:unknown,token='admin')=>realFetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
const user='0b6a4c1e-1111-4222-8333-444455556666';

test('only admins and owners can use preset emails',async()=>{
  assert.equal((await call('/presets',undefined,'')).status,401);
  assert.equal((await call('/presets',undefined,'nobody')).status,403);
  const support=await call('/send',{kind:'welcome',userId:user},'support');
  assert.equal(support.status,403);
  assert.match((await support.json()).error,/admin role/);
  const ok=await call('/presets',undefined,'owner');
  assert.equal(ok.status,200);
  const body=await ok.json();
  assert.deepEqual(body.presets.map((p:{id:string})=>p.id),['custom','welcome','update','automation-complete','automation-failed','support-received']);
  assert.equal(outbox.length,0);
});

test('sends a welcome email to the person and records it',async()=>{
  const r=await call('/send',{kind:'welcome',userId:user});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,to:'ava@studio.co',subject:'Welcome to Clem'});
  assert.equal(outbox.length,1);
  assert.equal(outbox[0].to,'ava@studio.co');
  assert.match(outbox[0].extra.html!,/Welcome to Clem, Ava/);
  // Marks the automatic welcome as done, so it never arrives a second time.
  const log=queries.find(q=>q.sql.startsWith('INSERT INTO clem_email_log'))!;
  assert.deepEqual(log.params.slice(0,2),['supabase:'+user,'welcome']);
  const audit=queries.find(q=>q.sql.startsWith('INSERT INTO desktop_audit_log'))!;
  assert.equal(audit.params[1],'staff-1');
  assert.equal(audit.params[3],user);
  assert.match(String(audit.params[4]),/^welcome · Welcome to Clem → ava@studio\.co$/);
});

test('update emails need a version and notes, carry an unsubscribe link and respect opt-outs',async()=>{
  assert.equal((await call('/send',{kind:'update',userId:user,version:'soon',notes:'x'})).status,400);
  assert.equal((await call('/send',{kind:'update',userId:user,version:'0.3.0',notes:''})).status,400);
  optedOut=true;
  const blocked=await call('/send',{kind:'update',userId:user,version:'0.3.0',notes:'Faster search'});
  assert.equal(blocked.status,409);
  assert.equal(outbox.length,0);
  optedOut=false;
  const r=await call('/send',{kind:'update',userId:user,version:'0.3.0-preview.34',notes:'Faster search\nNew fonts'});
  assert.equal(r.status,200);
  assert.equal(outbox[0].subject,'Clem 0.3.0-preview.34 is here');
  assert.match(outbox[0].extra.headers!['List-Unsubscribe'],/api\/email\/unsubscribe\?e=ava%40studio\.co&t=/);
  assert.match(outbox[0].text,/- Faster search\n- New fonts/);
  const log=queries.find(q=>q.sql.startsWith('INSERT INTO clem_email_log'))!;
  assert.equal(log.params[1],'update:0.3.0-preview.34');
});

test('notices send as is and are not logged as automatic emails',async()=>{
  const r=await call('/send',{kind:'automation-complete',userId:user});
  assert.equal(r.status,200);
  assert.equal(outbox[0].subject,'Your routine is ready');
  assert.ok(!queries.some(q=>q.sql.startsWith('INSERT INTO clem_email_log')));
});

test('rejects unknown presets, bad ids and a repeat within a minute',async()=>{
  assert.equal((await call('/send',{kind:'password-changed',userId:user})).status,400);
  assert.equal((await call('/send',{kind:'welcome',userId:'../x'})).status,400);
  recent=true;
  assert.equal((await call('/send',{kind:'welcome',userId:user})).status,409);
  assert.equal(outbox.length,0);
});

test('preview renders the email without sending it',async()=>{
  const r=await call('/preview',{kind:'support-received',userId:user});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.subject,'We got your message');
  assert.equal(body.to,'ava@studio.co');
  assert.match(body.html,/^<!doctype html>/);
  assert.equal(outbox.length,0);
  assert.ok(!queries.some(q=>q.sql.startsWith('INSERT')));
});

test('a hand-written email needs a subject and message, and replies go to support',async()=>{
  assert.equal((await call('/send',{kind:'custom',userId:user,subject:'',message:'Hello'})).status,400);
  assert.equal((await call('/send',{kind:'custom',userId:user,subject:'Hi',message:''})).status,400);
  const r=await call('/send',{kind:'custom',userId:user,subject:'Your <files>',message:'Line one\nLine two'});
  assert.equal(r.status,200);
  assert.equal(outbox[0].subject,'Your <files>');
  assert.match(outbox[0].text,/^Hi Ava,\n\nLine one\nLine two/);
  assert.match(outbox[0].extra.html!,/Your &lt;files&gt;/);
  assert.ok(!outbox[0].extra.html!.includes('<files>'));
  assert.ok(!queries.some(q=>q.sql.startsWith('INSERT INTO clem_email_log')));
});

test('sends to a typed address that has no account',async()=>{
  assert.equal((await call('/send',{kind:'custom',email:'not an email',subject:'Hi',message:'Hello'})).status,400);
  const r=await call('/send',{kind:'custom',email:' Client@Example.com ',subject:'Your order',message:'Thanks!'});
  assert.equal(r.status,200);
  assert.equal(outbox[0].to,'client@example.com');
  assert.match(outbox[0].text,/^Thanks!/);
  const audit=queries.find(q=>q.sql.startsWith('INSERT INTO desktop_audit_log'))!;
  assert.equal(audit.params[3],'client@example.com');
});

test('emails the newest staff reply on a case, once, for any staff role',async()=>{
  assert.equal((await call('/case-reply',{caseId:'case-7f1a2b3c'},'nobody')).status,403);
  const r=await call('/case-reply',{caseId:'case-7f1a2b3c'},'support');
  assert.equal(r.status,200);
  assert.equal(outbox.length,1);
  assert.equal(outbox[0].to,'ava@studio.co');
  assert.equal(outbox[0].subject,'Re: PPTX export shows odd symbols');
  assert.match(outbox[0].text,/^Hi Ava,\n\nFixed in the latest version\./);
  assert.ok(!outbox[0].text.includes('Internal only'));
  recent=true;
  assert.equal((await call('/case-reply',{caseId:'case-7f1a2b3c'},'support')).status,409);
  assert.equal(outbox.length,1);
});
