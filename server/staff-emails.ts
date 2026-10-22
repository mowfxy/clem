// Lets staff send one person a preset or hand-written email from the admin portal, and email support replies, on top of the emails the server and scripts send
// automatically. Staff access is checked by the account service (/admin/me), the same check every portal call gets,
// and every send is written to the portal's audit log.
import express from 'express';
import {randomUUID} from 'node:crypto';
import {db,databaseReady} from './db.ts';
import {mailReady,sendMail} from './mail.ts';
import {caseReplyEmail,staffEmail,staffPresets,type StaffPreset} from './email-layout.ts';
import {unsubscribeToken} from './emails.ts';

type Staff={id:string;email:string;role:'owner'|'admin'|'support'};
type Send=typeof sendMail;
class StaffError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}

const accountService=()=>(process.env.CLEM_ACCOUNT_SERVICE||'https://clem-accounts.mohamed-khaled011008.workers.dev').replace(/\/$/,'');

/** Replies from people land in the support inbox, not the address that sends. */
const replyTo=()=>process.env.SUPPORT_EMAIL||'support@m4labs.xyz';

async function staffFor(req:express.Request,roles:Staff['role'][]=['admin','owner']):Promise<Staff>{
  const authorization=req.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))throw new StaffError('Sign in to the admin portal first.',401);
  const r=await fetch(accountService()+'/admin/me',{headers:{Authorization:authorization},signal:AbortSignal.timeout(10000)})
    .catch(()=>{throw new StaffError('The account service could not be reached.',502);});
  const me=await r.json().catch(()=>({}));
  if(!r.ok)throw new StaffError(me.error||'This account does not have staff access.',r.status===401?401:403);
  if(!roles.includes(me.role))throw new StaffError('Sending emails needs the admin role.',403);
  return me;
}

function preset(value:unknown):StaffPreset{
  const found=staffPresets.find(p=>p.id===value);
  if(!found)throw new StaffError('Choose one of the preset emails.',400);
  return found.id;
}

function fields(body:Record<string,unknown>,kind:StaffPreset){
  if(kind==='custom'){
    const subject=String(body.subject||'').replace(/\s+/g,' ').trim(),message=String(body.message||'').replace(/\r\n/g,'\n').trim();
    if(!subject||subject.length>150)throw new StaffError('Add a subject (up to 150 characters).',400);
    if(message.length<2||message.length>10000)throw new StaffError('Write the message (up to 10,000 characters).',400);
    return {version:'',notes:'',subject,message};
  }
  if(kind!=='update')return {version:'',notes:''};
  const version=String(body.version||'').trim(),notes=String(body.notes||'').trim();
  if(!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version))throw new StaffError('Enter the version, like 0.3.0.',400);
  if(!notes||notes.length>2000)throw new StaffError('Add what changed, one change per line.',400);
  return {version,notes};
}

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A person with a Clem account (`userId`), or any address typed in (`email`), matched to an account when there is one. */
async function recipient(userId:unknown,typed?:unknown){
  if(!userId&&typeof typed==='string'){
    const email=typed.trim().toLowerCase();
    if(email.length>254||!emailPattern.test(email))throw new StaffError('Enter a valid email address.',400);
    const [row]=await db()`SELECT a.user_id,p.display_name,p.username FROM desktop_activity a LEFT JOIN desktop_profiles p ON p.user_id=a.user_id WHERE lower(a.email)=${email} LIMIT 1`;
    return {id:row?.user_id?String(row.user_id):email,email,name:String(row?.display_name||row?.username||'')};
  }
  if(typeof userId!=='string'||!/^[\w-]{3,64}$/.test(userId))throw new StaffError('Choose a person.',400);
  const [row]=await db()`SELECT a.email,p.display_name,p.username FROM desktop_activity a LEFT JOIN desktop_profiles p ON p.user_id=a.user_id WHERE a.user_id=${userId}`;
  const email=String(row?.email||'').trim().toLowerCase();
  if(!emailPattern.test(email))throw new StaffError('Clem has no email address on record for this person.',404);
  return {id:userId,email,name:String(row?.display_name||row?.username||'')};
}

const unsubscribeLink=(email:string)=>`https://clem.m4labs.xyz/api/email/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;

export function staffEmailRouter(send:Send=sendMail){
  const router=express.Router();
  const handle=(work:(req:express.Request,res:express.Response)=>Promise<void>):express.RequestHandler=>(req,res,next)=>{
    work(req,res).catch(error=>{if(error instanceof StaffError){res.status(error.status).json({error:error.message});return;}next(error);});
  };

  router.get('/presets',handle(async(req,res)=>{
    await staffFor(req);
    res.json({presets:staffPresets,ready:mailReady()&&databaseReady()});
  }));

  // Renders exactly what would be sent, so the portal can show it before anyone presses Send.
  router.post('/preview',handle(async(req,res)=>{
    await staffFor(req);
    const kind=preset(req.body?.kind);
    const person=req.body?.userId||req.body?.email?await recipient(req.body.userId,req.body.email).catch(()=>null):null;
    const extra=kind==='update'?{version:String(req.body?.version||'').trim()||'0.0.0',notes:String(req.body?.notes||'')}
      :kind==='custom'?{subject:String(req.body?.subject||'').trim()||'Subject',message:String(req.body?.message||'').trim()||'Your message appears here.'}:{};
    const mail=staffEmail(kind,{...extra,name:person?.name||'',unsubscribe:unsubscribeLink(person?.email||'you@example.com')});
    res.json({subject:mail.subject,html:mail.html,to:person?.email||null});
  }));

  router.post('/send',handle(async(req,res)=>{
    const staff=await staffFor(req);
    if(!mailReady()||!databaseReady())throw new StaffError('Email sending is not set up on this server.',503);
    const kind=preset(req.body?.kind),extra=fields(req.body||{},kind),person=await recipient(req.body?.userId,req.body?.email);
    const detail=`${kind}${extra.version?' '+extra.version:''} · ${staffEmail(kind,{...extra,name:person.name}).subject} → ${person.email}`;
    // A double click or a second tab should not send the same email twice.
    const since=new Date(Date.now()-60_000).toISOString();
    const [recent]=await db()`SELECT 1 AS hit FROM desktop_audit_log WHERE action='email.send' AND target=${person.id} AND detail=${detail} AND created_at>${since} LIMIT 1`;
    if(recent)throw new StaffError('This email was just sent to them. Wait a minute to send it again.',409);
    let headers:Record<string,string>|undefined,unsubscribe='';
    if(kind==='update'){
      const [optedOut]=await db()`SELECT 1 AS hit FROM clem_email_optout WHERE email=${person.email} AND kind='updates'`;
      if(optedOut)throw new StaffError('They turned off update emails, so this one was not sent.',409);
      unsubscribe=unsubscribeLink(person.email);
      headers={'List-Unsubscribe':`<${unsubscribe}>, <mailto:support@m4labs.xyz?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
    }
    const mail=staffEmail(kind,{...extra,name:person.name,unsubscribe});
    try{await send(person.email,mail.subject,mail.text,replyTo(),{html:mail.html,headers,from:mail.from,kind:kind==='custom'?'staff':'automated'});}
    catch(error){throw new StaffError((error as Error).message||'The mail server did not accept the email.',502);}
    const at=new Date().toISOString();
    // The automatic senders skip anyone already logged, so a hand-sent welcome or update is not repeated later.
    const logged=kind==='welcome'||kind==='welcome-m4labs'?kind:kind==='update'?'update:'+extra.version:null;
    if(logged&&person.id!==person.email)await db()`INSERT INTO clem_email_log(owner_id,kind,sent_at) VALUES(${'supabase:'+person.id},${logged},${at}) ON CONFLICT(owner_id,kind) DO NOTHING`;
    await db()`INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(${randomUUID()},${staff.id},${staff.email},'email.send',${person.id},${detail},${at})`;
    res.json({ok:true,to:person.email,subject:mail.subject});
  }));

  // Emails the newest staff reply on a support case to the person who opened it. The case, its address and the reply
  // all come from the account service under the caller's own staff session, so the portal can't aim it anywhere else.
  router.post('/case-reply',handle(async(req,res)=>{
    const staff=await staffFor(req,['support','admin','owner']);
    if(!mailReady()||!databaseReady())throw new StaffError('Email sending is not set up on this server.',503);
    const caseId=String(req.body?.caseId||'');
    if(!/^[\w-]{8,64}$/.test(caseId))throw new StaffError('Choose a case.',400);
    const r=await fetch(accountService()+'/admin/cases/'+caseId,{headers:{Authorization:req.get('authorization')!},signal:AbortSignal.timeout(10000)})
      .catch(()=>{throw new StaffError('The account service could not be reached.',502);});
    const found=await r.json().catch(()=>({}));
    if(!r.ok)throw new StaffError(found.error||'Case not found.',r.status===404?404:502);
    const c=found.case||{},email=String(c.email||'').trim().toLowerCase();
    if(!emailPattern.test(email))throw new StaffError('Clem has no email address on record for this person.',404);
    const reply=[...(found.messages||[])].reverse().find((m:{author:string})=>m.author==='staff');
    if(!reply)throw new StaffError('Send a reply first.',400);
    const key=`case-reply ${reply.id} · `;
    const [already]=await db()`SELECT 1 AS hit FROM desktop_audit_log WHERE action='email.send' AND detail LIKE ${key+'%'} LIMIT 1`;
    if(already)throw new StaffError('This reply was already emailed.',409);
    const mail=caseReplyEmail(String(c.subject||'Your support request'),String(reply.body),String(c.display_name||c.username||''));
    try{await send(email,mail.subject,mail.text,replyTo(),{html:mail.html,kind:'case',caseId});}
    catch(error){throw new StaffError((error as Error).message||'The mail server did not accept the email.',502);}
    await db()`INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(${randomUUID()},${staff.id},${staff.email},'email.send',${String(c.owner_id||email)},${`${key}${mail.subject} → ${email}`},${new Date().toISOString()})`;
    res.json({ok:true,to:email,subject:mail.subject});
  }));

  return router;
}
