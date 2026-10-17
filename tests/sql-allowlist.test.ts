import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sqliteSql} from '../server/d1.ts';
// @ts-expect-error plain JavaScript worker module
import {allowedStatement} from '../cloudflare/lib/sql-allowlist.js';

/** Skips a ${…} expression (which may hold strings and nested templates) and returns the index after its "}". */
function skipExpression(src:string,i:number):number{
  let depth=1;
  while(i<src.length){
    const c=src[i];
    if(c==='`'){i=readTemplate(src,i+1).end;continue;}
    if(c==='"'||c==="'"){const q=c;i++;while(src[i]!==q){if(src[i]==='\\')i++;i++;}i++;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return i+1;
    i++;
  }
  throw Error('Unterminated expression');
}
/** Reads a template literal body starting after its opening backtick: its literal parts and the index after it. */
function readTemplate(src:string,i:number){
  const parts=[''];
  while(i<src.length){
    const c=src[i];
    if(c==='\\'){parts[parts.length-1]+=src[i+1];i+=2;continue;}
    if(c==='`')return {parts,end:i+1};
    if(c==='$'&&src[i+1]==='{'){i=skipExpression(src,i+2);parts.push('');continue;}
    parts[parts.length-1]+=c;i++;
  }
  throw Error('Unterminated template');
}
/** Every tagged query the API sends: db()`…` and sql`…`, turned into the SQL the D1 client posts. */
function apiQueries(){
  const found:{file:string;sql:string}[]=[];
  for(const name of fs.readdirSync('server').filter(f=>f.endsWith('.ts'))){
    const src=fs.readFileSync('server/'+name,'utf8');
    for(const match of src.matchAll(/\b(?:db\(\)|sql)`/g)){
      const {parts}=readTemplate(src,match.index!+match[0].length);
      found.push({file:name,sql:sqliteSql(parts.join('?'))});
    }
  }
  return found;
}

test('every query the API sends is inside the database Worker allowlist',()=>{
  const queries=apiQueries();
  assert.ok(queries.length>60,`found only ${queries.length} queries; the scanner missed some`);
  for(const {file,sql} of queries)assert.ok(allowedStatement(sql),`${file}: ${sql}`);
  // scripts/announce-release.mjs uses the same Worker.
  for(const sql of ["SELECT email FROM mowr_email_optout WHERE kind='updates'",'SELECT owner_id FROM mowr_email_log WHERE kind=?',"INSERT INTO mowr_email_log(owner_id,kind,sent_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(owner_id,kind) DO NOTHING"])
    assert.ok(allowedStatement(sql),sql);
});

test('the database Worker refuses staff, vault and schema access',()=>{
  for(const sql of [
    'SELECT * FROM provider_links',
    "INSERT INTO desktop_admins(user_id,email,role,added_by,added_at) VALUES(?,?,'admin',?,?)",
    'INSERT OR IGNORE INTO desktop_owner_grants(user_id,granted_at) VALUES(?,?)',
    'UPDATE desktop_activity SET email=? WHERE user_id=?',
    'DELETE FROM desktop_activity WHERE user_id=?',
    'DELETE FROM desktop_audit_log WHERE 1=1',
    "UPDATE desktop_audit_log SET detail='' WHERE 1=1",
    'SELECT * FROM mowr_users, desktop_admins',
    'SELECT * FROM mowr_users u, desktop_admins a',
    'SELECT * FROM mowr_users WHERE id IN (SELECT user_id FROM desktop_sync)',
    'SELECT name FROM sqlite_master',
    'SELECT * FROM pragma_table_info(?)',
    'PRAGMA table_list',
    'DROP TABLE mowr_users',
    'SELECT 1; DROP TABLE mowr_users',
    'SELECT * FROM "desktop_admins"',
    'SELECT * FROM mowr_users -- comment',
    "SELECT * FROM mowr_users WHERE id='x",
    'WITH x AS (SELECT * FROM desktop_admins) SELECT * FROM x',
    '',
  ])assert.equal(allowedStatement(sql),false,sql);
  // A table name inside a string is data, not a reference.
  assert.equal(allowedStatement("SELECT 1 FROM mowr_users WHERE display_name='FROM desktop_admins'"),true);
});

test('reading a guarded table through IN or a pragma table function is refused',()=>{
  assert.equal(allowedStatement("SELECT id FROM mowr_users WHERE ('u1','2026') IN desktop_owner_grants"),false);
  assert.equal(allowedStatement("SELECT id FROM mowr_users WHERE 'x' IN pragma_table_info('provider_links')"),false);
  assert.equal(allowedStatement("SELECT id FROM mowr_users WHERE id IN (?,?)"),true);
});
