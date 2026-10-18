import type {ChildProcessWithoutNullStreams} from 'node:child_process';

// The Agent Client Protocol (agentclientprotocol.com) over a child's stdin and stdout: newline-delimited JSON-RPC 2.0.
// Mowr is the client. It sends requests (initialize, session/new, session/prompt…) and answers the agent's own requests
// (session/request_permission) itself, so nothing waits on a person for a tool the answer's rules already decide.

/** An error the agent answered a request with: its JSON-RPC code, message and data. */
export class AcpError extends Error {
  code:number;data:unknown;method:string;
  constructor(method:string,error:{code?:number;message?:string;data?:unknown}){super(String(error?.message||'ACP error'));this.code=Number(error?.code)||0;this.data=error?.data;this.method=method;}
}
/** The agent's process ended (or was ended) with this request still open. */
export class AcpClosed extends Error {}

/** The longest line read from the agent (a reply that quotes a large file stays well under it). */
const MAX_LINE=64_000_000;

export class AcpConnection {
  private child:ChildProcessWithoutNullStreams;
  private next=1;
  private pending=new Map<number,{method:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>}>();
  private buffer='';
  closed=false;
  /** Every notification (session/update…), and every line at all: either restarts an answer's inactivity limit. */
  onNotification:(method:string,params:any)=>void=()=>{};
  onActivity:()=>void=()=>{};
  /** The agent's own requests; whatever this throws goes back as a JSON-RPC error. */
  onRequest:(method:string,params:any)=>Promise<unknown>=async()=>{throw Object.assign(Error('Not supported'),{code:-32601});};
  onClose:(code:number|null)=>void=()=>{};
  constructor(child:ChildProcessWithoutNullStreams){
    this.child=child;
    // Decoded as a stream: a character split between two chunks (é, —, Arabic) must not turn into �.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(part:string)=>{
      this.onActivity();
      this.buffer+=part;
      if(this.buffer.length>MAX_LINE&&this.buffer.indexOf('\n')<0){this.buffer='';this.end(null);child.kill();return;}
      let nl;
      while((nl=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,nl).trim();this.buffer=this.buffer.slice(nl+1);if(line)this.read(line);}
    });
    child.on('close',code=>this.end(code));
    child.on('error',()=>this.end(null));
    child.stdin.on('error',()=>{});
  }
  private read(line:string){
    let message:any;try{message=JSON.parse(line);}catch{return;}
    if(!message||typeof message!=='object')return;
    if(message.method&&message.id!==undefined){void this.answer(message.id,message.method,message.params);return;}
    if(message.method){try{this.onNotification(message.method,message.params);}catch{}return;}
    const waiting=this.pending.get(message.id);
    if(!waiting)return;
    this.pending.delete(message.id);clearTimeout(waiting.timer);
    if(message.error)waiting.reject(new AcpError(waiting.method,message.error));else waiting.resolve(message.result);
  }
  private async answer(id:unknown,method:string,params:any){
    try{this.write({id,result:(await this.onRequest(method,params))??{}});}
    catch(error){const e=error as {code?:number;message?:string};this.write({id,error:{code:typeof e?.code==='number'?e.code:-32603,message:String(e?.message||'Failed')}});}
  }
  private write(message:object){if(!this.closed)this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
  /** One request. `timeout` (ms) fails it when the agent has not answered by then; none waits for as long as it takes. */
  request<T=any>(method:string,params:unknown,timeout?:number):Promise<T>{
    if(this.closed)return Promise.reject(new AcpClosed('The agent is not running.'));
    const id=this.next++;
    return new Promise<T>((resolve,reject)=>{
      const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(new AcpError(method,{code:-32001,message:method+' timed out'}));},timeout):undefined;
      this.pending.set(id,{method,resolve,reject,timer});
      this.write({id,method,params});
    });
  }
  notify(method:string,params:unknown){this.write({method,params});}
  private end(code:number|null){
    if(this.closed)return;
    this.closed=true;
    for(const waiting of this.pending.values()){clearTimeout(waiting.timer);waiting.reject(new AcpClosed('The agent stopped.'));}
    this.pending.clear();
    this.onClose(code);
  }
  get pid(){return this.child.pid;}
}
