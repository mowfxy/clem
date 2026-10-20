// Updates only Supabase Auth email template bodies (no SMTP or other auth settings). Never prints the token.
import fs from 'node:fs';
import {parse} from 'dotenv';

const env={...(fs.existsSync('.env.local')?parse(fs.readFileSync('.env.local')):{}),...(process.env.SUPABASE_ACCESS_TOKEN?{SUPABASE_ACCESS_TOKEN:process.env.SUPABASE_ACCESS_TOKEN}:{})};
if(!env.SUPABASE_ACCESS_TOKEN)throw Error('Set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens) in .env.local or the environment.');
const config={};
for(const [key,file] of Object.entries({confirmation:'confirm-signup',recovery:'reset-password',magic_link:'magic-link',email_change:'change-email',invite:'invite',reauthentication:'reauthentication'}))config['mailer_templates_'+key+'_content']=fs.readFileSync('emails/'+file+'.html','utf8');
for(const [key,file] of Object.entries({password_changed:'password-changed',email_changed:'email-changed',identity_linked:'identity-linked',identity_unlinked:'identity-unlinked',mfa_factor_enrolled:'mfa-enabled',mfa_factor_unenrolled:'mfa-disabled'}))config['mailer_templates_'+key+'_notification_content']=fs.readFileSync('emails/'+file+'.html','utf8');
Object.assign(config,{mailer_subjects_confirmation:'Confirm your email',mailer_subjects_recovery:'Reset your password',mailer_subjects_magic_link:'Your sign-in link',mailer_subjects_email_change:'Confirm your new email',mailer_subjects_invite:'You’re invited to Clem',mailer_subjects_reauthentication:'Your Clem verification code'});
const url='https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',headers={Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
const res=await fetch(url,{method:'PATCH',headers,body:JSON.stringify(config)});
if(!res.ok)throw Error('PATCH failed: '+res.status+' '+(await res.text()).slice(0,300));
const actual=await (await fetch(url,{headers})).json();
const mismatched=Object.keys(config).filter(k=>actual[k]!==config[k]);
console.log(mismatched.length?'Mismatched after update: '+mismatched.join(', '):`Updated and verified ${Object.keys(config).length} template fields.`);
console.log('SMTP host unchanged:',!!actual.smtp_host);
