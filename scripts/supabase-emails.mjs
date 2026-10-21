// What Supabase Auth sends, as auth config fields: every template from emails/ (built by scripts/build-emails.mjs),
// its subject and the sender name. Used by scripts/apply-email-templates.mjs and scripts/configure-supabase.mjs.
import fs from 'node:fs';
import {templates,supabaseTemplates,supabaseNotices,SENDER_NAME} from '../server/email-layout.ts';

export function supabaseConfig(){
 const config={smtp_sender_name:SENDER_NAME};
 for(const [key,file] of Object.entries(supabaseTemplates)){
  config['mailer_templates_'+key+'_content']=fs.readFileSync('emails/'+file+'.html','utf8');
  config['mailer_subjects_'+key]=templates[file].subject;
 }
 for(const [key,file] of Object.entries(supabaseNotices)){
  config['mailer_notifications_'+key+'_enabled']=true;
  config['mailer_templates_'+key+'_notification_content']=fs.readFileSync('emails/'+file+'.html','utf8');
  config['mailer_subjects_'+key+'_notification']=templates[file].subject;
 }
 return config;
}
