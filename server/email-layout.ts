// Shared by scripts/build-emails.mjs (templates handed to Supabase) and server/emails.ts (mail the server sends itself).
export const BASE='https://clem.m4labs.xyz',APP='https://clem.m4labs.xyz/#/app';
// Bumped whenever the fonts or the mark change: mail clients and Gmail's image proxy cache these by URL.
export const ASSETS='v=20261020c';
const LINK='{{ .ConfirmationURL }}';
const mono="'JetBrains Mono','Courier New',Courier,monospace",word="'Outfit','Helvetica Neue',Arial,sans-serif";
// Clients that load web fonts (Apple Mail, iOS, Outlook for Mac) use Clem's own; the rest fall back to Courier and Arial.
const faces=`@font-face{font-family:'JetBrains Mono';src:url(${BASE}/fonts/JetBrainsMono.woff2?${ASSETS}) format('woff2');font-weight:100 800;font-display:swap}@font-face{font-family:'Outfit';src:url(${BASE}/fonts/Outfit.woff2?${ASSETS}) format('woff2');font-weight:100 900;font-display:swap}`;
export type EmailParts={cmd?:string;title:string;body:string;label?:string;url?:string;note?:string;code?:string;preheader?:string;footer?:string;letter?:boolean};
/**
 * The one layout every Clem email uses, in M4 Labs' terminal style (m4labs.xyz): the command that sent it, a title with a
 * blinking cursor, the message and one paper-coloured button. `footer` adds a line (e.g. unsubscribe) under the card.
 * `letter` keeps a written message's line breaks, for staff messages and replies.
 */
export function layout({cmd='clem notify',title,body,label,url,note,code,preheader=body,footer,letter}:EmailParts){
 const button=label?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px 0 0"><tr><td class="cx-rise cx-d3" bgcolor="#F4F2EC" style="border-radius:6px"><a href="${url}" style="display:inline-block;padding:13px 22px;font-family:${mono};font-size:14px;color:#0b0b0a;text-decoration:none;border-radius:6px"><span style="opacity:.55">&gt;</span>&nbsp;${label}</a></td></tr></table>`:'';
 const fallback=url===LINK?`<p style="margin:20px 0 0;font-family:${mono};font-size:11.5px;line-height:1.6;color:#5c5c58">button not working? paste this into your browser:<br><a href="${url}" style="color:#8a897f;word-break:break-all">${url}</a></p>`:'';
 const token=code?`<div class="cx-rise cx-d3" style="margin:26px 0 0;display:inline-block;padding:14px 22px;border:1px solid #2a2a27;border-radius:6px;background:#0b0b0a;font-family:${mono};font-size:30px;letter-spacing:8px;color:#F4F2EC">${code}</div>`:'';
 const small=note?`<p style="margin:28px 0 0;padding-top:18px;border-top:1px dashed #2a2a27;font-family:${mono};font-size:12px;line-height:1.65;color:#8a897f"># ${note}</p>`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${title}</title><style>${faces}
@keyframes cx-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes cx-blink{50%{opacity:0}}
.cx-rise{animation:cx-rise .7s cubic-bezier(.2,.8,.2,1) both}.cx-d1{animation-delay:.1s}.cx-d2{animation-delay:.2s}.cx-d3{animation-delay:.3s}
.cx-caret{animation:cx-blink 1.06s steps(1) infinite}
@media (prefers-reduced-motion:reduce){.cx-rise,.cx-caret{animation:none}}
@media (max-width:600px){.cx-card{padding:26px 20px!important}.cx-title{font-size:22px!important}}
</style></head><body style="margin:0;padding:0;background:#0b0b0a"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b0b0a">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0b0b0a" style="background:#0b0b0a"><tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
<tr><td style="padding:0 2px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="${BASE}/email/clem-mark.gif?${ASSETS}" width="26" height="26" alt="" style="display:block;border:0"></td><td style="padding-left:8px;vertical-align:middle;font-family:${word};font-weight:600;font-size:22px;letter-spacing:-.6px;color:#F4F2EC">clem</td></tr></table></td><td align="right" style="vertical-align:middle;font-family:${mono};font-size:11px;color:#5c5c58">an M4 Labs project</td></tr></table></td></tr>
<tr><td class="cx-card" bgcolor="#121211" style="background:#121211;border:1px solid #2a2a27;border-radius:8px;padding:30px 32px 30px;text-align:left">
<p class="cx-rise" style="margin:0 0 18px;font-family:${mono};font-size:13px;color:#8a897f"><span style="color:#F4F2EC">m4labs:~$</span> ${cmd}</p>
<h1 class="cx-rise cx-d1 cx-title" style="margin:0 0 14px;font-family:${mono};font-weight:400;font-size:25px;line-height:1.25;letter-spacing:-.4px;color:#F4F2EC">${title}<span class="cx-caret" style="display:inline-block;width:.55em;height:.95em;margin-left:.18em;vertical-align:-.1em;background:#F4F2EC;border-radius:2px">&nbsp;</span></h1>
<p class="cx-rise cx-d2" style="margin:0;font-family:${mono};font-size:14px;line-height:1.7;color:${letter?'#d6d4cc':'#b9b8b0'};white-space:pre-wrap">${body}</p>
${token}${button}${fallback}${small}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${mono};font-size:11.5px;line-height:1.9;color:#5c5c58">your space to think.<br><a href="mailto:support@m4labs.xyz" style="color:#8a897f;text-decoration:none">support@m4labs.xyz</a> &nbsp;·&nbsp; <a href="${BASE}" style="color:#8a897f;text-decoration:none">clem.m4labs.xyz</a> &nbsp;·&nbsp; <a href="https://m4labs.xyz" style="color:#8a897f;text-decoration:none">m4labs.xyz</a>${footer?`<br>${footer}`:''}</td></tr>
</table></td></tr></table></body></html>`;
}

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type Email={subject:string;text:string;html:string};

/** Supabase's templates plus a few notices, as file: [command, title, body, button label, button url, note, code]. */
export const templates:Record<string,[string,string,string,string,string,string,string?]>={
 'confirm-signup':['clem auth --confirm-email','Confirm your email','One click and your workspace is ready.','Confirm email',LINK,'Didn’t sign up? You can ignore this email.'],
 'reset-password':['clem auth --reset-password','Reset your password','Choose a new password with the link below.','Reset password',LINK,'Didn’t ask for this? Ignore it and nothing changes.'],
 'magic-link':['clem auth --link','Your sign-in link','Open it in the browser where you asked for it.','Sign in',LINK,'Never forward this email.'],
 'change-email':['clem auth --change-email','Confirm your new email','Confirm the change to {{ .NewEmail }}.','Confirm change',LINK,'Didn’t ask for this? Contact support.'],
 'invite':['clem invite','You’re invited to Clem','Your space to think is waiting.','Accept invitation',LINK,''],
 'reauthentication':['clem auth --verify','Confirm it’s you','Enter this code in Clem.','','','Never share this code.','{{ .Token }}'],
 'password-changed':['clem security --password','Your password was changed','If this was you, you’re all set.','Security settings',APP,'Wasn’t you? Reset your password now.'],
 'email-changed':['clem security --email','Your email was changed','Your account now uses a new email address.','','','Wasn’t you? Contact support right away.'],
 'identity-linked':['clem security --link','A sign-in method was added','A new way to sign in was linked to your account.','','','Wasn’t you? Review your security settings.'],
 'identity-unlinked':['clem security --unlink','A sign-in method was removed','A linked sign-in method was removed from your account.','','','Wasn’t you? Contact support.'],
 'mfa-enabled':['clem security --mfa on','Two-step verification is on','Your account is now better protected.','','',''],
 'mfa-disabled':['clem security --mfa off','Two-step verification is off','A verification method was removed from your account.','','','Wasn’t you? Secure your account now.'],
 'support-received':['clem support --received','We got your message','We’ll reply soon. Add details by replying to this email.','','','Never send passwords or keys.'],
 'automation-complete':['clem routine --done','Your routine is ready','Open Clem to see the result.','Open Clem',APP,''],
 'automation-failed':['clem routine --failed','A routine needs attention','Open Clem to see what happened.','Open Clem',APP,''],
 'account-deletion':['clem account --delete','We received your deletion request','We’ll verify it before anything is removed.','','','Didn’t ask for this? Contact support.'],
};

export function welcomeEmail(name:string):Email{
 const first=name.trim().split(/\s+/)[0]||'there';
 const body='Your space to think is ready. Bring your notes, slides and questions, and Clem turns them into answers, flashcards and worksheets.';
 const note='Tip: make a subject for each course and drop your files in. Clem answers from them.';
 return {subject:'Welcome to Clem',text:`Welcome to Clem, ${first}.\n\n${body}\n\nOpen Clem: ${APP}\n\n${note}`,
  html:layout({cmd:'clem welcome',title:`Welcome to Clem, ${escape(first)}`,body,label:'Open Clem',url:APP,note})};
}

/** `notes` is one change per line. `unsubscribe` is this person's signed opt-out link. */
export function updateEmail(version:string,notes:string,unsubscribe:string):Email{
 const lines=notes.split(/\r?\n/).map(l=>l.replace(/^[-*•]\s*/,'').trim()).filter(Boolean).slice(0,8);
 const download=BASE+'/download/windows';
 const note='Download the new version and run it over the old one. Your chats, files and subjects stay exactly as they are.';
 const intro='A new version of Clem is ready.';
 return {subject:`Clem ${version} is here`,
  text:`Clem ${version} is here.\n\n${lines.map(l=>'- '+l).join('\n')||intro}\n\nGet the update: ${download}\n\n${note}\n\nStop update emails: ${unsubscribe}`,
  html:layout({cmd:`clem update --version ${escape(version)}`,title:`Clem ${escape(version)} is here`,body:lines.length?lines.map(l=>'+ '+escape(l)).join('\n'):intro,preheader:escape(lines[0]||intro),label:'Get the update',url:download,note,
   footer:`<a href="${escape(unsubscribe)}" style="color:#5c5c58;text-decoration:underline">stop update emails</a>`})};
}


/** The one-time code Clem's own server sends to confirm a sensitive change. */
export function codeEmail(code:string):Email{
 const title='Your Clem verification code',body='Enter this code in Clem. It expires in 10 minutes.',note='Never share this code. Didn’t ask for it? Secure your account and contact support@m4labs.xyz.';
 return {subject:title,text:`Your verification code is ${code}.

It expires in 10 minutes. ${note}`,html:layout({cmd:'clem auth --code',title,body,note,code})};
}

/** A fixed template sent as is (no Supabase link or code), e.g. the routine notices. */
export function templateEmail(file:string):Email{
 const [cmd,title,body,label,url,note]=templates[file];
 return {subject:title,text:[title,body,label&&`${label}: ${url}`,note].filter(Boolean).join('\n\n'),html:layout({cmd,title,body,label,url,note})};
}

/**
 * Presets staff can send one person from the admin portal. Sign-in, reset and security emails are left out on purpose:
 * Supabase sends those when the person acts, and their links only work in the browser that asked.
 */
export const staffPresets=[
 {id:'custom',label:'Write your own',about:'A message from you, in the same design.'},
 {id:'welcome',label:'Welcome to Clem',about:'The welcome email new accounts get.'},
 {id:'update',label:'New version',about:'A new desktop version is out, with what changed.'},
 {id:'automation-complete',label:'Routine ready',about:'A routine finished and its result is in Clem.'},
 {id:'automation-failed',label:'Routine needs attention',about:'A routine stopped and needs a look.'},
 {id:'support-received',label:'We got your message',about:'Confirms a support message arrived.'},
] as const;
export type StaffPreset=typeof staffPresets[number]['id'];

/** A message staff write themselves. Replies go to support@m4labs.xyz (the sender sets Reply-To). */
export function customEmail(subject:string,message:string,name=''):Email{
 const first=name.trim().split(/\s+/)[0],hello=first?`Hi ${first},\n\n`:'';
 const note='Reply to this email and it reaches Clem support.';
 return {subject,text:`${hello}${message}\n\n${note}`,
  html:layout({cmd:'clem support --message',title:escape(subject),body:escape(hello+message),preheader:escape(message.slice(0,140)),note,letter:true})};
}

/** A support reply, sent alongside the copy that appears in the person's app under Help & support. */
export function caseReplyEmail(caseSubject:string,reply:string,name=''):Email{
 const first=name.trim().split(/\s+/)[0],hello=first?`Hi ${first},\n\n`:'';
 const note='Reply to this email, or answer in Clem under Settings → Help & support.';
 return {subject:`Re: ${caseSubject}`.slice(0,200),text:`${hello}${reply}\n\n— Clem support\n\n${note}`,
  html:layout({cmd:'clem support --reply',title:escape(caseSubject),body:escape(`${hello}${reply}\n\n— Clem support`),preheader:escape(reply.slice(0,140)),note,letter:true})};
}

export function staffEmail(kind:StaffPreset,{name='',version='',notes='',unsubscribe='',subject='',message=''}:{name?:string;version?:string;notes?:string;unsubscribe?:string;subject?:string;message?:string}):Email{
 if(kind==='custom')return customEmail(subject||'A note from Clem',message,name);
 if(kind==='welcome')return welcomeEmail(name);
 if(kind==='update')return updateEmail(version,notes,unsubscribe);
 return templateEmail(kind);
}
