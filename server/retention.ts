// Keeps mail from piling up, run once a day by /api/cron:
//  - the support@m4labs.xyz Zoho mailbox: automated mail is deleted 21 days after it was sent, and every email of a
//    support case (the notification, staff replies, the person's replies) 14 days after the case was closed;
//  - Cloudflare D1 is cleaned by the account worker's hourly cron (cloudflare/lib/retention.js): email logs after 21
//    days, closed cases two days after this has had its chance at their mail.
// Zoho is reached through the Zoho Mail REST API with a Self Client (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN).
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

type Reason='automated'|'case';
export type MailboxReport={configured:boolean;deleted:number;folders:Record<string,number>;would?:string[];error?:string};

function zohoReady(){return !!(process.env.ZOHO_CLIENT_ID&&process.env.ZOHO_CLIENT_SECRET&&process.env.ZOHO_REFRESH_TOKEN);}

/** Closed cases past the wait, oldest first. */
async function closedCases(now:number){
  if(!databaseReady())return [];
  const before=new Date(now-CLOSED_CASE_DAYS*DAY).toISOString();
  const rows=await db()`SELECT case_id FROM clem_support_state WHERE status='closed' AND updated_at<${before} ORDER BY updated_at LIMIT 500`;
  return rows.map(r=>String(r.case_id));
}

export type Message={headers:string;messageId?:string;subject?:string;from?:string;date?:Date};
/** Why a message should go, or null to keep it. `sent` is the Sent folder; anything else is treated as the inbox. */
export function classify(m:Message,sent:boolean,closed:Set<string>,cutoff:Date):Reason|null{
  const field=(name:string)=>new RegExp(`^${name}:[ \\t]*(.+)$`,'im').exec(m.headers)?.[1]?.trim()||'';
  const kind=field(MAIL_HEADER).toLowerCase();
  const caseId=field(CASE_HEADER)||caseFrom(m.messageId||field('message-id'))||caseFrom(field('references'))||caseFrom(field('in-reply-to'));
  if(caseId&&closed.has(caseId))return 'case';
  if(!m.date||m.date>=cutoff)return null;
  const subject=m.subject||'',from=(m.from||'').toLowerCase();
  // Sent: what our servers and Supabase sent (staff and case mail stay). Inbox: bounces of that mail.
  const automated=sent
    ?kind==='automated'||(!kind&&!caseId&&(automatedSubjects.has(subject)||isUpdate(subject)))
    :/^(mailer-daemon|postmaster)@/.test(from);
  return automated?'automated':null;
}

/** A short-lived access token from the Self Client's refresh token (api-console.zoho.com). */
async function zohoToken(){
  const r=await fetch((process.env.ZOHO_ACCOUNTS_URL||'https://accounts.zoho.com')+'/oauth/v2/token',{method:'POST',signal:AbortSignal.timeout(15000),
    body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_CLIENT_ID!,client_secret:process.env.ZOHO_CLIENT_SECRET!,refresh_token:process.env.ZOHO_REFRESH_TOKEN!})});
  const data=await r.json().catch(()=>({}));
  if(!data.access_token)throw Error('Zoho refused the refresh token: '+(data.error||r.status));
  return String(data.access_token);
}

type ZohoMessage={messageId:string;folderId:string;subject?:string;fromAddress?:string;receivedTime?:string};
function zohoClient(token:string){
  const base=(process.env.ZOHO_API_URL||'https://mail.zoho.com')+'/api/accounts';
  return async function call(path:string,init:RequestInit={}){
    const r=await fetch(base+path,{...init,headers:{Authorization:'Zoho-oauthtoken '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||(data.status&&data.status.code>=300))throw Error(`Zoho Mail ${init.method||'GET'} ${path.split('?')[0]}: ${data.data?.errorCode||data.status?.description||r.status}`);
    return data.data;
  };
}

const unescape=(s='')=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');

/**
 * Deletes old automated mail and closed cases' mail from the Zoho mailbox through the Zoho Mail API. Headers are read
 * only for messages that could go; bodies never are. `dryRun` reports what would go without deleting anything.
 */
export async function purgeMailbox(now=Date.now(),closed:string[]=[],dryRun=false):Promise<MailboxReport>{
  if(!zohoReady())return {configured:false,deleted:0,folders:{}};
  const report:MailboxReport={configured:true,deleted:0,folders:{},...(dryRun?{would:[]}:{})};
  try{
    const call=zohoClient(await zohoToken());
    const accounts:{accountId:string;primaryEmailAddress?:string}[]=await call('');
    const user=(process.env.SMTP_USER||'').toLowerCase();
    const account=accounts.find(a=>a.primaryEmailAddress?.toLowerCase()===user)||accounts[0];
    if(!account)throw Error('No Zoho Mail account is visible to this client.');
    const folders:{folderId:string;folderName:string;folderType:string}[]=await call(`/${account.accountId}/folders`);
    const cutoff=new Date(now-AUTOMATED_DAYS*DAY),set=new Set(closed);
    // Sent, every inbox-type folder (Inbox, Notification, Newsletter) where replies and bounces land, then Trash, where
    // the API puts what it deletes: there it is matched like Sent mail of any age, so the copy goes too.
    const order=['Sent','Inbox','Trash'];
    for(const folder of folders.filter(f=>order.includes(f.folderType)).sort((a,b)=>order.indexOf(a.folderType)-order.indexOf(b.folderType))){
      const sent=folder.folderType!=='Inbox',trash=folder.folderType==='Trash',doomed:string[]=[];
      for(let start=1;start<=5000;start+=200){
        const page:ZohoMessage[]=await call(`/${account.accountId}/messages/view?folderId=${folder.folderId}&start=${start}&limit=200`)||[];
        for(const m of page){
          const date=m.receivedTime?new Date(Number(m.receivedTime)):undefined;
          // Recent mail can only go as a closed case's mail, so its headers are skipped when no case is due.
          if(!trash&&!set.size&&date&&date>=cutoff)continue;
          const head=await call(`/${account.accountId}/folders/${folder.folderId}/messages/${m.messageId}/header`);
          const reason=classify({headers:String(head?.headerContent||''),subject:unescape(m.subject),from:unescape(m.fromAddress),date},sent,set,trash?new Date(now):cutoff);
          if(!reason)continue;
          doomed.push(m.messageId);
          report.would?.push(`${folder.folderName} · ${reason} · ${date?.toISOString().slice(0,10)} · ${unescape(m.subject)}`);
        }
        if(page.length<200)break;
      }
      // Deleted after listing, so pages don't shift under the loop.
      if(!dryRun)for(const id of doomed)await call(`/${account.accountId}/folders/${folder.folderId}/messages/${id}`,{method:'DELETE'});
      report.folders[folder.folderName]=doomed.length;report.deleted+=doomed.length;
    }
  }catch(error){report.error=(error as Error).message;}
  return report;
}

/** The daily run. Only reads D1: the API may not change support cases, so the account worker deletes them. */
export async function runRetention(now=Date.now()){
  return {mailbox:await purgeMailbox(now,await closedCases(now))};
}
