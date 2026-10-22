// Keeps mail from piling up, run once a day by /api/cron:
//  - the support@m4labs.xyz Zoho mailbox: automated mail is deleted 21 days after it was sent, and every email of a
//    support case (the notification, staff replies, the person's replies) 14 days after the case was closed;
//  - Cloudflare D1 is cleaned by the account worker's hourly cron (cloudflare/lib/retention.js): email logs after 21
//    days, closed cases two days after this has had its chance at their mail.
// Zoho is reached over IMAP with the SMTP app password, so IMAP access has to be on for support@m4labs.xyz.
import {ImapFlow} from 'imapflow';
import {db,databaseReady} from './db.ts';
import {CASE_HEADER,MAIL_HEADER} from './mail.ts';
import {templates} from './email-layout.ts';

const DAY=86_400_000;
export const AUTOMATED_DAYS=21,CLOSED_CASE_DAYS=14;

/** Subjects of mail sent before messages carried X-M4Labs-Mail, and of Supabase's mail, which can't carry it. */
const automatedSubjects=new Set([
  ...Object.values(templates).map(t=>t.subject||t.title),
  'Welcome to M4 Labs','Welcome to Clem','Your M4 Labs verification code',
  // Subjects used before the 2026-10-22 rewrite.
  'Confirm your M4 Labs account','Reset your M4 Labs password','Your M4 Labs sign-in link','Confirm your new email','You’re invited to M4 Labs',
  'Your email was changed','We got your message','Your routine is ready','A routine needs attention',
]);
const isUpdate=(subject:string)=>/^Clem \S+ (?:is here|is available)$/.test(subject);
const caseFrom=(value:string)=>/case\.([\w-]{8,64})\./.exec(value)?.[1];

type Found={uid:number;reason:'automated'|'case'};
export type MailboxReport={configured:boolean;deleted:number;folders:Record<string,number>;error?:string};

function imapReady(){return !!(process.env.SMTP_USER&&process.env.SMTP_PASSWORD&&(process.env.IMAP_HOST||process.env.SMTP_HOST));}

/** Closed cases past the wait, oldest first. */
async function closedCases(now:number){
  if(!databaseReady())return [];
  const before=new Date(now-CLOSED_CASE_DAYS*DAY).toISOString();
  const rows=await db()`SELECT case_id FROM clem_support_state WHERE status='closed' AND updated_at<${before} ORDER BY updated_at LIMIT 500`;
  return rows.map(r=>String(r.case_id));
}

export type Message={headers:string;messageId?:string;subject?:string;from?:string;date?:Date};
/** Why a message should go, or null to keep it. `sent` is the Sent folder; anything else is treated as the inbox. */
export function classify(m:Message,sent:boolean,closed:Set<string>,cutoff:Date):Found['reason']|null{
  const field=(name:string)=>new RegExp(`^${name}:[ \\t]*(.+)$`,'im').exec(m.headers)?.[1]?.trim()||'';
  const kind=field(MAIL_HEADER).toLowerCase();
  const caseId=field(CASE_HEADER)||caseFrom(m.messageId||'')||caseFrom(field('references'))||caseFrom(field('in-reply-to'));
  if(caseId&&closed.has(caseId))return 'case';
  if(!m.date||m.date>=cutoff)return null;
  const subject=m.subject||'',from=(m.from||'').toLowerCase();
  // Sent: what our servers and Supabase sent (staff and case mail stay). Inbox: bounces of that mail.
  const automated=sent
    ?kind==='automated'||(!kind&&!caseId&&(automatedSubjects.has(subject)||isUpdate(subject)))
    :/^(mailer-daemon|postmaster)@/.test(from);
  return automated?'automated':null;
}

/** Finds what to delete in one folder. Headers only; bodies are never downloaded. */
async function scan(client:ImapFlow,path:string,sent:boolean,closed:Set<string>,cutoff:Date){
  const found:Found[]=[];
  const lock=await client.getMailboxLock(path);
  try{
    if(!(client.mailbox&&client.mailbox.exists))return found;
    for await(const m of client.fetch('1:*',{uid:true,envelope:true,internalDate:true,headers:[MAIL_HEADER,CASE_HEADER,'references','in-reply-to']})){
      const reason=classify({headers:m.headers?.toString('utf8')||'',messageId:m.envelope?.messageId,subject:m.envelope?.subject,
        from:m.envelope?.from?.[0]?.address,date:m.internalDate||m.envelope?.date?new Date(m.internalDate||m.envelope!.date!):undefined},sent,closed,cutoff);
      if(reason)found.push({uid:m.uid,reason});
    }
  }finally{lock.release();}
  return found;
}

/** Deletes old automated mail and closed cases' mail from the Zoho mailbox. */
export async function purgeMailbox(now=Date.now(),closed:string[]=[]):Promise<MailboxReport>{
  if(!imapReady())return {configured:false,deleted:0,folders:{}};
  const client=new ImapFlow({host:process.env.IMAP_HOST||process.env.SMTP_HOST!.replace(/^smtp/,'imap'),port:Number(process.env.IMAP_PORT||993),secure:true,
    auth:{user:process.env.SMTP_USER!,pass:process.env.SMTP_PASSWORD!},logger:false,socketTimeout:60_000});
  const report:MailboxReport={configured:true,deleted:0,folders:{}};
  try{
    await client.connect();
    const boxes=await client.list();
    const inbox=boxes.find(b=>b.specialUse==='\\Inbox'||b.path.toUpperCase()==='INBOX'),sent=boxes.find(b=>b.specialUse==='\\Sent'||/^sent$/i.test(b.path));
    const cutoff=new Date(now-AUTOMATED_DAYS*DAY),set=new Set(closed);
    for(const [box,isSent] of [[inbox,false],[sent,true]] as const){
      if(!box)continue;
      const found=await scan(client,box.path,isSent,set,cutoff);
      if(found.length){
        const lock=await client.getMailboxLock(box.path);
        try{await client.messageDelete(found.map(f=>f.uid),{uid:true});}finally{lock.release();}
      }
      report.folders[box.path]=found.length;report.deleted+=found.length;
    }
    await client.logout();
  }catch(error){
    report.error=(error as {responseText?:string}).responseText||(error as Error).message;
    client.close();
  }
  return report;
}

/** The daily run. Only reads D1: the API may not change support cases, so the account worker deletes them. */
export async function runRetention(now=Date.now()){
  return {mailbox:await purgeMailbox(now,await closedCases(now))};
}
