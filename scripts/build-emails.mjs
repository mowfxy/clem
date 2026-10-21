// Builds every transactional email from one layout (server/email-layout.ts) into emails/, and a preview gallery into
// emails/preview/ that loads the images and fonts from this checkout (public/) instead of clem.m4labs.xyz, so new art
// can be checked before it is deployed. The images come from scripts/build-email-art.mjs.
import fs from 'node:fs';
import {BASE,templates,templateHtml,welcomeEmail,m4labsWelcomeEmail,updateEmail,codeEmail,caseReplyEmail,customEmail} from '../server/email-layout.ts';
fs.mkdirSync('emails/preview',{recursive:true});

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,'/').replace(/^(?!\/)/,'/')}`||process.argv[1]?.endsWith('build-emails.mjs')){
 const built={};
 for(const file of Object.keys(templates))built[file]=templateHtml(file);
 // Previews of the emails the server sends itself; the live copy is built per person in server/email-layout.ts.
 built['welcome-m4labs']=m4labsWelcomeEmail('Sam').html;
 built['welcome']=welcomeEmail('Sam').html;
 built['app-update']=updateEmail('0.3.0','Flashcards now follow your exam date.\nRecent files look tidier.\nRenaming files keeps the extension.','https://clem.m4labs.xyz/api/email/unsubscribe').html;
 const previewOnly={
  'code':codeEmail('482913').html,
  'case-reply':caseReplyEmail('Drive files not showing','Thanks for the details. Drive access was switched off on our side for a few hours; it is back on now, so your files should list again.','Sam').html,
 };
 for(const [file,html] of Object.entries(built))fs.writeFileSync(`emails/${file}.html`,html);
 // Supabase fills these in when it sends; the previews show sample values.
 const sample={'{{ .ConfirmationURL }}':'https://clem.m4labs.xyz/auth/v1/verify?token=sample','{{ .Token }}':'482913','{{ .NewEmail }}':'sam@newmail.com'};
 const local=(html)=>Object.entries(sample).reduce((h,[k,v])=>h.replaceAll(k,v),html.replaceAll(BASE+'/email/','../../public/email/').replaceAll(BASE+'/fonts/','../../public/fonts/'));
 const all={...built,...previewOnly};
 for(const [file,html] of Object.entries(all))fs.writeFileSync(`emails/preview/${file}.html`,local(html));
 const card=(f)=>`<section><h2>${f} <small>${(Buffer.byteLength(all[f])/1024).toFixed(1)} KB</small></h2><div class="row"><iframe src="${f}.html" class="desk" loading="lazy"></iframe><iframe src="${f}.html" class="phone" loading="lazy"></iframe></div></section>`;
 const order=['welcome-m4labs','welcome','confirm-signup','reset-password','magic-link','reauthentication','code','change-email','invite','password-changed','email-changed','identity-linked','identity-unlinked','mfa-enabled','mfa-disabled','account-deletion','app-update','automation-complete','automation-failed','support-received','case-reply'];
 fs.writeFileSync('emails/preview/index.html',`<!doctype html><meta charset="utf-8"><title>Email previews</title><style>body{margin:0;padding:24px;background:#2b2b29;color:#ddd;font:14px system-ui}h2{font-weight:500;font-size:15px;margin:28px 0 10px}small{color:#888}.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}iframe{border:0;background:#fff;border-radius:10px}.desk{width:680px;height:900px}.phone{width:375px;height:900px;border:8px solid #111;border-radius:28px}</style><h1 style="font-weight:500">M4 Labs + Clem emails <small>desktop 680px · phone 375px</small></h1>${order.filter(f=>all[f]).map(card).join('')}`);
 console.log(`Prepared ${Object.keys(built).length} email templates and ${Object.keys(all).length} previews (emails/preview/index.html).`);
}
