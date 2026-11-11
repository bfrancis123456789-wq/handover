-- Handover: schema, row level security, RPCs, storage and realtime.
-- Every table is scoped to a workplace. Access is enforced here, not only in the UI.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workplaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  display_name           text not null default '' check (char_length(display_name) <= 60),
  avatar_url             text,
  workplace_id           uuid references public.workplaces (id) on delete set null,
  role                   text not null default 'team_member'
                           check (role in ('team_member', 'supervisor', 'manager')),
  has_onboarded          boolean not null default false,
  notification_settings  jsonb not null default
    '{"general": true, "announcements": true, "team_member": true, "supervisors": true, "management": true}'::jsonb,
  created_at             timestamptz not null default now()
);
create index profiles_workplace_idx on public.profiles (workplace_id);

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  channel       text not null
                  check (channel in ('general', 'announcements', 'team_member', 'supervisors', 'management')),
  author_id     uuid references public.profiles (id) on delete set null,
  content       text not null default '' check (char_length(content) <= 4000),
  image_url     text,  -- storage path inside the "message-images" bucket
  created_at    timestamptz not null default now(),
  check (char_length(trim(content)) > 0 or image_url is not null)
);
create index messages_feed_idx on public.messages (workplace_id, channel, created_at desc);

create table public.likes (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.summaries (
  id            uuid primary key default gen_random_uuid(),
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  content       jsonb not null,
  created_at    timestamptz not null default now()
);
create index summaries_latest_idx on public.summaries (user_id, workplace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies can read profiles without
-- recursing into the profiles policy)
-- ---------------------------------------------------------------------------

create or replace function public.my_workplace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select workplace_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.can_access_channel(p_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_channel
    when 'general'       then true
    when 'announcements' then true
    when 'team_member'   then true
    when 'supervisors'   then public.my_role() in ('supervisor', 'manager')
    when 'management'    then public.my_role() = 'manager'
    else false
  end
$$;

-- Create a profile for every new auth user, using the full name from signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workplaces enable row level security;
alter table public.profiles   enable row level security;
alter table public.messages   enable row level security;
alter table public.likes      enable row level security;
alter table public.summaries  enable row level security;

-- Workplaces: members can read their own workplace. The join code column is
-- hidden from direct reads; managers fetch it through get_join_code().
-- Writes only happen through the RPCs below.
create policy "members read own workplace" on public.workplaces
  for select to authenticated using (id = public.my_workplace_id());

revoke all on public.workplaces from anon, authenticated;
grant select (id, name, owner_id, created_at) on public.workplaces to authenticated;

-- Profiles: read yourself and people in your workplace. Update only yourself,
-- and only the harmless columns. role and workplace_id change through RPCs.
create policy "read own and coworkers" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (workplace_id is not null and workplace_id = public.my_workplace_id()));

create policy "update self" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, has_onboarded, notification_settings) on public.profiles to authenticated;

-- Messages: read and post only in your workplace and in channels your role allows.
create policy "read allowed channels" on public.messages
  for select to authenticated
  using (workplace_id = public.my_workplace_id() and public.can_access_channel(channel));

create policy "post in allowed channels" on public.messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and workplace_id = public.my_workplace_id()
    and public.can_access_channel(channel)
    and (image_url is null or image_url like workplace_id::text || '/' || channel || '/%')
  );

revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;

-- Likes: visible and creatable only for messages you can see. One per user (primary key).
create policy "read likes on visible messages" on public.likes
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

create policy "like visible messages" on public.likes
  for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id));

create policy "remove own like" on public.likes
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.likes from anon, authenticated;
grant select, insert, delete on public.likes to authenticated;

-- Summaries: each user sees only their own briefs (they reflect that user's channel access).
create policy "read own briefs" on public.summaries
  for select to authenticated
  using (user_id = auth.uid() and workplace_id = public.my_workplace_id());

create policy "save own briefs" on public.summaries
  for insert to authenticated
  with check (user_id = auth.uid() and workplace_id = public.my_workplace_id());

revoke all on public.summaries from anon, authenticated;
grant select, insert on public.summaries to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.generate_join_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.workplaces where join_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_workplace(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  w public.workplaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.my_workplace_id() is not null then
    raise exception 'You already belong to a workplace';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Enter a workplace name';
  end if;

  insert into public.workplaces (name, join_code, owner_id)
  values (trim(p_name), public.generate_join_code(), auth.uid())
  returning * into w;

  update public.profiles
     set workplace_id = w.id, role = 'manager', has_onboarded = false
   where id = auth.uid();

  return json_build_object('id', w.id, 'name', w.name, 'join_code', w.join_code);
end;
$$;

create or replace function public.join_workplace(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  w public.workplaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.my_workplace_id() is not null then
    raise exception 'You already belong to a workplace';
  end if;

  select * into w from public.workplaces where join_code = upper(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'That join code does not match any workplace. Check the code with your manager and try again.';
  end if;

  update public.profiles
     set workplace_id = w.id, role = 'team_member', has_onboarded = false
   where id = auth.uid();

  return json_build_object('id', w.id, 'name', w.name);
end;
$$;

create or replace function public.get_join_code()
returns text language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() <> 'manager' then raise exception 'Only managers can see the join code'; end if;
  return (select join_code from public.workplaces where id = public.my_workplace_id());
end;
$$;

create or replace function public.set_member_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.profiles;
begin
  if public.my_role() is distinct from 'manager' then
    raise exception 'Only managers can change roles';
  end if;
  if p_role not in ('team_member', 'supervisor', 'manager') then
    raise exception 'Unknown role';
  end if;

  select * into target from public.profiles where id = p_user;
  if not found or target.workplace_id is distinct from public.my_workplace_id() then
    raise exception 'That person is not in your workplace';
  end if;

  if target.role = 'manager' and p_role <> 'manager'
     and (select count(*) from public.profiles
           where workplace_id = target.workplace_id and role = 'manager') = 1 then
    raise exception 'A workplace needs at least one manager. Promote someone else first.';
  end if;

  update public.profiles set role = p_role where id = p_user;
end;
$$;

-- Leave the workplace. The only manager cannot leave while other people are
-- still in the workplace. If they are the last person, the workplace is deleted.
create or replace function public.leave_workplace()
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  managers int;
  members int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.workplace_id is null then return; end if;

  select count(*) filter (where role = 'manager'), count(*)
    into managers, members
    from public.profiles where workplace_id = me.workplace_id;

  if me.role = 'manager' and managers = 1 and members > 1 then
    raise exception 'You are the only manager. Make someone else a manager in Manage Team before you leave.';
  end if;

  update public.profiles
     set workplace_id = null, role = 'team_member', has_onboarded = false
   where id = me.id;

  if members = 1 then
    delete from public.workplaces where id = me.workplace_id;
  end if;
end;
$$;

revoke execute on function public.generate_join_code() from public, anon, authenticated;
revoke execute on function public.create_workplace(text), public.join_workplace(text), public.get_join_code(),
  public.set_member_role(uuid, text), public.leave_workplace() from public, anon;
grant execute on function public.create_workplace(text), public.join_workplace(text), public.get_join_code(),
  public.set_member_role(uuid, text), public.leave_workplace() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage
--   avatars:         public read, path "<user_id>/<file>", users write their own folder
--   message-images:  private, path "<workplace_id>/<channel>/<file>", same rules as messages
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('message-images', 'message-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "avatar upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar update own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "message images read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = public.my_workplace_id()::text
    and public.can_access_channel((storage.foldername(name))[2])
  );

create policy "message images upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = public.my_workplace_id()::text
    and public.can_access_channel((storage.foldername(name))[2])
  );

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes respects the select policies above)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages, public.likes, public.profiles;
