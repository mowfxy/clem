-- The deployment script replaces __FILE_GATE_SECRET__ in memory only.
create schema if not exists clem_private;
revoke all on schema clem_private from public,anon,authenticated;
create table if not exists clem_private.file_gate_key(id boolean primary key default true check(id), secret text not null);
insert into clem_private.file_gate_key(id,secret) values(true,'__FILE_GATE_SECRET__') on conflict(id) do update set secret=excluded.secret;
create table if not exists clem_private.email_security(owner_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null);
create table if not exists clem_private.email_sessions(owner_id uuid not null references auth.users(id) on delete cascade,session_id text not null,expires_at timestamptz not null,primary key(owner_id,session_id));
create or replace function public.clem_confirm_email_access(p_enabled boolean,p_expires bigint,p_proof text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s text:=auth.jwt()->>'session_id'; expected text;
begin
 if u is null or s is null or p_expires<extract(epoch from now()) or p_expires>extract(epoch from now())+43260 then raise exception 'Invalid verification'; end if;
 select encode(extensions.hmac(u::text||'|'||s||'|'||coalesce(p_enabled::text,'session')||'|'||p_expires::text,secret,'sha256'),'hex') into expected from clem_private.file_gate_key where id;
 if p_proof is null or expected is null or p_proof<>expected then raise exception 'Invalid verification'; end if;
 if p_enabled is not null then insert into clem_private.email_security values(u,p_enabled) on conflict(owner_id) do update set enabled=excluded.enabled; end if;
 insert into clem_private.email_sessions values(u,s,to_timestamp(p_expires)) on conflict(owner_id,session_id) do update set expires_at=excluded.expires_at;
end $$;
revoke all on function public.clem_confirm_email_access(boolean,bigint,text) from public,anon;
grant execute on function public.clem_confirm_email_access(boolean,bigint,text) to authenticated;
create or replace function public.clem_file_access() returns boolean language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then return false; end if;
 if exists(select 1 from auth.mfa_factors where user_id=u and status='verified') and coalesce(auth.jwt()->>'aal','')<>'aal2' then return false; end if;
 if exists(select 1 from clem_private.email_security where owner_id=u and enabled) then
  return exists(select 1 from clem_private.email_sessions where owner_id=u and session_id=auth.jwt()->>'session_id' and expires_at>now());
 end if;
 return true;
end $$;
revoke all on function public.clem_file_access() from public,anon;
grant execute on function public.clem_file_access() to authenticated;
create policy files_verification on public.clem_files as restrictive for all to authenticated using((select public.clem_file_access())) with check((select public.clem_file_access()));
create policy storage_verification on storage.objects as restrictive for all to authenticated using(bucket_id<>'clem-files' or (select public.clem_file_access())) with check(bucket_id<>'clem-files' or (select public.clem_file_access()));
