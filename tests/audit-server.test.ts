import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
// @ts-expect-error plain JavaScript worker module
import {allowedStatement} from '../cloudflare/lib/sql-allowlist.js';

const sqlFile=(name:string)=>fs.readFileSync('cloudflare/'+name,'utf8');
function database(){
  const db=new DatabaseSync(':memory:');
  for(const file of ['schema.sql','admin-schema.sql','account-schema.sql','provider-links.sql'])db.exec(sqlFile(file));
  return db;
}

test('the database Worker refuses tables hidden in parentheses, comma joins and audit-log rewrites',()=>{
  const db=database();
  for(const sql of [
    'SELECT sealed FROM (provider_links)',
    'SELECT * FROM clem_users JOIN (desktop_admins) ON 1',
    'SELECT * FROM (SELECT 1) , provider_links',
    'SELECT * FROM (SELECT 1) AS x, desktop_admins',
    'SELECT * FROM clem_users NOT INDEXED, provider_links',
    'SELECT * FROM clem_users u JOIN clem_scopes s ON u.id=s.owner_id, provider_links',
    'SELECT * FROM clem_users u JOIN clem_scopes s USING(id), provider_links',
    'SELECT * FROM clem_users AS window, provider_links',
    'SELECT * FROM clem_users WHERE id IN (SELECT id FROM clem_scopes NOT INDEXED, desktop_owner_grants)',
    "INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET detail=''",
    'INSERT OR REPLACE INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)',
  ]){
    // Each one is real SQLite that would have run, not just text the allowlist happens to dislike.
    assert.doesNotThrow(()=>db.prepare(sql),sql);
    assert.equal(allowedStatement(sql),false,sql);
  }
  for(const sql of ['SELECT 1)','SELECT * FROM clem_users) , provider_links (SELECT 1'])assert.equal(allowedStatement(sql),false,sql);
});

test('the database Worker still accepts subqueries, joins, lists and plain audit entries',()=>{
  for(const sql of [
    'SELECT x.id FROM (SELECT id FROM clem_users WHERE disabled=0) AS x JOIN clem_scopes s ON s.owner_id=x.id WHERE s.kind IN (?,?) ORDER BY x.id, s.name LIMIT ?',
    'SELECT a.email,p.display_name FROM desktop_activity a LEFT JOIN desktop_profiles p ON p.user_id=a.user_id WHERE a.user_id=?',
    'SELECT owner_id, count(*) FROM clem_files GROUP BY owner_id, scope_id',
    'INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)',
    'INSERT INTO clem_usage(owner_id) VALUES(?) ON CONFLICT(owner_id) DO UPDATE SET reserved_bytes=0,stored_bytes=0',
    'DELETE FROM clem_subscription_sessions WHERE expires_at<? RETURNING session_id,sandbox_id',
  ])assert.equal(allowedStatement(sql),true,sql);
});

test('the D1 schema and the Telegram removal can be applied again safely',()=>{
  const db=database();
  db.prepare("INSERT INTO provider_links(user_id,id,kind,sealed,created_at,updated_at) VALUES('u','a','telegram',x'00',1,1),('u','b','codex',x'00',1,1)").run();
  db.exec('CREATE TABLE telegram_inbox(x)');
  for(let i=0;i<2;i++){
    for(const file of ['schema.sql','admin-schema.sql','account-schema.sql','provider-links.sql'])assert.doesNotThrow(()=>db.exec(sqlFile(file)),file);
    assert.doesNotThrow(()=>db.exec(sqlFile('remove-telegram.sql')));
  }
  assert.deepEqual(db.prepare('SELECT kind FROM provider_links').all().map(r=>r.kind),['codex']);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'telegram_%'").get()!.n,0);
});
