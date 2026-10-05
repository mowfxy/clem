import {test} from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the browser Worker: records what is posted and whether it was torn down.
class FakeWorker {
  static all:FakeWorker[]=[];
  terminated=false;posted:unknown[]=[];listeners=new Map<string,Set<(e:unknown)=>void>>();
  constructor(){FakeWorker.all.push(this);}
  addEventListener(type:string,fn:(e:unknown)=>void){(this.listeners.get(type)??this.listeners.set(type,new Set()).get(type)!).add(fn);}
  removeEventListener(type:string,fn:(e:unknown)=>void){this.listeners.get(type)?.delete(fn);}
  postMessage(m:unknown){this.posted.push(m);}
  terminate(){this.terminated=true;}
  emit(data:unknown){for(const fn of this.listeners.get('message')||[])fn({data});}
}
Object.assign(globalThis,{Worker:FakeWorker,document:{baseURI:'http://localhost/'}});
const {runCode}=await import('../src/chat/code-run.ts');
type Event={type:string;text?:string;ok?:boolean;stopped?:boolean};

test('stopping one Python run ends the others sharing its worker instead of leaving them hanging',()=>{
  const a:Event[]=[],b:Event[]=[];
  const stopA=runCode('python','while True: pass',e=>a.push(e));
  runCode('python','print(1)',e=>b.push(e));
  assert.equal(FakeWorker.all.length,1,'Python runs share one worker');
  stopA();
  assert.equal(FakeWorker.all[0].terminated,true);
  assert.deepEqual(a.at(-1),{type:'done',ok:false,stopped:true});
  assert.equal(b.at(-1)?.type,'done');
  assert.match(b.find(e=>e.type==='err')?.text||'',/another run was stopped/);
  // The next run starts a fresh worker.
  const stop2=runCode('python','print(2)',()=>{});
  assert.equal(FakeWorker.all.length,2);
  stop2();
});

test('a finished Python run leaves the shared worker running for the next one',()=>{
  const events:Event[]=[];
  runCode('python','print(3)',e=>events.push(e));
  const before=FakeWorker.all.length;
  const w=FakeWorker.all.at(-1)!,id=(w.posted.at(-1) as {id:number}).id;
  w.emit({id,type:'out',text:'3\n'});w.emit({id,type:'done',ok:true});
  assert.deepEqual(events,[{type:'out',text:'3\n'},{type:'done',ok:true}]);
  assert.equal(w.terminated,false);
  const stop4=runCode('python','print(4)',()=>{});
  assert.equal(FakeWorker.all.length,before,'no new worker for the next run');
  stop4();
});
