import { db } from './db.ts';
import { decrypt } from './vault.ts';
import { generate } from './providers.ts';
export function nextRun(schedule:string,from=new Date()){const n=new Date(from);n.setUTCHours(8,0,0,0);if(n<=from)n.setUTCDate(n.getUTCDate()+1);while((schedule==='weekdays'&&[0,6].includes(n.getUTCDay()))||(schedule==='weekly'&&n.getUTCDay()!==1))n.setUTCDate(n.getUTCDate()+1);return n.toISOString();}
export async function runDue(){
 const sql=db();
 const jobs=await sql`UPDATE mowr_automations SET lease_until=now()+interval '5 minutes' WHERE id IN (SELECT a.id FROM mowr_automations a JOIN mowr_users u ON u.id=a.owner_id WHERE a.enabled AND NOT u.disabled AND a.next_run_at<=now() AND (a.lease_until IS NULL OR a.lease_until<now()) ORDER BY a.next_run_at LIMIT 4) RETURNING *`;
 await Promise.all(jobs.map(async j=>{try{const c=await sql`SELECT ciphertext,nonce,metadata FROM mowr_credentials WHERE owner_id=${j.owner_id} AND provider=${j.model}`;const credential=c[0]?{key:decrypt(c[0].ciphertext,c[0].nonce,j.owner_id),model:c[0].metadata.model,kind:c[0].metadata.kind,owner:j.owner_id}:undefined;let result='';for await(const text of generate(j.model,[{role:'user',content:j.prompt}],AbortSignal.timeout(120000),credential)){result+=text;if(result.length>100000)throw new Error('Automation output exceeded its limit.');}await sql`UPDATE mowr_automations SET last_result=${result},last_error=NULL,next_run_at=${nextRun(j.schedule)},lease_until=NULL,updated_at=now() WHERE id=${j.id}`;}catch(e){await sql`UPDATE mowr_automations SET last_error=${(e as Error).message},next_run_at=${nextRun(j.schedule)},lease_until=NULL,updated_at=now() WHERE id=${j.id}`;}}));
 await sql`DELETE FROM mowr_rate_limits WHERE window_start<now()-interval '1 day'`;
 return {processed:jobs.length};
}
