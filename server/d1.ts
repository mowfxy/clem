type Query = {sql:string;params:unknown[]};
export function sqliteSql(sql:string){return sql.replace(/::(?:jsonb|int|bigint|text)/g,'').replace(/now\(\)\s*([+-])\s*interval '([^']+)'/g,(_,sign,span)=>`strftime('%Y-%m-%dT%H:%M:%fZ','now','${sign}${span}')`).replace(/now\(\)/g,"strftime('%Y-%m-%dT%H:%M:%fZ','now')");}
async function execute(queries:Query[]){
 const r=await fetch(process.env.CLOUDFLARE_DATABASE_URL!,{method:'POST',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_DATABASE_SECRET,'Content-Type':'application/json'},body:JSON.stringify({queries}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Cloud database request failed ('+r.status+').');
 const data=await r.json();if(data.error)throw Error(data.error);
 return data.results.map((result:{results:Record<string,unknown>[]})=>result.results.map(row=>{for(const key of ['metadata','state','definition','plan'])if(typeof row[key]==='string')row[key]=JSON.parse(row[key] as string);return row;}));
}
export function d1(){
 const tag=(parts:TemplateStringsArray,...values:unknown[])=>{
  const query:Query={sql:sqliteSql(parts.join('?')),params:values.map(v=>v instanceof Date?v.toISOString():typeof v==='boolean'?Number(v):v??null)};
  let promise:Promise<any[]>|undefined;
  return {query,then(resolve:any,reject:any){promise??=execute([query]).then(r=>r[0]);return promise.then(resolve,reject);}};
 };
 tag.transaction=(queries:ReturnType<typeof tag>[])=>execute(queries.map(q=>q.query));
 return tag;
}
