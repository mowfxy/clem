// Copies the newest Windows installer from release/ to Installer/ (easy to find) with its checksum,
// With --site, also records version, size and SHA-256 in public/desktop-release.json for the download page;
// only do that after the installer is uploaded, or the website would advertise a file that isn't live yet.
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const name=`Mowr-Setup-${pkg.version}.exe`;
const source=join('release',name);
const info=await stat(source).catch(()=>{throw Error(`${source} not found. Run npm run desktop:installer first.`);});
const sha256=await new Promise((resolve,reject)=>{const hash=createHash('sha256');createReadStream(source).on('data',d=>hash.update(d)).on('end',()=>resolve(hash.digest('hex'))).on('error',reject);});

// Older builds in release/ are ~200 MB each and never needed again once a newer one exists.
for(const old of await readdir('release'))if(/^Mowr-Setup-.*\.exe(\.blockmap)?$/.test(old)&&!old.startsWith(name))await rm(join('release',old));
await mkdir('Installer',{recursive:true});
for(const old of await readdir('Installer'))if(/^Mowr-Setup-.*\.exe$/.test(old)&&old!==name)await rm(join('Installer',old));
await copyFile(source,join('Installer',name));
await writeFile(join('Installer','SHA256.txt'),`${sha256}  ${name}\n`);
await writeFile(join('Installer','README.txt'),[
  `Mowr ${pkg.version} for Windows (64-bit)`,
  '',
  `Installer: ${name}`,
  `Size:      ${Math.round(info.size/1048576)} MB`,
  `SHA-256:   ${sha256}`,
  '',
  'Double-click the installer. Preview builds are not code-signed, so Windows SmartScreen may show',
  '"Windows protected your PC": choose More info, then Run anyway.',
  '',
  'Verify the file in PowerShell:  Get-FileHash .\\'+name,
  'Publish: upload the .exe to the mowr-releases GitHub release, then update the /download/windows',
  'redirect in vercel.json and deploy the website.',
  '',
].join('\r\n'));

if(process.argv.includes('--site')){
const releaseFile='public/desktop-release.json';
const release=JSON.parse(await readFile(releaseFile,'utf8').catch(()=>'{}'));
Object.assign(release,{version:pkg.version,url:'/download/windows',sha256,size:info.size,released:new Date(info.mtime).toISOString().slice(0,10)});
await writeFile(releaseFile,JSON.stringify(release)+'\n');
console.log('Updated '+releaseFile+'. Point /download/windows in vercel.json at the uploaded file too.');
}
console.log(`Installer ready: Installer\\${name} (${Math.round(info.size/1048576)} MB)\nSHA-256 ${sha256}`);
