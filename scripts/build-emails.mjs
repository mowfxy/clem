// Builds every transactional email from one layout (server/email-layout.ts). The only image is Clem's mark, a GIF with a
// blinking cursor from scripts/build-email-art.mjs, served from clem.m4labs.xyz/email/.
// CSS entrance animations are a progressive enhancement: clients that strip <style> show everything at once.
import fs from 'node:fs';
import {layout,templates,welcomeEmail,updateEmail} from '../server/email-layout.ts';
fs.mkdirSync('emails',{recursive:true});

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,'/').replace(/^(?!\/)/,'/')}`||process.argv[1]?.endsWith('build-emails.mjs')){
 for(const [file,[cmd,title,body,label,url,note,code]] of Object.entries(templates))fs.writeFileSync(`emails/${file}.html`,layout({cmd,title,body,label,url,note,code}));
 // Previews of the two emails the server sends itself; the live copy is built per person in server/email-layout.ts.
 fs.writeFileSync('emails/welcome.html',welcomeEmail('Sam').html);
 fs.writeFileSync('emails/app-update.html',updateEmail('0.3.0','Flashcards now follow your exam date.\nRecent files look tidier.\nRenaming files keeps the extension.','https://clem.m4labs.xyz/api/email/unsubscribe').html);
 console.log('Prepared '+(Object.keys(templates).length+2)+' email templates.');
}
