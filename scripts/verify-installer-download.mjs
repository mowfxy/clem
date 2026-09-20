import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({acceptDownloads:true});
 await page.goto('https://mowrai.com');
 const event=page.waitForEvent('download',{timeout:60000});
 await page.getByRole('link',{name:/Download Mowr/}).first().click();
 const download=await event;
 assert.equal(download.suggestedFilename(),'Mowr-Setup-0.2.0-preview.2.exe');
 const path=await download.path();assert.ok(path);assert.equal(await download.failure(),null);
 const local=await readFile('release/Mowr-Setup-0.2.0-preview.2.exe');
 const downloaded=await readFile(path);
 assert.equal(createHash('sha256').update(downloaded).digest('hex'),createHash('sha256').update(local).digest('hex'));
 console.log('PASS homepage click downloads complete installer; SHA-256 matches packaged release ('+(await stat(path)).size+' bytes)');
}finally{await browser.close();}
