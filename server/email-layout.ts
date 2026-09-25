// Shared by scripts/build-emails.mjs (templates handed to Supabase) and server/emails.ts (mail the server sends itself).
export const BASE='https://mowrai.com',APP='https://mowrai.com/#/app';
const LINK='{{ .ConfirmationURL }}';
const sans='Arial,Helvetica,sans-serif',serif="Georgia,'Times New Roman',serif";
export type EmailParts={art?:string;title:string;body:string;label?:string;url?:string;note?:string;code?:string;preheader?:string;footer?:string};
/** The one layout every Mowr email uses: animated ink art, rising text, a glowing button. `footer` adds a line (e.g. unsubscribe) under the card. */
export function layout({art,title,body,label,url,note,code,preheader=body,footer}:EmailParts){
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
<tr><td style="padding:22px 8px 0;text-align:center;font-family:${sans};font-size:12px;line-height:1.8;color:#6f6e68">Your space to think.<br><a href="mailto:support@mowrai.com" style="color:#a3a3a0;text-decoration:none">support@mowrai.com</a> &nbsp;·&nbsp; <a href="${BASE}" style="color:#a3a3a0;text-decoration:none">mowrai.com</a>${footer?`<br>${footer}`:''}</td></tr>
</table></td></tr></table></body></html>`;
}

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type Email={subject:string;text:string;html:string};

export function welcomeEmail(name:string):Email{
 const first=name.trim().split(/\s+/)[0]||'there';
 const body='Your space to think is ready. Bring your notes, slides and questions, and Mowr turns them into answers, flashcards and worksheets.';
 const note='Tip: make a subject for each course and drop your files in. Mowr answers from them.';
 return {subject:'Welcome to Mowr',text:`Welcome to Mowr, ${first}.\n\n${body}\n\nOpen Mowr: ${APP}\n\n${note}`,
  html:layout({art:'sprout',title:`Welcome to Mowr, ${escape(first)}`,body,label:'Open Mowr',url:APP,note})};
}

/** `notes` is one change per line. `unsubscribe` is this person's signed opt-out link. */
export function updateEmail(version:string,notes:string,unsubscribe:string):Email{
 const lines=notes.split(/\r?\n/).map(l=>l.replace(/^[-*•]\s*/,'').trim()).filter(Boolean).slice(0,8);
 const download=BASE+'/download/windows';
 const note='Run the installer and it replaces your current version. Your chats, files and subjects stay exactly as they are.';
 const intro='A new version of Mowr is ready.';
 return {subject:`Mowr ${version} is here`,
  text:`Mowr ${version} is here.\n\n${lines.map(l=>'- '+l).join('\n')||intro}\n\nDownload the update: ${download}\n\n${note}\n\nStop update emails: ${unsubscribe}`,
  html:layout({art:'build',title:`Mowr ${escape(version)} is here`,body:lines.length?`<span style="display:inline-block;text-align:left">${lines.map(l=>'•&nbsp; '+escape(l)).join('\n')}</span>`:intro,preheader:escape(lines[0]||intro),label:'Download the update',url:download,note,
   footer:`<a href="${escape(unsubscribe)}" style="color:#6f6e68;text-decoration:underline">Stop update emails</a>`})};
}

