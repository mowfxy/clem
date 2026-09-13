import fs from 'node:fs';
import {parse} from 'dotenv';
const env=parse(fs.readFileSync('.env.local'));
if(!env.SUPABASE_ACCESS_TOKEN)throw Error('Add a Supabase management access token to .env.local to apply auth and email settings.');
const config={site_url:'https://mowrai.com',uri_allow_list:'https://mowrai.com/,https://mowrai.com/?recovery=1',security_manual_linking_enabled:true,mfa_totp_enroll_enabled:true,mfa_totp_verify_enabled:true,mailer_secure_email_change_enabled:true,password_min_length:12};
if(env.GOOGLE_AUTH_CLIENT_ID&&env.GOOGLE_AUTH_CLIENT_SECRET)Object.assign(config,{external_google_enabled:true,external_google_client_id:env.GOOGLE_AUTH_CLIENT_ID,external_google_secret:env.GOOGLE_AUTH_CLIENT_SECRET});
if(env.SMTP_PASSWORD)Object.assign(config,{smtp_host:env.SMTP_HOST,smtp_port:env.SMTP_PORT,smtp_user:env.SMTP_USER,smtp_pass:env.SMTP_PASSWORD,smtp_admin_email:'support@mowrai.com',smtp_sender_name:'Mowr'});
for(const [key,file] of Object.entries({confirmation:'confirm-signup',recovery:'reset-password',magic_link:'magic-link',email_change:'change-email',invite:'invite',reauthentication:'reauthentication'})){config['mailer_templates_'+key+'_content']=fs.readFileSync('emails/'+file+'.html','utf8');}
const response=await fetch('https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',{method:'PATCH',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(config)});
if(!response.ok)throw Error('Supabase configuration failed with status '+response.status+'. Check management token permissions.');
console.log('Supabase production auth and email templates configured. Credentials were not logged.');
