insert into storage.buckets(id,name,public,file_size_limit)
values('clem-files','clem-files',false,52428800)
on conflict(id) do update set public=false,file_size_limit=52428800;
create policy clem_files_read on storage.objects for select to authenticated using(bucket_id='clem-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy clem_files_delete on storage.objects for delete to authenticated using(bucket_id='clem-files' and (storage.foldername(name))[1]=(select auth.uid())::text);

create table if not exists public.clem_files (
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
alter table public.clem_files enable row level security;
grant select,insert,delete on public.clem_files to authenticated;
grant update(status) on public.clem_files to authenticated;
create policy files_metadata_read on public.clem_files for select to authenticated using(owner_id=(select auth.uid()));
create policy files_metadata_insert on public.clem_files for insert to authenticated with check(owner_id=(select auth.uid()) and status='reserved');
create policy files_metadata_update on public.clem_files for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy files_metadata_delete on public.clem_files for delete to authenticated using(owner_id=(select auth.uid()));
create or replace function public.check_clem_storage_quota() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
 if (select coalesce(sum(bytes),0) from public.clem_files where owner_id=new.owner_id)+new.bytes>1500000000 then raise exception 'Storage limit reached'; end if;
 return new;
end $$;
create trigger enforce_clem_quota before insert on public.clem_files for each row execute function public.check_clem_storage_quota();
create index clem_files_owner on public.clem_files(owner_id);
drop policy if exists clem_files_insert on storage.objects;
create policy clem_files_insert on storage.objects for insert to authenticated with check(bucket_id='clem-files' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.clem_files f where f.owner_id=(select auth.uid()) and f.object_key=storage.objects.name and f.status='reserved'));

-- A reservation cannot be removed while it still holds an uploaded object.
drop policy files_metadata_delete on public.clem_files;
create policy files_metadata_delete on public.clem_files for delete to authenticated using(owner_id=(select auth.uid()) and not exists(select 1 from storage.objects o where o.bucket_id='clem-files' and o.name=clem_files.object_key));
create or replace function public.validate_clem_file_size() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.bucket_id='clem-files' and new.metadata is not null then
  if not exists(select 1 from public.clem_files f where f.object_key=new.name and f.bytes=(new.metadata->>'size')::bigint) then raise exception 'File size must match its reservation'; end if;
 end if;
 return new;
end $$;
create trigger validate_clem_file_size after insert or update of metadata on storage.objects for each row execute function public.validate_clem_file_size();
