import fs from 'node:fs';import {randomBytes} from 'node:crypto';
const target='.env.local';let text=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
const defaults={APP_URL:'http://127.0.0.1:5173',SESSION_SECRET:randomBytes(48).toString('base64url'),CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('base64url'),CLEM_ACCESS_PASSWORD:'',DATABASE_URL:'',OPENAI_API_KEY:'',OPENAI_MODEL:'',ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:'',GEMINI_API_KEY:'',GEMINI_MODEL:'',XAI_API_KEY:'',XAI_MODEL:'',R2_ENDPOINT:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',R2_BUCKET:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',CRON_SECRET:randomBytes(32).toString('base64url')};
for(const [name,value] of Object.entries(defaults))if(!new RegExp(`^${name}=`,'m').test(text))text+=`\n${name}=${value}`;
for(const name of ['SESSION_SECRET','CREDENTIAL_ENCRYPTION_KEY','CRON_SECRET'])text=text.split('\n').map(line=>line.trim()===name+'='?name+'='+defaults[name]:line).join('\n');
fs.writeFileSync(target,text.trim()+'\n');console.log('Created missing .env.local configuration entries. Existing values preserved; secrets not displayed.');
