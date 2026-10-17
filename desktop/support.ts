/** Only the main process sends the session to the fixed first-party endpoint. */
export async function submitSupport(token: string, payload: {category:string;subject:string;message:string;logs?:string}, send:typeof fetch=fetch) {
  let response: Response;
  try {
    response = await send('https://mowrai.com/api/support', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(45000),
      headers:{'Content-Type':'application/json',Origin:'https://mowrai.com',Authorization:`Bearer ${token}`},
      body:JSON.stringify({category:payload.category,subject:payload.subject,message:payload.message,...(payload.logs?{logs:payload.logs}:{})}),
    });
  } catch {
    throw Error('The submission could not be confirmed. It may have reached support; please check before sending it again. You can email support@mowrai.com directly.');
  }
  const result = await response.json().catch(()=>null);
  if(response.status===401 || response.status===403)
    throw Error('Please sign in to Mowr again to contact support, or email support@mowrai.com directly.');
  if(!response.ok || result?.ok!==true)
    throw Error(response.status===429?'Please wait before sending another message.':'Support submission failed. Your draft is preserved. You can email support@mowrai.com directly.');
  return {ok:true,id:typeof result.id==='string'?result.id:undefined};
}
