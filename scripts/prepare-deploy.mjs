import fs from 'node:fs';import path from 'node:path';import './build-api.mjs';
const out='.deploy/site';fs.mkdirSync(out,{recursive:true});
// Clear copied sources first so files deleted locally do not linger in the deployment.
for(const dir of ['src','core','public']){fs.rmSync(path.join(out,dir),{recursive:true,force:true});fs.cpSync(dir,path.join(out,dir),{recursive:true});}
// The few desktop modules the web app's sources import (types, and PDF redaction for in-place PDF edits).
fs.mkdirSync(path.join(out,'desktop'),{recursive:true});for(const file of ['contracts.ts','pdf-redact.ts'])fs.copyFileSync('desktop/'+file,path.join(out,'desktop',file));
// The admin portal's demo mode previews staff emails with the server's own layout.
fs.mkdirSync(path.join(out,'server'),{recursive:true});fs.copyFileSync('server/email-layout.ts',path.join(out,'server/email-layout.ts'));
for(const file of ['package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts','vercel.json'])fs.copyFileSync(file,path.join(out,file));
// vite.config.ts builds the light theme's twins with this script.
fs.mkdirSync(path.join(out,'scripts'),{recursive:true});fs.copyFileSync('scripts/light-theme.mjs',path.join(out,'scripts/light-theme.mjs'));
fs.mkdirSync(path.join(out,'api'),{recursive:true});fs.copyFileSync('.deploy/api/index.js',path.join(out,'api/index.js'));
fs.mkdirSync(path.join(out,'.vercel'),{recursive:true});fs.copyFileSync('.vercel/project.json',path.join(out,'.vercel/project.json'));
const config=JSON.parse(fs.readFileSync(path.join(out,'vercel.json'),'utf8'));// The site needs no Kinetra reference bundle (desktop-only), so skip scripts/build-kinetra.mjs.
config.buildCommand='npx tsc -b && npx vite build';fs.writeFileSync(path.join(out,'vercel.json'),JSON.stringify(config,null,2));
console.log('Prepared deployment allowlist: application, fonts, SVG assets and one unified API. No environment files.');
