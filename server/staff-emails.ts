// Lets staff send one person a preset email from the admin portal, on top of the emails the server and scripts send
// automatically. Staff access is checked by the account service (/admin/me), the same check every portal call gets,
// and every send is written to the portal's audit log.
import express from 'express';
import {randomUUID} from 'node:crypto';
import {db,databaseReady} from './db.ts';
import {mailReady,sendMail} from './mail.ts';
import {staffEmail,staffPresets,type StaffPreset} from './email-layout.ts';
import {unsubscribeToken} from './emails.ts';

type Staff={id:string;email:string;role:'owner'|'admin'|'support'};
type Send=typeof sendMail;
class StaffError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}

const accountService=()=>(process.env.MOWR_ACCOUNT_SERVICE||'https://mowr-accounts.mohamed-khaled011008.workers.dev').replace(/\/$/,'');

async function staffFor(req:express.Request):Promise<Staff>{
  const authorization=req.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))throw new StaffError('Sign in to the admin portal first.',401);
  const r=await fetch(accountService()+'/admin/me',{headers:{Authorization:authorization},signal:AbortSignal.timeout(10000)})
    .catch(()=>{throw new StaffError('The account service could not be reached.',502);});
  const me=await r.json().catch(()=>({}));
  if(!r.ok)throw new StaffError(me.error||'This account does not have staff access.',r.status===401?401:403);
  if(me.role!=='admin'&&me.role!=='owner')throw new StaffError('Sending emails needs the admin role.',403);
  return me;
}

function preset(value:unknown):StaffPreset{
  const found=staffPresets.find(p=>p.id===value);
  if(!found)throw new StaffError('Choose one of the preset emails.',400);
  return found.id;
}

function fields(body:Record<string,unknown>,kind:StaffPreset){
  if(kind!=='update')return {version:'',notes:''};
  const version=String(body.version||'').trim(),notes=String(body.notes||'').trim();
  if(!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version))throw new StaffError('Enter the version, like 0.3.0.',400);
  if(!notes||notes.length>2000)throw new StaffError('Add what changed, one change per line.',400);
  return {version,notes};
}

async function recipient(userId:unknown){
  if(typeof userId!=='string'||!/^[\w-]{3,64}$/.test(userId))throw new StaffError('Choose a person.',400);
  const [row]=await db()`SELECT a.email,p.display_name,p.username FROM desktop_activity a LEFT JOIN desktop_profiles p ON p.user_id=a.user_id WHERE a.user_id=${userId}`;
  const email=String(row?.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new StaffError('Mowr has no email address on record for this person.',404);
  return {id:userId,email,name:String(row?.display_name||row?.username||'')};
}

const unsubscribeLink=(email:string)=>`https://mowrai.com/api/email/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;

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
    const person=req.body?.userId?await recipient(req.body.userId).catch(()=>null):null;
    const extra=kind==='update'?{version:String(req.body?.version||'').trim()||'0.0.0',notes:String(req.body?.notes||'')}:{version:'',notes:''};
    const mail=staffEmail(kind,{...extra,name:person?.name||'',unsubscribe:unsubscribeLink(person?.email||'you@example.com')});
    res.json({subject:mail.subject,html:mail.html,to:person?.email||null});
  }));

  router.post('/send',handle(async(req,res)=>{
    const staff=await staffFor(req);
    if(!mailReady()||!databaseReady())throw new StaffError('Email sending is not set up on this server.',503);
    const kind=preset(req.body?.kind),extra=fields(req.body||{},kind),person=await recipient(req.body?.userId);
    // A double click or a second tab should not send the same email twice.
    const since=new Date(Date.now()-60_000).toISOString();
    const [recent]=await db()`SELECT 1 AS hit FROM desktop_audit_log WHERE action='email.send' AND target=${person.id} AND detail LIKE ${kind+'%'} AND created_at>${since} LIMIT 1`;
    if(recent)throw new StaffError('This email was just sent to them. Wait a minute to send it again.',409);
    let headers:Record<string,string>|undefined,unsubscribe='';
    if(kind==='update'){
      const [optedOut]=await db()`SELECT 1 AS hit FROM mowr_email_optout WHERE email=${person.email} AND kind='updates'`;
      if(optedOut)throw new StaffError('They turned off update emails, so this one was not sent.',409);
      unsubscribe=unsubscribeLink(person.email);
      headers={'List-Unsubscribe':`<${unsubscribe}>, <mailto:support@mowrai.com?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
    }
    const mail=staffEmail(kind,{...extra,name:person.name,unsubscribe});
    try{await send(person.email,mail.subject,mail.text,undefined,{html:mail.html,headers});}
    catch(error){throw new StaffError((error as Error).message||'The mail server did not accept the email.',502);}
    const at=new Date().toISOString();
    // The automatic senders skip anyone already logged, so a hand-sent welcome or update is not repeated later.
    const logged=kind==='welcome'?'welcome':kind==='update'?'update:'+extra.version:null;
    if(logged)await db()`INSERT INTO mowr_email_log(owner_id,kind,sent_at) VALUES(${'supabase:'+person.id},${logged},${at}) ON CONFLICT(owner_id,kind) DO NOTHING`;
    await db()`INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(${randomUUID()},${staff.id},${staff.email},'email.send',${person.id},${`${kind}${extra.version?' '+extra.version:''} · ${mail.subject} → ${person.email}`},${at})`;
    res.json({ok:true,to:person.email,subject:mail.subject});
  }));

  return router;
}
