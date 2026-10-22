// Copies the newest Windows installer from release/ to Installer/ (easy to find) with its checksum,
// With --site, also records version, size and SHA-256 in public/desktop-release.json for the download page;
// only do that after the installer is uploaded, or the website would advertise a file that isn't live yet.
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';

const RELEASE=process.env.CLEM_RELEASE_DIR||'release';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const name=`Clem-Setup-${pkg.version}.exe`;
const source=join(RELEASE,name);
const info=await stat(source).catch(()=>{throw Error(`${source} not found. Run npm run desktop:installer first.`);});
const sha256=await new Promise((resolve,reject)=>{const hash=createHash('sha256');createReadStream(source).on('data',d=>hash.update(d)).on('end',()=>resolve(hash.digest('hex'))).on('error',reject);});

// Older builds in release/ are ~200 MB each and never needed again once a newer one exists.
for(const old of await readdir(RELEASE))if(/^Clem-Setup-.*\.exe(\.blockmap)?$/.test(old)&&!old.startsWith(name))await rm(join(RELEASE,old));
await mkdir('Installer',{recursive:true});
for(const old of await readdir('Installer'))if(/^Clem-Setup-.*\.exe$/.test(old)&&old!==name)await rm(join('Installer',old));
await copyFile(source,join('Installer',name));
await writeFile(join('Installer','SHA256.txt'),`${sha256}  ${name}\n`);
await writeFile(join('Installer','README.txt'),[
  `Clem ${pkg.version} for Windows (64-bit)`,
  '',
  `Installer: ${name}`,
  `Size:      ${Math.round(info.size/1048576)} MB`,
  `SHA-256:   ${sha256}`,
  '',
  'Double-click the installer. Preview builds are not code-signed, so Windows SmartScreen may show',
  '"Windows protected your PC": choose More info, then Run anyway.',
  '',
  'Verify the file in PowerShell:  Get-FileHash .\\'+name,
  'Publish: upload the .exe with release/latest.yml and the .exe.blockmap to the clem-releases GitHub release',
  '(installed copies of Clem update themselves from latest.yml), run npm run installer:release',
  '(checks the upload, then updates desktop-release.json and the /download/windows redirect) and deploy the website.',
  '',
].join('\r\n'));

if(process.argv.includes('--site')){
// The website must only ever point at an installer that is already live on clem-releases:
// check the GitHub asset before touching either file, then keep both in agreement.
const asset=`https://github.com/mowfxy/clem-releases/releases/download/v${pkg.version}/${name}`;
const live=await fetch(asset,{method:'HEAD',redirect:'follow'}).catch(e=>({ok:false,status:e.message}));
if(!live.ok)throw Error(`${asset} is not live (${live.status}). Upload ${name} to the v${pkg.version} release on mowfxy/clem-releases first; nothing was changed.`);
const liveSize=Number(live.headers.get('content-length'));
if(liveSize&&liveSize!==info.size)throw Error(`The uploaded ${name} is ${liveSize} bytes but the local build is ${info.size}. Re-upload it; nothing was changed.`);
// Installed copies update from latest.yml on the newest release (desktop/app-update.ts): it must be there and name this build.
const feed=await fetch(`https://github.com/mowfxy/clem-releases/releases/download/v${pkg.version}/latest.yml`,{redirect:'follow'}).then(r=>r.ok?r.text():'').catch(()=>'');
const local=await readFile(join(RELEASE,'latest.yml'),'utf8').catch(()=>'');
if(!feed||feed.trim()!==local.trim()||!feed.includes(`version: ${pkg.version}`))throw Error(`latest.yml on the v${pkg.version} release is missing or differs from ${join(RELEASE,'latest.yml')}. Upload it so installed copies can update; nothing was changed.`);
const vercelFile='vercel.json',vercel=await readFile(vercelFile,'utf8');
const redirect=JSON.parse(vercel).redirects?.find(r=>r.source==='/download/windows');
if(!redirect)throw Error(`${vercelFile} has no /download/windows redirect; nothing was changed.`);
const releaseFile='public/desktop-release.json';
const release=JSON.parse(await readFile(releaseFile,'utf8').catch(()=>'{}'));
Object.assign(release,{version:pkg.version,url:'/download/windows',signed:process.env.CLEM_REQUIRE_SIGNING==='true',sha256,size:info.size,released:new Date(info.mtime).toISOString().slice(0,10)});
// Replace only the destination string so the rest of vercel.json keeps its formatting.
const updated=vercel.replace(JSON.stringify(redirect.destination),JSON.stringify(asset));
if(JSON.parse(updated).redirects.find(r=>r.source==='/download/windows').destination!==asset)throw Error(`Could not update the /download/windows redirect in ${vercelFile}; nothing was changed.`);
await writeFile(vercelFile,updated);
await writeFile(releaseFile,JSON.stringify(release)+'\n');
console.log(`Updated ${releaseFile} and the /download/windows redirect in ${vercelFile} → ${asset}. Deploy the website to publish.`);
}
console.log(`Installer ready: Installer\\${name} (${Math.round(info.size/1048576)} MB)\nSHA-256 ${sha256}`);
