import fs from 'node:fs';
import {parse} from 'dotenv';
import {supabaseConfig} from './supabase-emails.mjs';
const env=parse(fs.readFileSync('.env.local'));
if(!env.SUPABASE_ACCESS_TOKEN)throw Error('Add a Supabase management access token to .env.local to apply auth and email settings.');
for(const name of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'])if(!env[name])throw Error(`${name} is required. Supabase Auth must not fall back to its default mail service.`);
const port=Number(env.SMTP_PORT);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('SMTP_PORT must be a valid TCP port.');
const sender=/^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+)\s*>?$/.exec(env.SMTP_FROM.trim());
if(!sender)throw Error('SMTP_FROM must contain a valid sender email address.');
const config={site_url:'https://clem.m4labs.xyz',uri_allow_list:'https://clem.m4labs.xyz/,https://clem.m4labs.xyz/?recovery=1,https://admin.m4labs.xyz/,https://admin.m4labs.xyz/**',security_manual_linking_enabled:true,mfa_totp_enroll_enabled:true,mfa_totp_verify_enabled:true,mailer_secure_email_change_enabled:true,security_update_password_require_reauthentication:true,password_min_length:12};
if(env.GOOGLE_AUTH_CLIENT_ID&&env.GOOGLE_AUTH_CLIENT_SECRET)Object.assign(config,{external_google_enabled:true,external_google_client_id:env.GOOGLE_AUTH_CLIENT_ID,external_google_secret:env.GOOGLE_AUTH_CLIENT_SECRET});
Object.assign(config,{external_email_enabled:true,mailer_autoconfirm:false,smtp_host:env.SMTP_HOST,smtp_port:String(port),smtp_user:env.SMTP_USER,smtp_pass:env.SMTP_PASSWORD,smtp_admin_email:sender[1]});
// Templates, subjects and the sender name (M4 Labs: Supabase is the M4 Labs account platform), shared with
// scripts/apply-email-templates.mjs. Security notifications are emitted after the action succeeds, including in the desktop client.
Object.assign(config,supabaseConfig());
const response=await fetch('https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',{method:'PATCH',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(config)});
if(!response.ok)throw Error('Supabase configuration failed with status '+response.status+'. Check management token permissions.');
const check=await fetch('https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',{headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN}});
if(!check.ok)throw Error('Supabase configuration was submitted but read-back failed with status '+check.status+'.');
const actual=await check.json();
for(const key of ['smtp_host','smtp_port','smtp_user','smtp_admin_email','smtp_sender_name'])if(String(actual[key])!==String(config[key]))throw Error(`Supabase ${key} does not match the shared SMTP configuration.`);
console.log('Supabase production auth SMTP and email templates configured and verified. Credentials were not logged.');
