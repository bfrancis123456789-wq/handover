-- Launch hardening: account deletion safety, join code rate limiting, data export.

-- ---------------------------------------------------------------------------
-- Deleting the person who created a workplace must not delete the workplace.
-- (It used to cascade, which would have wiped every message, photo and issue.)
-- ---------------------------------------------------------------------------

alter table public.workplaces alter column owner_id drop not null;
alter table public.workplaces drop constraint workplaces_owner_id_fkey;
alter table public.workplaces
  add constraint workplaces_owner_id_fkey foreign key (owner_id) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Join codes: at most 10 wrong attempts per person per hour, so codes can't be guessed.
-- ---------------------------------------------------------------------------

create table public.join_attempts (
  user_id       uuid not null references auth.users (id) on delete cascade,
  attempted_at  timestamptz not null default now()
);
create index join_attempts_recent_idx on public.join_attempts (user_id, attempted_at);
alter table public.join_attempts enable row level security; -- no policies: only functions use it
revoke all on public.join_attempts from anon, authenticated;

-- A wrong code returns {"error": ...} rather than raising, so the attempt is recorded.
create or replace function public.join_workplace(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  w public.workplaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.my_workplace_id() is not null then
    raise exception 'You already belong to a workplace';
  end if;

  if (select count(*) from public.join_attempts
      where user_id = auth.uid() and attempted_at > now() - interval '1 hour') >= 10 then
    return json_build_object('error', 'Too many wrong codes. Wait an hour and try again, or check the code with your manager.');
  end if;

  select * into w from public.workplaces where join_code = upper(trim(coalesce(p_code, '')));
  if not found then
    insert into public.join_attempts (user_id) values (auth.uid());
    return json_build_object('error', 'That join code does not match any workplace. Check the code with your manager and try again.');
  end if;

  delete from public.join_attempts where user_id = auth.uid();
  update public.profiles
     set workplace_id = w.id, role = 'team_member', has_onboarded = false
   where id = auth.uid();

  return json_build_object('id', w.id, 'name', w.name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Export my data (Australian Privacy Principle 12: access to personal information)
-- Only the caller's own data: their account, the messages they wrote, their likes,
-- briefs, issues they own, devices and settings. Never other people's content.
-- ---------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'id', p.id, 'email', u.email, 'display_name', p.display_name, 'profile_photo', p.avatar_url,
        'role', p.role, 'account_created', p.created_at, 'notification_settings', p.notification_settings,
        'terms_accepted_at', u.raw_user_meta_data ->> 'terms_accepted_at',
        'terms_version', u.raw_user_meta_data ->> 'terms_version')
      from public.profiles p join auth.users u on u.id = p.id
      where p.id = auth.uid()),
    'workplace', (select jsonb_build_object('name', w.name) from public.workplaces w where w.id = public.my_workplace_id()),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('channel', channel, 'text', content, 'photo', image_url, 'posted_at', created_at) order by created_at)
      from public.messages where author_id = auth.uid()), '[]'::jsonb),
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object('message_id', message_id, 'liked_at', created_at) order by created_at)
      from public.likes where user_id = auth.uid()), '[]'::jsonb),
    'shift_briefs', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', created_at, 'brief', content) order by created_at)
      from public.summaries where user_id = auth.uid()), '[]'::jsonb),
    'issues_you_own', coalesce((
      select jsonb_agg(jsonb_build_object('title', title, 'status', status, 'opened', created_at, 'resolved', resolved_at) order by created_at)
      from public.issues where owner_id = auth.uid()), '[]'::jsonb),
    'notification_devices', coalesce((
      select jsonb_agg(jsonb_build_object('device', user_agent, 'added', created_at, 'last_seen', last_seen_at) order by created_at)
      from public.push_subscriptions where user_id = auth.uid()), '[]'::jsonb)
  )
$$;

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
