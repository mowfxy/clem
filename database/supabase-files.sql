create table if not exists public.mowr_files (
 id uuid primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 250),
 mime text not null,
 bytes bigint not null check(bytes between 1 and 52428800),
 object_key text not null unique,
 status text not null default 'reserved' check(status in ('reserved','ready')),
 created_at timestamptz not null default now(),
 check(object_key=owner_id::text||'/'||id::text)
);
alter table public.mowr_files enable row level security;
grant select,insert,delete on public.mowr_files to authenticated;
grant update(status) on public.mowr_files to authenticated;
create policy files_metadata_read on public.mowr_files for select to authenticated using(owner_id=(select auth.uid()));
create policy files_metadata_insert on public.mowr_files for insert to authenticated with check(owner_id=(select auth.uid()) and status='reserved');
create policy files_metadata_update on public.mowr_files for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy files_metadata_delete on public.mowr_files for delete to authenticated using(owner_id=(select auth.uid()));
create or replace function public.check_mowr_storage_quota() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
 if (select coalesce(sum(bytes),0) from public.mowr_files where owner_id=new.owner_id)+new.bytes>1500000000 then raise exception 'Storage limit reached'; end if;
 return new;
end $$;
create trigger enforce_mowr_quota before insert on public.mowr_files for each row execute function public.check_mowr_storage_quota();
create index mowr_files_owner on public.mowr_files(owner_id);
drop policy if exists mowr_files_insert on storage.objects;
create policy mowr_files_insert on storage.objects for insert to authenticated with check(bucket_id='mowr-files' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.mowr_files f where f.owner_id=(select auth.uid()) and f.object_key=name and f.status='reserved'));

-- A reservation cannot be removed while it still holds an uploaded object.
drop policy files_metadata_delete on public.mowr_files;
create policy files_metadata_delete on public.mowr_files for delete to authenticated using(owner_id=(select auth.uid()) and not exists(select 1 from storage.objects o where o.bucket_id='mowr-files' and o.name=mowr_files.object_key));
create or replace function public.validate_mowr_file_size() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.bucket_id='mowr-files' and new.metadata is not null then
  if not exists(select 1 from public.mowr_files f where f.object_key=new.name and f.bytes=(new.metadata->>'size')::bigint) then raise exception 'File size must match its reservation'; end if;
 end if;
 return new;
end $$;
create trigger validate_mowr_file_size after insert or update of metadata on storage.objects for each row execute function public.validate_mowr_file_size();
