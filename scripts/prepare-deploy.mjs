import fs from 'node:fs';import path from 'node:path';import './build-api.mjs';
const out='.deploy/site';fs.mkdirSync(out,{recursive:true});
// Clear copied sources first so files deleted locally do not linger in the deployment.
for(const dir of ['src','core','public']){fs.rmSync(path.join(out,dir),{recursive:true,force:true});fs.cpSync(dir,path.join(out,dir),{recursive:true});}
fs.mkdirSync(path.join(out,'desktop'),{recursive:true});fs.copyFileSync('desktop/contracts.ts',path.join(out,'desktop/contracts.ts'));
// The admin portal's demo mode previews staff emails with the server's own layout.
fs.mkdirSync(path.join(out,'server'),{recursive:true});fs.copyFileSync('server/email-layout.ts',path.join(out,'server/email-layout.ts'));
for(const file of ['package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts','vercel.json'])fs.copyFileSync(file,path.join(out,file));
fs.mkdirSync(path.join(out,'api'),{recursive:true});fs.copyFileSync('.deploy/api/index.js',path.join(out,'api/index.js'));
fs.mkdirSync(path.join(out,'.vercel'),{recursive:true});fs.copyFileSync('.vercel/project.json',path.join(out,'.vercel/project.json'));
const config=JSON.parse(fs.readFileSync(path.join(out,'vercel.json'),'utf8'));// The site needs no Kinetra reference bundle (desktop-only), so skip scripts/build-kinetra.mjs.
config.buildCommand='npx tsc -b && npx vite build';fs.writeFileSync(path.join(out,'vercel.json'),JSON.stringify(config,null,2));
console.log('Prepared deployment allowlist: application, fonts, SVG assets and one unified API. No environment files.');
