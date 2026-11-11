-- Announcements: everyone can read, only supervisors and managers can post.

create or replace function public.can_post_in_channel(p_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_channel(p_channel)
     and (p_channel <> 'announcements' or public.my_role() in ('supervisor', 'manager'))
$$;

drop policy "post in allowed channels" on public.messages;
create policy "post in allowed channels" on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and workplace_id = public.my_workplace_id()
    and public.can_post_in_channel(channel)
    and (image_url is null or image_url like workplace_id::text || '/' || channel || '/%')
  );

drop policy "message images upload" on storage.objects;
create policy "message images upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = public.my_workplace_id()::text
    and public.can_post_in_channel((storage.foldername(name))[2])
  );
