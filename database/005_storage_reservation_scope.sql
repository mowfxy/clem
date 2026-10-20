-- Qualify the outer object name: clem_files also has a name column.
drop policy if exists clem_files_insert on storage.objects;
create policy clem_files_insert on storage.objects for insert to authenticated
with check (
 bucket_id='clem-files'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists (
  select 1 from public.clem_files f
  where f.owner_id=(select auth.uid())
   and f.object_key=storage.objects.name
   and f.status='reserved'
 )
);
