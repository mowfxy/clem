import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {ClaudeProvider} from '../../desktop/claude.ts';
import {NATIVE_NOTE} from '../../desktop/kinetra-mcp.ts';
import {looksSecret,explicitRemember,rememberedWords,learnMemories} from '../../desktop/memory.ts';

test('A Claude Code that exits without reading a large message fails the step instead of throwing in the main process',async()=>{
  const provider:any=new ClaudeProvider('fixture',mkdtempSync(join(tmpdir(),'claude-audit-')));
  provider.status=async()=>({connected:true});
  provider.readUsage=async()=>({});
  // A real process that never reads its input (as Claude Code does when it refuses a flag), so the pending write fails.
  provider.start=async()=>spawn(process.execPath,['-e','setTimeout(()=>{process.stderr.write("something went wrong");process.exit(1)},150)'],{stdio:'pipe',windowsHide:true});
  const uncaught:unknown[]=[];
  const note=(error:unknown)=>uncaught.push(error);
  process.on('uncaughtException',note);
  try{
    await assert.rejects(provider.run('one','x'.repeat(2_000_000),'claude:sonnet',undefined,()=>{}),/Claude could not complete this request/);
    await new Promise(resolve=>setTimeout(resolve,200));
  }finally{process.off('uncaughtException',note);}
  assert.deepEqual(uncaught,[]);
});

test('A step run again without --system-prompt-file carries the native-tool note once',async()=>{
  const provider:any=new ClaudeProvider('fixture',mkdtempSync(join(tmpdir(),'claude-audit-')));
  provider.status=async()=>({connected:true});
  provider.readUsage=async()=>({});
  const inputs:string[]=[];
  let starts=0;
  provider.start=async()=>{
    const first=starts++===0;
    const child:any=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    let input='';
    child.stdin.on('data',(part:Buffer)=>input+=part.toString());
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      inputs.push(input);
      if(first){child.stderr.write("error: unknown option '--system-prompt-file'");setTimeout(()=>child.emit('close',1),5);return;}
      child.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'Done',is_error:false})+'\n');
      setTimeout(()=>child.emit('close',0),5);
    }));
    return child;
  };
  const events:any[]=[];
  await provider.run('one','The request','claude:sonnet',undefined,(event:any)=>events.push(event),[],undefined,async()=>({result:{},pictures:[]}),{system:'MOWR RULES'});
  assert.equal(starts,2);
  const text=JSON.parse(inputs[1].trim()).message.content.find((part:any)=>part.type==='text').text as string;
  assert.equal(text.split(NATIVE_NOTE).length-1,1);
  assert.ok(text.includes('MOWR RULES\n\nThe request'));
  assert.equal(events.find(event=>event.type==='delta').text,'Done');
});

test('solveCircuit gives each named voltage in volts whatever its name starts with',async()=>{
  // The adapters import Kinetra's sources without extensions: bundled as the worker is (tests/desktop/harness.test.ts).
  const out=join(mkdtempSync(join(tmpdir(),'adapters-')),'adapters.cjs');
  await build({entryPoints:['desktop/kinetra-adapters.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'warning'});
  const {solveCircuit}=createRequire(import.meta.url)(out);
  const solved=solveCircuit({elements:[
    {kind:'voltage-source',from:'0',to:'1',value:10,unit:'V'},
    {kind:'resistor',from:'1',to:'2',label:'R_1',value:2,unit:'Ω',voltage:'$U_1$'},
    {kind:'resistor',from:'2',to:'0',label:'R_2',value:3,unit:'Ω',voltage:'ΔV',current:'i_o'},
  ]} as any);
  const line=(name:string)=>solved.summary.find((l:string)=>l.startsWith(name+' = '))!;
  assert.match(line('$U_1$'),/ V$/);
  assert.match(line('ΔV'),/ V$/);
  assert.match(line('i_o'),/ A$/);
});

test('Generic keys and tokens never become memory, even when the person asks',()=>{
  for(const m of ['My API key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0','access token: abcdef0123456789','The secret key = s3cr3t-v4lu3','my recovery phrase is apple banana cherry'])assert.ok(looksSecret(m),m);
  for(const m of ['The user prefers short answers.','The key point is clarity.','The user studies token economies.'])assert.ok(!looksSecret(m),m);
  const said='Remember my api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0';
  assert.ok(explicitRemember(said));
  assert.deepEqual(rememberedWords(said),[]);
  const state=learnMemories({enabled:true,records:[]},[{key:'note:api',text:'The user\'s api key is 9f8e7d6c5b4a39281706f5e4d3c2b1a0',kind:'fact',about:'user'}],{scope:'space:1',sourceId:'chat:1',explicit:true});
  assert.equal(state.records.length,0);
});
