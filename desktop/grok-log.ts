import {open, stat} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Grok prints nothing on stdout while the model thinks, while it writes a long tool call (a 26k-token document took
 * six minutes) or while it retries a dropped connection to xAI, so stdout alone cannot tell a working Grok from a
 * stuck one. Grok's own log (<GROK_HOME>/logs/unified.jsonl) records each model request and retry by process id:
 * this follows the lines of one process, so the answer's inactivity limit waits while a request is in flight and the
 * person is told when the connection is being retried.
 */
export type GrokLogEvent = {kind:'start'|'done'|'retry'|'other';attempt?:number;max?:number;reason?:string};

export function readGrokLogLine(line:string,pid:number):GrokLogEvent|null{
  if(!line.includes('"pid": '+pid)&&!line.includes('"pid":'+pid))return null;
  let entry:any;try{entry=JSON.parse(line);}catch{return null;}
  if(entry?.pid!==pid)return null;
  const msg=String(entry.msg||''),ctx=entry.ctx||{};
  if(msg==='shell.turn.inference_start')return {kind:'start'};
  if(msg==='shell.turn.inference_done')return {kind:'done'};
  if(msg==='shell.turn.inference_retry')return {kind:'retry',attempt:Number(ctx.attempt)||undefined,max:Number(ctx.max_retries)||undefined,reason:typeof ctx.reason==='string'?ctx.reason:undefined};
  return {kind:'other'};
}

/** Follows the log from its current end; `stop` ends it. A missing or rotated log is read again from the start. */
export async function followGrokLog(home:string,pid:number,onEvent:(event:GrokLogEvent)=>void,every=3000){
  const file=join(home,'logs','unified.jsonl');
  let offset=await stat(file).then(s=>s.size,()=>0),rest='',stopped=false,busy=false;
  const poll=async()=>{
    if(busy||stopped)return;busy=true;
    try{
      const size=await stat(file).then(s=>s.size,()=>-1);
      if(size<0)return;
      if(size<offset){offset=0;rest='';}
      if(size===offset)return;
      const handle=await open(file,'r');
      try{
        // At most 4 MB a poll: a burst of other Grok processes' lines cannot hold the main process up.
        const length=Math.min(size-offset,4_000_000);
        const buffer=Buffer.alloc(length);
        const {bytesRead}=await handle.read(buffer,0,length,offset);
        offset+=bytesRead;
        const lines=(rest+buffer.subarray(0,bytesRead).toString('utf8')).split('\n');
        rest=lines.pop()||'';
        if(rest.length>1_000_000)rest='';
        for(const line of lines){const event=readGrokLogLine(line,pid);if(event&&!stopped)onEvent(event);}
      }finally{await handle.close();}
    }catch{/* the log is best effort */}
    finally{busy=false;}
  };
  const timer=setInterval(()=>void poll(),every);
  return {stop(){stopped=true;clearInterval(timer);}};
}
