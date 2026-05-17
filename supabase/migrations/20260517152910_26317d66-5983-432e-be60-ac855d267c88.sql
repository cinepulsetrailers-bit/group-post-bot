
revoke execute on function public.handle_new_user() from anon, authenticated, public;

drop policy if exists "media public read" on storage.objects;
create policy "media auth read" on storage.objects for select to authenticated using (bucket_id = 'media');
