// Shared by scripts/build-emails.mjs (templates handed to Supabase), scripts/build-email-art.mjs (the images) and
// server/emails.ts (mail the server sends itself).
//
// Supabase is the M4 Labs account platform: one account signs in to every M4 Labs product. So two brands send mail:
//  - "m4labs": account, sign-in and security emails, in m4labs.xyz's terminal style with an ASCII animation;
//  - "clem": Clem's own emails (welcome, updates, routines, support), in Clem's type with one of its illustrations.
// Both carry the M4 Labs logo.
export const BASE='https://clem.m4labs.xyz',APP='https://clem.m4labs.xyz/#/app',LAB='https://m4labs.xyz';
// Bumped whenever the fonts or images change: mail clients and Gmail's image proxy cache these by URL.
export const ASSETS='v=20261022a';
const LINK='{{ .ConfirmationURL }}';
export type Brand='m4labs'|'clem';

/** Image sizes as shown (the files are drawn at 2x). Changing these needs `npm run emails:art`. */
export const ART={ink:{w:320,h:240},ascii:{cols:56,rows:21,m4rows:13,cell:25,w:420,h:315,m4h:195},logo:{h:26,ratio:2.79}} as const;
/** Each email's picture: an ink illustration (src/vectorFilm.ts) or an ASCII animation of the same scene. */
export const emailArt:Record<string,{kind:'ink'|'ascii';scene:string}>={
 'welcome-m4labs':{kind:'ascii',scene:'m4'},
 'confirm-signup':{kind:'ascii',scene:'envelope'},
 'reset-password':{kind:'ascii',scene:'key'},
 'magic-link':{kind:'ascii',scene:'door'},
 'change-email':{kind:'ascii',scene:'swap'},
 'invite':{kind:'ascii',scene:'invite'},
 'reauthentication':{kind:'ascii',scene:'keypad'},
 'password-changed':{kind:'ascii',scene:'lock'},
 'email-changed':{kind:'ascii',scene:'profile'},
 'identity-linked':{kind:'ascii',scene:'link'},
 'identity-unlinked':{kind:'ascii',scene:'unlink'},
 'mfa-enabled':{kind:'ascii',scene:'shield'},
 'mfa-disabled':{kind:'ascii',scene:'unlock'},
 'account-deletion':{kind:'ascii',scene:'box'},
 'code':{kind:'ascii',scene:'keypad'},
 'welcome':{kind:'ink',scene:'wave'},
 'app-update':{kind:'ink',scene:'plane'},
 'automation-complete':{kind:'ink',scene:'checklist'},
 'automation-failed':{kind:'ink',scene:'alarm'},
 'support-received':{kind:'ink',scene:'conversation'},
 'case-reply':{kind:'ink',scene:'lifebuoy'},
 'custom':{kind:'ink',scene:'envelope'},
};

// Clients that load web fonts (Apple Mail, iOS Mail, Outlook for Mac, Samsung) use the real faces; Gmail and Outlook
// for Windows fall back to the stacks below, which keep the same shape (mono stays mono, serif stays serif).
const mono="'Fragment Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace",
 serif="'Mowafy Serif',Georgia,'Times New Roman',serif",sans="'Mowafy Sans','Helvetica Neue',Helvetica,Arial,sans-serif",
 word="'Outfit','Helvetica Neue',Arial,sans-serif";
const face=(family:string,file:string,weight='400')=>`@font-face{font-family:'${family}';src:url(${BASE}/fonts/${file}?${ASSETS}) format('woff2');font-weight:${weight};font-display:swap}`;
const faces={
 m4labs:face('Fragment Mono','FragmentMono-Regular.woff2'),
 clem:face('Mowafy Serif','MowafySerif-Regular.woff2')+face('Mowafy Sans','MowafySans-Regular.woff2')+face('Mowafy Sans','MowafySans-Bold.woff2','700')+face('Outfit','Outfit.woff2','100 900'),
};
/** Colours per brand: m4labs.xyz's, and Clem's app. */
const tone={
 m4labs:{page:'#0b0b0a',card:'#121211',line:'#2a2a27',ink:'#F4F2EC',text:'#c9c8c0',dim:'#8a897f',faint:'#5c5c58'},
 clem:{page:'#141414',card:'#1c1c1c',line:'#383838',ink:'#f0efeb',text:'#cfcec7',dim:'#a3a3a0',faint:'#73736f'},
};
export const artBackground={ascii:tone.m4labs.card,ink:tone.clem.card,mark:tone.clem.page};

export type EmailParts={brand?:Brand;art?:string;cmd?:string;title:string;body:string;label?:string;url?:string;note?:string;code?:string;preheader?:string;footer?:string;letter?:boolean;extra?:string};

// A solid colour as a gradient too: Gmail's apps recolour background colours in dark mode but leave images alone,
// so the dark design stays dark instead of turning grey.
const fill=(c:string)=>`background-color:${c};background-image:linear-gradient(${c},${c})`;

/**
 * The one layout every email uses. `art` names an entry in emailArt. `footer` adds a line (e.g. unsubscribe) under the
 * card. `letter` keeps a written message's line breaks, for staff messages and replies. `extra` is markup under the body.
 */
export function layout({brand='clem',art,cmd='m4labs notify',title,body,label,url,note,code,preheader=body,footer,letter,extra=''}:EmailParts){
 const t=tone[brand],m4=brand==='m4labs',text=m4?mono:sans;
 const picture=art&&emailArt[art],size=picture&&(picture.kind==='ink'?ART.ink:picture.scene==='m4'?{w:ART.ascii.w,h:ART.ascii.m4h}:ART.ascii);
 const image=picture&&size?`<tr><td align="center" class="mx-art" style="padding:${m4?'8px 0 4px':'14px 0 6px'}"><img src="${BASE}/email/${picture.kind}-${picture.scene}.gif?${ASSETS}" width="${size.w}" height="${size.h}" alt="" class="mx-img" style="display:block;width:100%;max-width:${size.w}px;height:auto;border:0;outline:none"></td></tr>`:'';
 const button=label?`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr><td style="border:1px solid ${t.ink};border-radius:${m4?6:12}px"><a href="${url}" class="mx-btn" style="display:inline-block;padding:${m4?'12px 20px':'13px 24px'};font-family:${text};font-size:${m4?14:15}px;font-weight:${m4?400:700};line-height:20px;color:${t.ink};text-decoration:none;border-radius:${m4?6:12}px">${m4?`<span style="color:${t.dim}">&gt;</span>&nbsp;`:''}${label}</a></td></tr></table>`:'';
 const fallback=url===LINK?`<p style="margin:18px 0 0;font-family:${mono};font-size:11.5px;line-height:1.6;color:${t.faint}">${m4?'button not working? paste this into your browser:':'Button not working? Paste this into your browser:'}<br><a href="${url}" style="color:${t.dim};word-break:break-all">${url}</a></p>`:'';
 const token=code?`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td style="padding:14px 20px;border:1px solid ${t.line};border-radius:${m4?6:12}px;${fill(t.page)};font-family:${mono};font-size:28px;line-height:32px;letter-spacing:7px;color:${t.ink}">${code}</td></tr></table>`:'';
 const small=note?`<p style="margin:26px 0 0;padding-top:16px;border-top:1px ${m4?'dashed':'solid'} ${t.line};font-family:${text};font-size:12.5px;line-height:1.65;color:${t.dim}">${m4?'# ':''}${note}</p>`:'';
 // The cursor sits on the baseline at cap height: overflow:hidden puts an inline-block's baseline at its bottom edge,
 // whatever the zero-width space inside it does. Pixel sizes because its own font size is 0.
 const caret=`<span class="mx-caret" style="display:inline-block;width:12px;height:17px;margin-left:4px;vertical-align:baseline;overflow:hidden;background:${t.ink};font-size:0;line-height:0">&#8203;</span>`;
 const heading=m4
  ?`<p style="margin:0 0 16px;font-family:${mono};font-size:13px;line-height:1.5;color:${t.dim}"><span style="color:${t.ink}">m4labs:~$</span> ${cmd}</p><h1 class="mx-title" style="margin:0 0 14px;font-family:${mono};font-weight:400;font-size:24px;line-height:1.3;letter-spacing:-.4px;color:${t.ink}">${title}${caret}</h1>`
  :`<h1 class="mx-title" style="margin:0 0 12px;font-family:${serif};font-weight:400;font-size:30px;line-height:1.2;letter-spacing:-.4px;color:${t.ink}">${title}</h1>`;
 const logo=`<img src="${BASE}/email/m4labs-logo.png?${ASSETS}" width="${Math.round(ART.logo.h*ART.logo.ratio)}" height="${ART.logo.h}" alt="M4 Labs" style="display:block;border:0;height:${ART.logo.h}px;width:auto">`;
 const smallLogo=`<img src="${BASE}/email/m4labs-logo.png?${ASSETS}" width="${Math.round(18*ART.logo.ratio)}" height="18" alt="M4 Labs" style="display:block;border:0;height:18px;width:auto">`;
 const masthead=m4
  ?`<td style="vertical-align:middle">${logo}</td><td align="right" style="vertical-align:middle;font-family:${mono};font-size:11px;color:${t.faint}">account</td>`
  :`<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle"><img src="${BASE}/email/clem-mark.gif?${ASSETS}" width="28" height="28" alt="" style="display:block;border:0"></td><td style="padding-left:8px;vertical-align:middle;font-family:${word};font-weight:600;font-size:23px;line-height:28px;letter-spacing:-.6px;color:${t.ink}">clem</td></tr></table></td><td align="right" style="vertical-align:middle">${smallLogo}</td>`;
 const link=(href:string,label:string)=>`<a href="${href}" style="color:${t.dim};text-decoration:none">${label}</a>`;
 const sign=m4
  ?`one account for everything M4 Labs makes.<br>${link('mailto:support@m4labs.xyz','support@m4labs.xyz')} &nbsp;·&nbsp; ${link(LAB,'m4labs.xyz')}`
  :`Clem is made by M4 Labs. Your M4 Labs account signs you in.<br>${link('mailto:support@m4labs.xyz','support@m4labs.xyz')} &nbsp;·&nbsp; ${link(BASE,'clem.m4labs.xyz')} &nbsp;·&nbsp; ${link(LAB,'m4labs.xyz')}`;
 // Pads the inbox preview so it shows only the preheader, not the start of the body.
 const pad='&#847;&zwnj;&nbsp;'.repeat(60);
 return `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" style="background:${t.page}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${title}</title><style>${faces[brand]}
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse}img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors],#MessageViewBody a{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
u+.mx-body .mx-keep{${fill(t.card)}}
@media (max-width:620px){.mx-shell{padding:20px 10px 28px!important}.mx-card{padding:22px 18px 24px!important}.mx-title{font-size:${m4?20:25}px!important}.mx-caret{width:10px!important;height:14px!important}.mx-art{padding-left:0!important;padding-right:0!important}}
</style></head><body class="mx-body" style="margin:0;padding:0;width:100%;${fill(t.page)}"><div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${t.page}">${preheader}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.page}" style="${fill(t.page)}"><tr><td align="center" class="mx-shell" style="padding:32px 14px 40px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
<tr><td style="padding:0 4px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${masthead}</tr></table></td></tr>
<tr><td class="mx-card mx-keep" bgcolor="${t.card}" style="${fill(t.card)};border:1px solid ${t.line};border-radius:${m4?8:18}px;padding:26px 30px 30px;text-align:left">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${image}<tr><td style="padding-top:${image?18:0}px">
${heading}
<div style="margin:0;font-family:${text};font-size:${m4?14:15.5}px;line-height:1.7;color:${letter?t.ink:t.text};white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${body}</div>
${extra}${token}${button}${fallback}${small}
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${text};font-size:11.5px;line-height:1.9;color:${t.faint}">${sign}${footer?`<br>${footer}`:''}</td></tr></table></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** `from` is the sender name when it isn't the server's default (Clem): account mail comes from M4 Labs. */
export type Email={subject:string;text:string;html:string;from?:string};
type Template={brand:Brand;subject?:string;cmd:string;title:string;body:string;label?:string;url?:string;note?:string;code?:string};

/** Supabase's templates (all account mail, so M4 Labs) plus Clem's notices, by file name. */
export const templates:Record<string,Template>={
 'confirm-signup':{brand:'m4labs',subject:'Confirm your M4 Labs account',cmd:'m4labs account --confirm',title:'Confirm your email',body:'One click and your M4 Labs account is ready. It signs you in to Clem and everything else we make.',label:'Confirm email',url:LINK,note:'Didn’t sign up? You can ignore this email.'},
 'reset-password':{brand:'m4labs',subject:'Reset your M4 Labs password',cmd:'m4labs auth --reset-password',title:'Reset your password',body:'Choose a new password for your M4 Labs account with the link below.',label:'Reset password',url:LINK,note:'Didn’t ask for this? Ignore it and nothing changes.'},
 'magic-link':{brand:'m4labs',subject:'Your M4 Labs sign-in link',cmd:'m4labs auth --link',title:'Your sign-in link',body:'Open it in the browser where you asked for it.',label:'Sign in',url:LINK,note:'Never forward this email.'},
 'change-email':{brand:'m4labs',subject:'Confirm your new email',cmd:'m4labs auth --change-email',title:'Confirm your new email',body:'Confirm the change to {{ .NewEmail }}.',label:'Confirm change',url:LINK,note:'Didn’t ask for this? Contact support.'},
 'invite':{brand:'m4labs',subject:'You’re invited to M4 Labs',cmd:'m4labs invite',title:'You’re invited',body:'Someone made you an M4 Labs account. Accept it to start using Clem, our space to think.',label:'Accept invitation',url:LINK,note:''},
 'reauthentication':{brand:'m4labs',subject:'Your M4 Labs verification code',cmd:'m4labs auth --verify',title:'Confirm it’s you',body:'Enter this code where you were asked for it.',note:'Never share this code.',code:'{{ .Token }}'},
 'password-changed':{brand:'m4labs',subject:'Your password was changed',cmd:'m4labs security --password',title:'Your password was changed',body:'The password for your M4 Labs account was changed. If this was you, you’re all set.',label:'Security settings',url:APP,note:'Wasn’t you? Reset your password now.'},
 'email-changed':{brand:'m4labs',subject:'Your email was changed',cmd:'m4labs security --email',title:'Your email was changed',body:'Your M4 Labs account now uses a new email address.',note:'Wasn’t you? Contact support right away.'},
 'identity-linked':{brand:'m4labs',subject:'A sign-in method was added',cmd:'m4labs security --link',title:'A sign-in method was added',body:'A new way to sign in was linked to your M4 Labs account.',note:'Wasn’t you? Review your security settings.'},
 'identity-unlinked':{brand:'m4labs',subject:'A sign-in method was removed',cmd:'m4labs security --unlink',title:'A sign-in method was removed',body:'A linked sign-in method was removed from your M4 Labs account.',note:'Wasn’t you? Contact support.'},
 'mfa-enabled':{brand:'m4labs',subject:'Two-step verification is on',cmd:'m4labs security --mfa on',title:'Two-step verification is on',body:'Your M4 Labs account is now better protected.'},
 'mfa-disabled':{brand:'m4labs',subject:'Two-step verification is off',cmd:'m4labs security --mfa off',title:'Two-step verification is off',body:'A verification method was removed from your M4 Labs account.',note:'Wasn’t you? Secure your account now.'},
 'account-deletion':{brand:'m4labs',cmd:'m4labs account --delete',title:'We received your deletion request',body:'We’ll verify it before anything is removed.',note:'Didn’t ask for this? Contact support.'},
 'support-received':{brand:'clem',cmd:'',title:'We got your message',body:'We’ll reply soon. Add details by replying to this email.',note:'Never send passwords or keys.'},
 'automation-complete':{brand:'clem',cmd:'',title:'Your routine is ready',body:'Open Clem to see the result.',label:'Open Clem',url:APP},
 'automation-failed':{brand:'clem',cmd:'',title:'A routine needs attention',body:'Open Clem to see what happened.',label:'Open Clem',url:APP},
};
/** The files Supabase sends, with their subjects (scripts/apply-email-templates.mjs and configure-supabase.mjs). */
export const supabaseTemplates={
 confirmation:'confirm-signup',recovery:'reset-password',magic_link:'magic-link',email_change:'change-email',invite:'invite',reauthentication:'reauthentication',
} as const;
export const supabaseNotices={
 password_changed:'password-changed',email_changed:'email-changed',identity_linked:'identity-linked',identity_unlinked:'identity-unlinked',mfa_factor_enrolled:'mfa-enabled',mfa_factor_unenrolled:'mfa-disabled',
} as const;
/** Supabase sends every account email under this name. */
export const SENDER_NAME='M4 Labs';
export function templateHtml(file:string){const {brand,cmd,title,body,label,url,note,code}=templates[file];return layout({brand,art:file,cmd,title,body,label,url,note,code});}

const firstName=(name:string)=>name.trim().split(/\s+/)[0]||'';

/** The first email a new account gets: what M4 Labs is and that this one account covers all of it. */
export function m4labsWelcomeEmail(name:string):Email{
 const first=firstName(name)||'there';
 const body='You now have an M4 Labs account. It’s one sign-in for everything we make: the same email and password work in each product, today and as new ones arrive.';
 const t=tone.m4labs;
 const products=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-top:1px dashed ${t.line}"><tr><td style="padding:16px 0 6px;font-family:${mono};font-size:13px;color:${t.dim}"><span style="color:${t.ink}">m4labs:~$</span> ls products/</td></tr>
<tr><td style="padding:6px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td width="72" style="vertical-align:top;font-family:${mono};font-size:14px;line-height:1.7;color:${t.ink}"><a href="${BASE}" style="color:${t.ink};text-decoration:underline">clem</a></td><td style="vertical-align:top;font-family:${mono};font-size:14px;line-height:1.7;color:${t.text}">your space to think. answers, flashcards and worksheets from your own notes.</td></tr></table></td></tr></table>`;
 const note='Manage your account, password and two-step verification from any M4 Labs product’s settings.';
 return {from:SENDER_NAME,subject:'Welcome to M4 Labs',text:`Welcome to M4 Labs, ${first}.\n\n${body}\n\nProducts:\n- Clem, your space to think: ${BASE}\n\nSee everything we make: ${LAB}\n\n${note}`,
  html:layout({brand:'m4labs',art:'welcome-m4labs',cmd:'m4labs account --new',title:`Welcome to M4 Labs, ${escape(first)}`,body,extra:products,label:'See what we make',url:LAB+'/projects',note})};
}

export function welcomeEmail(name:string):Email{
 const first=firstName(name)||'there';
 const body='Your space to think is ready. Bring your notes, slides and questions, and Clem turns them into answers, flashcards and worksheets.';
 const note='Tip: make a subject for each course and drop your files in. Clem answers from them.';
 return {subject:'Welcome to Clem',text:`Welcome to Clem, ${first}.\n\n${body}\n\nOpen Clem: ${APP}\n\n${note}`,
  html:layout({brand:'clem',art:'welcome',title:`Welcome to Clem, ${escape(first)}`,body,label:'Open Clem',url:APP,note})};
}

/** `notes` is one change per line. `unsubscribe` is this person's signed opt-out link. */
export function updateEmail(version:string,notes:string,unsubscribe:string):Email{
 const lines=notes.split(/\r?\n/).map(l=>l.replace(/^[-*•]\s*/,'').trim()).filter(Boolean).slice(0,8);
 const download=BASE+'/download/windows';
 const note='Download the new version and run it over the old one. Your chats, files and subjects stay exactly as they are.';
 const intro='A new version of Clem is ready.';
 return {subject:`Clem ${version} is here`,
  text:`Clem ${version} is here.\n\n${lines.map(l=>'- '+l).join('\n')||intro}\n\nGet the update: ${download}\n\n${note}\n\nStop update emails: ${unsubscribe}`,
  html:layout({brand:'clem',art:'app-update',title:`Clem ${escape(version)} is here`,body:lines.length?lines.map(l=>'+ '+escape(l)).join('\n'):intro,preheader:escape(lines[0]||intro),label:'Get the update',url:download,note,
   footer:`<a href="${escape(unsubscribe)}" style="color:${tone.clem.faint};text-decoration:underline">Stop update emails</a>`})};
}

/** The one-time code Clem's own server sends to confirm a sensitive account change. */
export function codeEmail(code:string):Email{
 const title='Your M4 Labs verification code',body='Enter this code in Clem. It expires in 10 minutes.',note='Never share this code. Didn’t ask for it? Secure your account and contact support@m4labs.xyz.';
 return {from:SENDER_NAME,subject:title,text:`Your verification code is ${code}.

It expires in 10 minutes. ${note}`,html:layout({brand:'m4labs',art:'code',cmd:'m4labs auth --code',title:'Confirm it’s you',body,note,code})};
}

/** A fixed template sent as is (no Supabase link or code), e.g. the routine notices. */
export function templateEmail(file:string):Email{
 const {subject,title,body,label,url,note}=templates[file];
 return {subject:subject||title,text:[title,body,label&&`${label}: ${url}`,note].filter(Boolean).join('\n\n'),html:templateHtml(file)};
}

/**
 * Presets staff can send one person from the admin portal. Sign-in, reset and security emails are left out on purpose:
 * Supabase sends those when the person acts, and their links only work in the browser that asked.
 */
export const staffPresets=[
 {id:'custom',label:'Write your own',about:'A message from you, in the same design.'},
 {id:'welcome-m4labs',label:'Welcome to M4 Labs',about:'The account welcome every new account gets first.'},
 {id:'welcome',label:'Welcome to Clem',about:'The Clem welcome new accounts get.'},
 {id:'update',label:'New version',about:'A new desktop version is out, with what changed.'},
 {id:'automation-complete',label:'Routine ready',about:'A routine finished and its result is in Clem.'},
 {id:'automation-failed',label:'Routine needs attention',about:'A routine stopped and needs a look.'},
 {id:'support-received',label:'We got your message',about:'Confirms a support message arrived.'},
] as const;
export type StaffPreset=typeof staffPresets[number]['id'];

/** A message staff write themselves. Replies go to support@m4labs.xyz (the sender sets Reply-To). */
export function customEmail(subject:string,message:string,name=''):Email{
 const first=firstName(name),hello=first?`Hi ${first},\n\n`:'';
 const note='Reply to this email and it reaches Clem support.';
 return {subject,text:`${hello}${message}\n\n${note}`,
  html:layout({brand:'clem',art:'custom',title:escape(subject),body:escape(hello+message),preheader:escape(message.slice(0,140)),note,letter:true})};
}

/** A support reply, sent alongside the copy that appears in the person's app under Help & support. */
export function caseReplyEmail(caseSubject:string,reply:string,name=''):Email{
 const first=firstName(name),hello=first?`Hi ${first},\n\n`:'';
 const note='Reply to this email, or answer in Clem under Settings → Help & support.';
 return {subject:`Re: ${caseSubject}`.slice(0,200),text:`${hello}${reply}\n\n— Clem support\n\n${note}`,
  html:layout({brand:'clem',art:'case-reply',title:escape(caseSubject),body:escape(`${hello}${reply}\n\n— Clem support`),preheader:escape(reply.slice(0,140)),note,letter:true})};
}

export function staffEmail(kind:StaffPreset,{name='',version='',notes='',unsubscribe='',subject='',message=''}:{name?:string;version?:string;notes?:string;unsubscribe?:string;subject?:string;message?:string}):Email{
 if(kind==='custom')return customEmail(subject||'A note from Clem',message,name);
 if(kind==='welcome-m4labs')return m4labsWelcomeEmail(name);
 if(kind==='welcome')return welcomeEmail(name);
 if(kind==='update')return updateEmail(version,notes,unsubscribe);
 return templateEmail(kind);
}
