// Emails everyone with a confirmed Mowr account that a new desktop version is out.
//   npm run emails:announce -- --notes "Flashcards follow your exam date|Tidier recent files"          (dry run: counts and a preview)
//   npm run emails:announce -- --notes-file release-notes.txt --send                                   (sends)
// Safe to re-run: each person gets each version at most once (mowr_email_log), and people who used
// "Stop update emails" are skipped (mowr_email_optout). Sends one email every --gap seconds (default 3)
// and at most --limit per run (default 250) to stay inside Zoho's sending limits; run again to continue.
// Only announce after the installer is live at mowrai.com/download/windows (npm run installer:release + deploy).
import fs from 'node:fs';
import {createHmac} from 'node:crypto';
import {parse} from 'dotenv';
import nodemailer from 'nodemailer';
import {updateEmail} from '../server/email-layout.ts';

const env=parse(fs.readFileSync('.env.local'));
const arg=name=>{const hit=process.argv.find(a=>a.startsWith(`--${name}=`));if(hit)return hit.slice(name.length+3);const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:undefined;};
const send=process.argv.includes('--send');
// The version the website offers, not the one being developed in package.json.
const version=arg('version')||JSON.parse(fs.readFileSync('public/desktop-release.json','utf8')).version;
const notes=(arg('notes-file')?fs.readFileSync(arg('notes-file'),'utf8'):(arg('notes')||'').replace(/\|/g,'\n')).trim();
const limit=Number(arg('limit')||250),gap=Number(arg('gap')||3)*1000;
for(const name of ['SUPABASE_URL','SUPABASE_ACCESS_TOKEN','SESSION_SECRET','CLOUDFLARE_DATABASE_URL','CLOUDFLARE_DATABASE_SECRET','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'])if(!env[name])throw Error(`${name} is missing from .env.local.`);
if(!notes)throw Error('Add what changed with --notes "first change|second change" or --notes-file path.');

// Never announce a version people can't download: the live /download/windows must point at this version's installer, and it must respond.
{
  const page='https://mowrai.com/download/windows',file=`Mowr-Setup-${version}.exe`;
  const hop=await fetch(page,{method:'HEAD',redirect:'manual'}).catch(e=>{throw Error(`Could not reach ${page}: ${e.message}. Nothing was sent.`);});
  const target=hop.headers.get('location')||'';
  if(!target.endsWith('/'+file))throw Error(`${page} points at ${target||'nothing ('+hop.status+')'}, not ${file}. Deploy the website for ${version} first. Nothing was sent.`);
  const asset=await fetch(new URL(target,page),{method:'HEAD',redirect:'follow'}).catch(e=>({ok:false,status:e.message}));
  if(!asset.ok)throw Error(`The installer at ${target} is not live (${asset.status}). Nothing was sent.`);
}

async function d1(sql,...params){
  const r=await fetch(env.CLOUDFLARE_DATABASE_URL,{method:'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_DATABASE_SECRET,'Content-Type':'application/json'},body:JSON.stringify({queries:[{sql,params}]})});
  const data=await r.json().catch(()=>({}));if(!r.ok||data.error)throw Error('Database request failed: '+(data.error||r.status));return data.results[0].results;
}
const ref=new URL(env.SUPABASE_URL).hostname.split('.')[0];
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},
  body:JSON.stringify({query:"select id,lower(email) as email from auth.users where email is not null and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<now()) order by created_at"})});
if(!r.ok)throw Error('Could not read accounts from Supabase ('+r.status+'). Check SUPABASE_ACCESS_TOKEN.');
const users=await r.json();
const kind='update:'+version;
const optedOut=new Set((await d1("SELECT email FROM mowr_email_optout WHERE kind='updates'")).map(x=>x.email));
const done=new Set((await d1('SELECT owner_id FROM mowr_email_log WHERE kind=?',kind)).map(x=>x.owner_id));
const queue=users.filter(u=>!optedOut.has(u.email)&&!done.has('supabase:'+u.id));
const link=email=>`https://mowrai.com/api/email/unsubscribe?e=${encodeURIComponent(email)}&t=${createHmac('sha256',env.SESSION_SECRET).update('unsubscribe:'+email).digest('base64url')}`;

console.log(`Mowr ${version}: ${users.length} accounts, ${optedOut.size} opted out, ${done.size} already sent, ${queue.length} to send${queue.length>limit?` (${limit} this run)`:''}.`);
if(!send){
  fs.mkdirSync('.deploy',{recursive:true});fs.writeFileSync('.deploy/update-email-preview.html',updateEmail(version,notes,link('you@example.com')).html);
  console.log('Dry run. Preview: .deploy/update-email-preview.html. Add --send to send.');process.exit(0);
}
const port=Number(env.SMTP_PORT);
const mailer=nodemailer.createTransport({host:env.SMTP_HOST,port,secure:env.SMTP_SECURE?env.SMTP_SECURE==='true':port===465,requireTLS:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},pool:true,maxConnections:1});
let sent=0,failed=0;
for(const user of queue.slice(0,limit)){
  const unsubscribe=link(user.email),mail=updateEmail(version,notes,unsubscribe);
  try{
    await mailer.sendMail({from:env.SMTP_FROM,to:user.email,subject:mail.subject,text:mail.text,html:mail.html,
      headers:{'List-Unsubscribe':`<${unsubscribe}>, <mailto:support@mowrai.com?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}});
    await d1("INSERT INTO mowr_email_log(owner_id,kind,sent_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(owner_id,kind) DO NOTHING",'supabase:'+user.id,kind);
    sent++;
  }catch(e){failed++;console.warn(`Not sent to one address: ${e.message}`);if(failed>=5&&!sent)throw Error('Stopping: the mail server is refusing messages.');}
  process.stdout.write(`\r${sent} sent, ${failed} failed`);
  await new Promise(r=>setTimeout(r,gap));
}
mailer.close();
console.log(`\nDone. ${Math.max(0,queue.length-limit)} left for the next run.`);
