import {build} from 'esbuild';
import fs from 'node:fs';
const output=process.argv.includes('--root')?'api/index.js':'.deploy/api/index.js';
await fs.promises.mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});
await build({entryPoints:['server/app.ts'],outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
console.log('Bundled unified API and deterministic diagram engine.');
