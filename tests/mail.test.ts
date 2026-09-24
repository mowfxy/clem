import assert from 'node:assert/strict';
import test from 'node:test';
import {mailReady} from '../server/mail.ts';

test('server mail requires a complete SMTP configuration',()=>{
  const names=['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'] as const;
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{
    Object.assign(process.env,{SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'test-secret',SMTP_FROM:'Sender <sender@example.test>'});
    assert.equal(mailReady(),true);
    for(const name of names){const value=process.env[name];delete process.env[name];assert.equal(mailReady(),false,`${name} must be required`);process.env[name]=value;}
    process.env.SMTP_PORT='invalid';assert.equal(mailReady(),false);
  }finally{
    for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
