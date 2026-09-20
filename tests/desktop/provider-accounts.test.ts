import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {ProviderAccounts} from '../../desktop/provider-accounts.ts';
import {Codex} from '../../desktop/codex.ts';
test('accounts preserve legacy home, isolate owners, persist selection and block switches during inference',async()=>{
 const saved=new Map<string,any>();const vault:any={read:async(k:string,f:any)=>structuredClone(saved.get(k)||f),write:async(k:string,v:any)=>{saved.set(k,structuredClone(v));}};
 mock.method(Codex.prototype,'login',async()=>({url:'https://auth.openai.com/codex/device',code:'TEST-TEST'}));mock.method(Codex.prototype,'account',async()=>({connected:true,email:'fixture@example.com'}));mock.method(Codex.prototype,'logout',async()=>{});
 try{const manager=new ProviderAccounts(vault,'fixture','C:/fixture');const legacy:any=await manager.selected('owner-a');assert.match(legacy.home,/owner-a[\\/]codex$/);const added=await manager.add('owner-a');await manager.activate('owner-a',added.id);const selected:any=await manager.selected('owner-a');assert.notEqual(selected.home,legacy.home);assert.notEqual((await manager.selected('owner-b') as any).home,selected.home);await assert.rejects(()=>manager.activate('owner-b',added.id),/not found/);selected.starting=true;await assert.rejects(()=>manager.activate('owner-a','default'),/current task/);selected.starting=false;const restored=new ProviderAccounts(vault,'fixture','C:/fixture');assert.equal((await restored.list('owner-a')).active,added.id);await manager.remove('owner-a',added.id);assert.equal((await manager.list('owner-a')).active,'default');}finally{mock.restoreAll();}
});
