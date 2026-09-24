import fs from 'node:fs';
import {parse} from 'dotenv';
const env=parse(fs.readFileSync('.env.local'));
if(!env.SUPABASE_ACCESS_TOKEN)throw Error('Add a Supabase management access token to .env.local to apply auth and email settings.');
for(const name of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'])if(!env[name])throw Error(`${name} is required. Supabase Auth must not fall back to its default mail service.`);
const port=Number(env.SMTP_PORT);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('SMTP_PORT must be a valid TCP port.');
const sender=/^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+)\s*>?$/.exec(env.SMTP_FROM.trim());
if(!sender)throw Error('SMTP_FROM must contain a valid sender email address.');
const config={site_url:'https://mowrai.com',uri_allow_list:'https://mowrai.com/,https://mowrai.com/?recovery=1',security_manual_linking_enabled:true,mfa_totp_enroll_enabled:true,mfa_totp_verify_enabled:true,mailer_secure_email_change_enabled:true,password_min_length:12};
if(env.GOOGLE_AUTH_CLIENT_ID&&env.GOOGLE_AUTH_CLIENT_SECRET)Object.assign(config,{external_google_enabled:true,external_google_client_id:env.GOOGLE_AUTH_CLIENT_ID,external_google_secret:env.GOOGLE_AUTH_CLIENT_SECRET});
Object.assign(config,{external_email_enabled:true,mailer_autoconfirm:false,smtp_host:env.SMTP_HOST,smtp_port:port,smtp_user:env.SMTP_USER,smtp_pass:env.SMTP_PASSWORD,smtp_admin_email:sender[1],smtp_sender_name:'Mowr'});
for(const [key,file] of Object.entries({confirmation:'confirm-signup',recovery:'reset-password',magic_link:'magic-link',email_change:'change-email',invite:'invite',reauthentication:'reauthentication'})){config['mailer_templates_'+key+'_content']=fs.readFileSync('emails/'+file+'.html','utf8');}
// Security notifications are emitted by Supabase after the action succeeds,
// including actions performed by the desktop client.
for(const [key,file] of Object.entries({password_changed:'password-changed',email_changed:'email-changed',identity_linked:'identity-linked',identity_unlinked:'identity-unlinked',mfa_factor_enrolled:'mfa-enabled',mfa_factor_unenrolled:'mfa-disabled'})) {
 config['mailer_notifications_'+key+'_enabled']=true;
 config['mailer_templates_'+key+'_notification_content']=fs.readFileSync('emails/'+file+'.html','utf8');
}
const response=await fetch('https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',{method:'PATCH',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(config)});
if(!response.ok)throw Error('Supabase configuration failed with status '+response.status+'. Check management token permissions.');
const check=await fetch('https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',{headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN}});
if(!check.ok)throw Error('Supabase configuration was submitted but read-back failed with status '+check.status+'.');
const actual=await check.json();
for(const key of ['smtp_host','smtp_port','smtp_user','smtp_admin_email','smtp_sender_name'])if(String(actual[key])!==String(config[key]))throw Error(`Supabase ${key} does not match the shared SMTP configuration.`);
console.log('Supabase production auth SMTP and email templates configured and verified. Credentials were not logged.');
