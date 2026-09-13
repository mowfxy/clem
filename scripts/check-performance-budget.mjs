import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
const html=fs.readFileSync('dist/index.html','utf8');
const entry=html.match(/src="([^"]+\.js)"/)[1];
const bytes=gzipSync(fs.readFileSync(path.join('dist',entry))).length;
if(bytes>145000)throw Error(`Initial JavaScript exceeds the 145 KB gzip budget: ${bytes} bytes`);
console.log(`Initial JavaScript: ${bytes} bytes gzip (budget 145000).`);
