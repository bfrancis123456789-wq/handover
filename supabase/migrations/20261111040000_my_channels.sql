-- The channels the signed-in person can access, in sidebar order.
-- Edge Functions read access from here instead of keeping their own copy of the rules.

create or replace function public.my_channels()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c order by ord), '{}')
  from unnest(array['general', 'announcements', 'team_member', 'supervisors', 'management']) with ordinality as t(c, ord)
  where public.role_can_access(public.my_role(), c)
$$;

revoke execute on function public.my_channels() from public, anon;
grant execute on function public.my_channels() to authenticated;
