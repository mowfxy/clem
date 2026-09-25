// Stands in for Google's `agy` in tests, following its documented headless interface.
// FAKE_AGY=signed-out | quota | no-stream | ok (default)
import {argv,stdin,stdout,stderr,exit,env} from 'node:process';
const args=argv.slice(2),mode=env.FAKE_AGY||'ok';
if(args[0]==='--version'){stdout.write('agy 1.4.0\n');exit(0);}
if(args[0]==='models'){if(mode==='signed-out'){stderr.write('authentication required\n');exit(1);}stdout.write('gemini-3.8-flash-high\ngemini-3.8-flash-low\nclaude-sonnet-4.6-thinking\n');exit(0);}
if(args.includes('--dangerously-skip-permissions')){stderr.write('Mowr must never pass this\n');exit(9);}
let input='';stdin.on('data',d=>input+=d);stdin.on('end',()=>{
  const model=args[args.indexOf('--model')+1];
  if(mode==='quota'){stdout.write(JSON.stringify({status:'ERROR',error:'RESOURCE_EXHAUSTED: quota exceeded'})+'\n');exit(1);}
  if(args.includes('--input-format')){
    if(mode==='no-stream'){stderr.write('unknown flag --input-format\n');exit(1);}
    const prompt=JSON.parse(input.trim()).message.content;
    stdout.write(JSON.stringify({conversation_id:'c1',status:'SUCCESS',response:`[${model}] ${prompt}`,num_turns:1})+'\n');exit(0);
  }
  const prompt=args[args.indexOf('-p')+1];
  stdout.write(JSON.stringify({status:'SUCCESS',response:`[${model}] via -p ${prompt}`})+'\n');exit(0);
});
