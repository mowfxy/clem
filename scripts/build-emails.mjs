// Builds every transactional email from one layout. Artwork comes from scripts/build-email-art.mjs
// (animated GIFs of the app's ink scenes and the Mowr mark, served from mowrai.com/email/).
// CSS entrance animations are a progressive enhancement: clients that strip <style> show everything at once.
import fs from 'node:fs';
fs.mkdirSync('emails',{recursive:true});
const BASE='https://mowrai.com',APP='https://mowrai.com/#/app';
const LINK='{{ .ConfirmationURL }}';

// file: [art, title, body, button label, button url, note, code]
const templates={
 'confirm-signup':['envelope','Confirm your email','One click and your workspace is ready.','Confirm email',LINK,'Didn’t sign up? You can ignore this email.'],
 'reset-password':['key','Reset your password','Choose a new password with the link below.','Reset password',LINK,'Didn’t ask for this? Ignore it and nothing changes.'],
 'magic-link':['door','Your sign-in link','Open it in the browser where you asked for it.','Sign in',LINK,'Never forward this email.'],
 'change-email':['swap','Confirm your new email','Confirm the change to {{ .NewEmail }}.','Confirm change',LINK,'Didn’t ask for this? Contact support.'],
 'invite':['invite','You’re invited to Mowr','Your space to think is waiting.','Accept invitation',LINK,''],
 'reauthentication':['keypad','Confirm it’s you','Enter this code in Mowr.','','','Never share this code.','{{ .Token }}'],
 'password-changed':['shield','Your password was changed','If this was you, you’re all set.','Security settings',APP,'Wasn’t you? Reset your password now.'],
 'email-changed':['swap','Your email was changed','Your account now uses a new email address.','','','Wasn’t you? Contact support right away.'],
 'identity-linked':['link','A sign-in method was added','A new way to sign in was linked to your account.','','','Wasn’t you? Review your security settings.'],
 'identity-unlinked':['unlink','A sign-in method was removed','A linked sign-in method was removed from your account.','','','Wasn’t you? Contact support.'],
 'mfa-enabled':['lock','Two-step verification is on','Your account is now better protected.','','',''],
 'mfa-disabled':['unlock','Two-step verification is off','A verification method was removed from your account.','','','Wasn’t you? Secure your account now.'],
 'support-received':['plane','We got your message','We’ll reply soon. Add details by replying to this email.','','','Never send passwords or keys.'],
 'automation-complete':['hourglass','Your routine is ready','Open Mowr to see the result.','Open Mowr',APP,''],
 'automation-failed':['untangle','A routine needs attention','Open Mowr to see what happened.','Open Mowr',APP,''],
 'refund-approved':['coin','Your refund was approved','Your payment provider will credit it shortly.','','',''],
 'refund-declined':['balance','About your refund request','Our reply explains the decision. Your consumer rights are unaffected.','','',''],
 'account-deletion':['box','We received your deletion request','We’ll verify it before anything is removed.','','','Didn’t ask for this? Contact support.'],
};

const sans='Arial,Helvetica,sans-serif',serif="Georgia,'Times New Roman',serif";
export function layout({art,title,body,label,url,note,code,preheader=body}){
 const button=label?`<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:30px auto 0"><tr><td class="mw-btn mw-rise mw-d3" bgcolor="#f0efeb" style="border-radius:12px"><a href="${url}" style="display:inline-block;padding:15px 28px;font-family:${sans};font-size:15px;font-weight:bold;color:#141413;text-decoration:none;border-radius:12px">${label}&nbsp;&rarr;</a></td></tr></table>`:'';
 const fallback=url===LINK?`<p style="margin:22px auto 0;max-width:400px;font-family:${sans};font-size:11.5px;line-height:1.6;color:#6f6e68">Button not working? Paste this into your browser:<br><a href="${url}" style="color:#85847e;word-break:break-all">${url}</a></p>`:'';
 const token=code?`<div class="mw-rise mw-d3" style="margin:28px auto 0;display:inline-block;padding:16px 24px;border:1px solid #373733;border-radius:14px;background:#141413;font-family:'Courier New',monospace;font-size:30px;letter-spacing:8px;color:#f0efeb">${code}</div>`:'';
 const small=note?`<p style="margin:26px 0 0;padding-top:20px;border-top:1px solid #2a2a27;font-family:${sans};font-size:12.5px;line-height:1.6;color:#85847e">${note}</p>`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${title}</title><style>
@keyframes mw-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes mw-glow{0%,100%{box-shadow:0 0 0 0 rgba(240,239,235,0)}50%{box-shadow:0 0 0 6px rgba(240,239,235,.1)}}
.mw-rise{animation:mw-rise .8s cubic-bezier(.2,.8,.2,1) both}.mw-d1{animation-delay:.12s}.mw-d2{animation-delay:.24s}.mw-d3{animation-delay:.36s}
.mw-btn{animation:mw-rise .8s cubic-bezier(.2,.8,.2,1) .36s both,mw-glow 2.8s ease-in-out 1.4s infinite}
@media (prefers-reduced-motion:reduce){.mw-rise,.mw-btn{animation:none}}
@media (max-width:600px){.mw-card{padding:28px 20px!important}.mw-title{font-size:25px!important}}
</style></head><body style="margin:0;padding:0;background:#121211"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#121211">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#121211" style="background:#121211"><tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="${BASE}/email/mowr-mark.gif" width="30" height="30" alt="Mowr" style="display:block;border:0"></td><td style="padding-left:10px;vertical-align:middle;font-family:${serif};font-size:22px;color:#f0efeb">mowr</td></tr></table></td></tr>
<tr><td class="mw-card" bgcolor="#1b1b19" style="background:#1b1b19;border:1px solid #2e2e2b;border-radius:20px;padding:34px 36px 32px;text-align:center">
${art?`<img class="mw-rise" src="${BASE}/email/${art}.gif" width="240" height="195" alt="" style="display:block;margin:0 auto 14px;width:240px;max-width:100%;height:auto;border:0">`:''}
<h1 class="mw-rise mw-d1 mw-title" style="margin:0 0 12px;font-family:${serif};font-weight:400;font-size:30px;line-height:1.2;letter-spacing:-.4px;color:#f0efeb">${title}</h1>
<p class="mw-rise mw-d2" style="margin:0 auto;max-width:400px;font-family:${sans};font-size:15px;line-height:1.65;color:#b5b4ad;white-space:pre-wrap">${body}</p>
${token}${button}${fallback}${small}
</td></tr>
<tr><td style="padding:22px 8px 0;text-align:center;font-family:${sans};font-size:12px;line-height:1.8;color:#6f6e68">Your space to think.<br><a href="mailto:support@mowrai.com" style="color:#a3a3a0;text-decoration:none">support@mowrai.com</a> &nbsp;·&nbsp; <a href="${BASE}" style="color:#a3a3a0;text-decoration:none">mowrai.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,'/').replace(/^(?!\/)/,'/')}`||process.argv[1]?.endsWith('build-emails.mjs')){
 for(const [file,[art,title,body,label,url,note,code]] of Object.entries(templates))fs.writeFileSync(`emails/${file}.html`,layout({art,title,body,label,url,note,code}));
 console.log('Prepared '+Object.keys(templates).length+' transactional email templates.');
}
