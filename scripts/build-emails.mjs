// Builds every transactional email from one layout. Artwork comes from scripts/build-email-art.mjs
// (animated GIFs of the app's ink scenes and the Mowr mark, served from mowrai.com/email/).
// CSS entrance animations are a progressive enhancement: clients that strip <style> show everything at once.
import fs from 'node:fs';
import {layout,APP,welcomeEmail,updateEmail} from '../server/email-layout.ts';
fs.mkdirSync('emails',{recursive:true});
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
 'account-deletion':['box','We received your deletion request','We’ll verify it before anything is removed.','','','Didn’t ask for this? Contact support.'],
};

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,'/').replace(/^(?!\/)/,'/')}`||process.argv[1]?.endsWith('build-emails.mjs')){
 for(const [file,[art,title,body,label,url,note,code]] of Object.entries(templates))fs.writeFileSync(`emails/${file}.html`,layout({art,title,body,label,url,note,code}));
 // Previews of the two emails the server sends itself; the live copy is built per person in server/email-layout.ts.
 fs.writeFileSync('emails/welcome.html',welcomeEmail('Sam').html);
 fs.writeFileSync('emails/app-update.html',updateEmail('0.3.0','Flashcards now follow your exam date.\nRecent files look tidier.\nRenaming files keeps the extension.','https://mowrai.com/api/email/unsubscribe').html);
 console.log('Prepared '+(Object.keys(templates).length+2)+' email templates.');
}
