import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const name=`Clem-Setup-${version}.exe`;
const browser=await chromium.launch();
try{
 const page=await browser.newPage({acceptDownloads:true});
 await page.goto('https://clem.m4labs.xyz/#/download');
 const event=page.waitForEvent('download',{timeout:60000});
 await page.getByRole('link',{name:/Download for Windows/}).first().click();
 const download=await event;
 assert.equal(download.suggestedFilename(),name);
 const path=await download.path();assert.ok(path);assert.equal(await download.failure(),null);
 const local=await readFile('release/'+name);
 const downloaded=await readFile(path);
 assert.equal(createHash('sha256').update(downloaded).digest('hex'),createHash('sha256').update(local).digest('hex'));
 console.log('PASS download page click downloads complete installer; SHA-256 matches packaged release ('+(await stat(path)).size+' bytes)');
}finally{await browser.close();}
