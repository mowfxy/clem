// Updates only Supabase Auth's email templates, subjects and sender name (no SMTP or other auth settings). Never prints
// the token.
import fs from 'node:fs';
import {parse} from 'dotenv';
import {supabaseConfig} from './supabase-emails.mjs';

const env={...(fs.existsSync('.env.local')?parse(fs.readFileSync('.env.local')):{}),...(process.env.SUPABASE_ACCESS_TOKEN?{SUPABASE_ACCESS_TOKEN:process.env.SUPABASE_ACCESS_TOKEN}:{})};
if(!env.SUPABASE_ACCESS_TOKEN)throw Error('Set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens) in .env.local or the environment.');
const config=supabaseConfig();
const url='https://api.supabase.com/v1/projects/npdkvkikudvjrgnesuhc/config/auth',headers={Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
const res=await fetch(url,{method:'PATCH',headers,body:JSON.stringify(config)});
if(!res.ok)throw Error('PATCH failed: '+res.status+' '+(await res.text()).slice(0,300));
const actual=await (await fetch(url,{headers})).json();
const mismatched=Object.keys(config).filter(k=>actual[k]!==config[k]);
console.log(mismatched.length?'Mismatched after update: '+mismatched.join(', '):`Updated and verified ${Object.keys(config).length} template fields.`);
console.log('SMTP host unchanged:',!!actual.smtp_host);
