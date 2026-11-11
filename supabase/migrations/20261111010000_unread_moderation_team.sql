-- Unread counts, message deletion, removing members and resetting the join code.

-- ---------------------------------------------------------------------------
-- Unread counts: one row per user per channel with the time they last read it
-- ---------------------------------------------------------------------------

create table public.channel_reads (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  channel       text not null
                  check (channel in ('general', 'announcements', 'team_member', 'supervisors', 'management')),
  last_read_at  timestamptz not null default now(),
  primary key (user_id, workplace_id, channel)
);

alter table public.channel_reads enable row level security;

create policy "read own read markers" on public.channel_reads
  for select to authenticated using (user_id = auth.uid());

revoke all on public.channel_reads from anon, authenticated;
grant select on public.channel_reads to authenticated;

create or replace function public.mark_channel_read(p_channel text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_workplace_id() is null or not public.can_access_channel(p_channel) then
    return;
  end if;
  insert into public.channel_reads (user_id, workplace_id, channel, last_read_at)
  values (auth.uid(), public.my_workplace_id(), p_channel, clock_timestamp())
  on conflict (user_id, workplace_id, channel) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Unread messages per channel the caller can access, not counting their own.
create or replace function public.unread_counts()
returns table (channel text, unread bigint)
language sql stable security definer set search_path = public as $$
  select c.channel, count(m.id)
  from unnest(array['general', 'announcements', 'team_member', 'supervisors', 'management']) as c(channel)
  left join public.channel_reads r
    on r.user_id = auth.uid() and r.workplace_id = public.my_workplace_id() and r.channel = c.channel
  left join public.messages m
    on m.workplace_id = public.my_workplace_id()
   and m.channel = c.channel
   and m.author_id is distinct from auth.uid()
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where public.can_access_channel(c.channel)
  group by c.channel
$$;

-- ---------------------------------------------------------------------------
-- Deleting messages: authors delete their own, managers delete any in their workplace
-- ---------------------------------------------------------------------------

create policy "delete own or as manager" on public.messages
  for delete to authenticated
  using (
    workplace_id = public.my_workplace_id()
    and public.can_access_channel(channel)
    and (author_id = auth.uid() or public.my_role() = 'manager')
  );

grant delete on public.messages to authenticated;

-- Photos go with their message.
create policy "message images delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = public.my_workplace_id()::text
    and public.can_access_channel((storage.foldername(name))[2])
  );

-- ---------------------------------------------------------------------------
-- Team management
-- ---------------------------------------------------------------------------

create or replace function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.profiles;
begin
  if public.my_role() is distinct from 'manager' then
    raise exception 'Only managers can remove people';
  end if;
  if p_user = auth.uid() then
    raise exception 'To leave yourself, use Leave Workplace in Account.';
  end if;
  select * into target from public.profiles where id = p_user;
  if not found or target.workplace_id is distinct from public.my_workplace_id() then
    raise exception 'That person is not in your workplace';
  end if;
  update public.profiles
     set workplace_id = null, role = 'team_member', has_onboarded = false
   where id = p_user;
end;
$$;

create or replace function public.regenerate_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if public.my_role() is distinct from 'manager' then
    raise exception 'Only managers can reset the join code';
  end if;
  code := public.generate_join_code();
  update public.workplaces set join_code = code where id = public.my_workplace_id();
  return code;
end;
$$;

revoke execute on function public.mark_channel_read(text), public.unread_counts(),
  public.remove_member(uuid), public.regenerate_join_code() from public, anon;
grant execute on function public.mark_channel_read(text), public.unread_counts(),
  public.remove_member(uuid), public.regenerate_join_code() to authenticated;


-- New members start with every channel marked as read, so they are not
-- greeted by unread counts for history from before they joined.
create or replace function public.start_caught_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.workplace_id is not null and new.workplace_id is distinct from old.workplace_id then
    insert into public.channel_reads (user_id, workplace_id, channel, last_read_at)
    select new.id, new.workplace_id, c, now()
    from unnest(array['general', 'announcements', 'team_member', 'supervisors', 'management']) as c
    on conflict (user_id, workplace_id, channel) do update set last_read_at = excluded.last_read_at;
  end if;
  return new;
end;
$$;

create trigger profiles_start_caught_up
  after update of workplace_id on public.profiles
  for each row execute function public.start_caught_up();
