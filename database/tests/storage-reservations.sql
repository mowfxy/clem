-- Run against a test project, or transactionally as shown. All fixtures roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at)
values('11111111-1111-4111-8111-111111111115','authenticated','authenticated','storage-policy-test@example.invalid',now());
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111115","role":"authenticated","aal":"aal1","session_id":"11111111-1111-4111-8111-111111111116"}',true);
set local role authenticated;
insert into public.mowr_files(id,name,mime,bytes,object_key)
values('11111111-1111-4111-8111-111111111117','test.txt','text/plain',4,'11111111-1111-4111-8111-111111111115/11111111-1111-4111-8111-111111111117');
insert into storage.objects(bucket_id,name,metadata)
values('mowr-files','11111111-1111-4111-8111-111111111115/11111111-1111-4111-8111-111111111117','{"size":4}');
do $$ begin
 begin
  insert into storage.objects(bucket_id,name,metadata)
  values('mowr-files','11111111-1111-4111-8111-111111111115/unreserved','{"size":4}');
  raise exception 'Unreserved upload was allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
select 'Reserved upload allowed; unreserved upload rejected' as verification;
rollback;
