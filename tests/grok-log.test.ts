import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {followGrokLog, readGrokLogLine, type GrokLogEvent} from '../desktop/grok-log.ts';
import {redact} from '../desktop/diagnostics.ts';
import {LOGS_MARK, splitLogs} from '../core/support-logs.ts';

const line=(pid:number,msg:string,ctx:Record<string,unknown>={})=>JSON.stringify({ts:new Date().toISOString(),src:'shell',pid,lvl:'info',msg,ctx});

test('Grok log lines of one process are read as model requests and retries', () => {
  assert.deepEqual(readGrokLogLine(line(8128,'shell.turn.inference_start',{loop_index:2}),8128),{kind:'start'});
  assert.deepEqual(readGrokLogLine(line(8128,'shell.turn.inference_done'),8128),{kind:'done'});
  assert.deepEqual(readGrokLogLine(line(8128,'shell.turn.inference_retry',{attempt:2,max_retries:15,reason:'http2 error: keep-alive timed out'}),8128),{kind:'retry',attempt:2,max:15,reason:'http2 error: keep-alive timed out'});
  assert.deepEqual(readGrokLogLine(line(8128,'shell.tool.exec_done'),8128),{kind:'other'});
  // Another Grok (a second chat, the status check) is not this answer.
  assert.equal(readGrokLogLine(line(32548,'shell.turn.inference_start'),8128),null);
  assert.equal(readGrokLogLine('not json "pid": 8128',8128),null);
});

test('the follower reads only lines written after it starts, across partial writes and a rotated log', async () => {
  const home=mkdtempSync(join(tmpdir(),'grok-home-'));
  mkdirSync(join(home,'logs'));
  const file=join(home,'logs','unified.jsonl');
  writeFileSync(file,line(7,'shell.turn.inference_start')+'\n');
  const seen:GrokLogEvent[]=[];
  const follow=await followGrokLog(home,7,event=>seen.push(event),20);
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const retry=line(7,'shell.turn.inference_retry',{attempt:1,max_retries:15});
  appendFileSync(file,retry.slice(0,30));
  await wait(80);
  assert.deepEqual(seen,[],'a half-written line waits for its end');
  appendFileSync(file,retry.slice(30)+'\n'+line(9,'shell.turn.inference_done')+'\n');
  await wait(80);
  assert.deepEqual(seen,[{kind:'retry',attempt:1,max:15,reason:undefined}]);
  writeFileSync(file,line(7,'shell.turn.inference_done')+'\n');
  await wait(80);
  assert.deepEqual(seen.at(-1),{kind:'done'});
  follow.stop();
  appendFileSync(file,line(7,'shell.turn.inference_start')+'\n');
  await wait(80);
  assert.equal(seen.length,2,'nothing arrives after stop');
});

test('diagnostics leave out tokens, keys and the user folder', () => {
  const text=redact(`at ${join(homedir(),'AppData','x.log')} key_prefix: "SK6LNGBwMfaA" Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk sbp_fc5400e9eca177b4b0aed8f`);
  assert.ok(!text.includes(homedir()));
  assert.ok(!text.includes('SK6LNGBwMfaA'));
  assert.ok(!text.includes('eyJhbGci'));
  assert.ok(!text.includes('fc5400e9'));
  assert.ok(text.includes('~'));
});

test('a report\'s logs are split from the message the person wrote', () => {
  assert.deepEqual(splitLogs('What happened: it broke'),{text:'What happened: it broke',logs:''});
  assert.deepEqual(splitLogs('What happened: it broke'+LOGS_MARK+'Mowr 0.2.0'),{text:'What happened: it broke',logs:'Mowr 0.2.0'});
});
