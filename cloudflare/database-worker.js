export default {
 async fetch(request,env){
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
  // Without a configured secret nothing is accepted (never compare against "Bearer undefined").
  if(typeof env.DATABASE_SECRET!=='string'||!env.DATABASE_SECRET.trim())return new Response('{"error":"Unauthorized"}',{status:401,headers});
  const expected=new TextEncoder().encode('Bearer '+env.DATABASE_SECRET),actual=new TextEncoder().encode(request.headers.get('Authorization')||'');
  if(expected.length!==actual.length||!crypto.subtle.timingSafeEqual(expected,actual))return new Response('{"error":"Unauthorized"}',{status:401,headers});
  if(request.method!=='POST')return new Response('{}',{status:405,headers});
  try{const {queries}=await request.json();if(!Array.isArray(queries)||!queries.length||queries.length>30)throw Error('Invalid batch');
   const statements=queries.map(({sql,params})=>{if(typeof sql!=='string'||!Array.isArray(params))throw Error('Invalid query');return env.DB.prepare(sql).bind(...params);});
   const results=await env.DB.batch(statements);return Response.json({results},{headers});
  }catch(error){console.error('Database operation failed',error.message);return Response.json({error:'Database operation failed.'},{status:500,headers});}
 }
};
