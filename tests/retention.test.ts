import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../server/retention.ts';
import {mailHeaders} from '../server/mail.ts';

const now=Date.parse('2026-10-22T08:00:00Z'),cutoff=new Date(now-21*86_400_000);
const old=new Date(now-30*86_400_000),fresh=new Date(now-3*86_400_000);
const head=(h:Record<string,string>)=>Object.entries(h).map(([k,v])=>`${k}: ${v}`).join('\r\n');
const none=new Set<string>();

test('automated mail in Sent goes after 21 days, not before', ()=>{
  const headers=head(mailHeaders('automated'));
  assert.equal(classify({headers,subject:'Welcome to Clem',date:old},true,none,cutoff),'automated');
  assert.equal(classify({headers,subject:'Welcome to Clem',date:fresh},true,none,cutoff),null);
});

test('Supabase mail is recognised by subject, hand-written mail stays', ()=>{
  assert.equal(classify({headers:'',subject:'Reset your password',date:old},true,none,cutoff),'automated');
  assert.equal(classify({headers:'',subject:'Clem 0.3.1 is available',date:old},true,none,cutoff),'automated');
  assert.equal(classify({headers:'',subject:'Quick question about your invoice',date:old},true,none,cutoff),null);
  assert.equal(classify({headers:head(mailHeaders('staff')),subject:'Reset your password',date:old},true,none,cutoff),null);
});

test('a case’s mail stays until the case has been closed long enough, then goes from every folder', ()=>{
  const id='3f1c2b9a-0000-4000-8000-000000000001',closed=new Set([id]);
  const notification={headers:head(mailHeaders('case',id)),subject:'[Contact support] Drive',date:fresh};
  const reply={headers:`References: <case.${id}.abc@m4labs.xyz>`,subject:'Re: Drive',from:'sam@example.com',date:fresh};
  assert.equal(classify(notification,true,none,cutoff),null);
  assert.equal(classify({...notification,date:old},true,none,cutoff),null,'open case mail is never automated');
  assert.equal(classify(notification,true,closed,cutoff),'case');
  assert.equal(classify(reply,false,closed,cutoff),'case');
  assert.equal(classify(reply,false,none,cutoff),null);
});

test('only bounces are cleared from the inbox by age', ()=>{
  assert.equal(classify({headers:'',subject:'Undelivered Mail',from:'mailer-daemon@zoho.com',date:old},false,none,cutoff),'automated');
  assert.equal(classify({headers:'',subject:'Welcome to Clem',from:'sam@example.com',date:old},false,none,cutoff),null);
});
