// Emails the server sends itself (Supabase only sends the sign-in and security ones):
//  - a welcome email, once per account, the first time the desktop app or site sees a confirmed sign-in;
//  - the opt-out link that scripts/announce-release.mjs puts in every update email.
import express from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {db,databaseReady} from './db.ts';
import {cookies,supabaseIdentity} from './auth.ts';
import {mailReady,sendMail} from './mail.ts';
import {welcomeEmail} from './email-layout.ts';

export const emailRouter=express.Router();

/** A link only this server can mint, so nobody can unsubscribe someone else. */
export function unsubscribeToken(email:string){return createHmac('sha256',process.env.SESSION_SECRET||'').update('unsubscribe:'+email.toLowerCase()).digest('base64url');}
function validToken(email:string,token:string){if(!process.env.SESSION_SECRET)return false;const a=Buffer.from(unsubscribeToken(email)),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);}

emailRouter.post('/welcome',async(req,res)=>{
  const token=req.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1]||cookies(req).mowr_supabase;
  const user=token?await supabaseIdentity(token):null;
  if(!user?.email){res.status(401).json({error:'Sign in first.'});return;}
  if(!databaseReady()||!mailReady()){res.json({sent:false});return;}
  // The row is the lock: only the request that inserts it sends, so two devices signing in at once still send one email.
  const claimed=await db()`INSERT INTO mowr_email_log(owner_id,kind,sent_at) VALUES(${user.id},'welcome',now()) ON CONFLICT(owner_id,kind) DO NOTHING RETURNING owner_id`;
  if(!claimed.length){res.json({sent:false});return;}
  // Accounts made before welcome emails existed are marked done without an email; a late "welcome" would confuse.
  if(!user.created||Date.now()-Date.parse(user.created)>7*86_400_000){res.json({sent:false});return;}
  try{const mail=welcomeEmail(user.name==='Thinker'?'':user.name);await sendMail(user.email,mail.subject,mail.text,undefined,{html:mail.html});res.json({sent:true});}
  catch(error){await db()`DELETE FROM mowr_email_log WHERE owner_id=${user.id} AND kind='welcome'`;throw error;}
});

const page=(title:string,body:string,form='')=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>@font-face{font-family:'Mowafy Sans';src:url(/fonts/MowafySans-Regular.woff2) format('woff2')}@font-face{font-family:'Mowafy Sans';src:url(/fonts/MowafySans-Bold.woff2) format('woff2');font-weight:700}@font-face{font-family:'Mowafy Serif';src:url(/fonts/MowafySerif-Regular.woff2) format('woff2')}</style><body style="margin:0;min-height:100vh;display:grid;place-content:center;background:#121211;color:#f0efeb;font:16px/1.6 'Mowafy Sans',Arial,sans-serif;text-align:center;padding:24px"><h1 style="font:400 28px 'Mowafy Serif',Georgia,serif;margin:0 0 10px">${title}</h1><p style="color:#b5b4ad;margin:0">${body}</p>${form}</body>`;

// GET shows a button (mail scanners open links, so a GET must not unsubscribe); POST does it, including one-click
// unsubscribe from Gmail and Outlook via the List-Unsubscribe-Post header.
emailRouter.get('/unsubscribe',(req,res)=>{
  const email=String(req.query.e||''),token=String(req.query.t||'');
  if(!email||!validToken(email,token)){res.status(400).type('html').send(page('This link has expired','Reply to any Mowr email with “unsubscribe” and we’ll take care of it.'));return;}
  res.type('html').send(page('Stop update emails?','We’ll stop telling you about new versions. Sign-in and security emails still arrive.',`<form method="post" style="margin-top:22px"><button style="padding:13px 24px;border:0;border-radius:12px;background:#f0efeb;color:#141413;font:700 15px 'Mowafy Sans',Arial,sans-serif;cursor:pointer">Stop update emails</button></form>`));
});
emailRouter.post('/unsubscribe',async(req,res)=>{
  const email=String(req.query.e||'').toLowerCase(),token=String(req.query.t||'');
  if(!email||!validToken(email,token)){res.status(400).type('html').send(page('This link has expired','Reply to any Mowr email with “unsubscribe” and we’ll take care of it.'));return;}
  await db()`INSERT INTO mowr_email_optout(email,kind,created_at) VALUES(${email},'updates',now()) ON CONFLICT(email,kind) DO NOTHING`;
  res.type('html').send(page('You’re unsubscribed','You won’t get update emails any more. Sign-in and security emails still arrive.'));
});
