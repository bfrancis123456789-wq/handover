-- Tracked issues, so problems stay on the shift brief until someone resolves them,
-- not only while their messages are in the last 24 hours.
--
-- Reading follows channel access. Nobody writes to the table directly:
--   * the shift-brief function records AI updates through apply_brief_updates() (service role only)
--   * supervisors and managers use resolve_issue(), reopen_issue() and assign_issue()

create table public.issues (
  id                      uuid primary key default gen_random_uuid(),
  workplace_id            uuid not null references public.workplaces (id) on delete cascade,
  channel                 text not null
                            check (channel in ('general', 'announcements', 'team_member', 'supervisors', 'management')),
  title                   text not null check (char_length(trim(title)) between 1 and 200),
  severity                text not null default 'normal' check (severity in ('critical', 'normal')),
  status                  text not null default 'open' check (status in ('open', 'resolved')),
  owner_id                uuid references public.profiles (id) on delete set null,
  source_message_ids      uuid[] not null default '{}',
  resolution_message_ids  uuid[] not null default '{}',
  created_by              uuid references public.profiles (id) on delete set null,  -- whose brief found it
  resolved_by             uuid references public.profiles (id) on delete set null,  -- null when the brief resolved it
  created_at              timestamptz not null default now(),
  resolved_at             timestamptz,
  last_seen_at            timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_at is not null))
);
create index issues_open_idx on public.issues (workplace_id, status, created_at);
create index issues_sources_idx on public.issues using gin (source_message_ids);

alter table public.issues enable row level security;

create policy "read issues in allowed channels" on public.issues
  for select to authenticated
  using (workplace_id = public.my_workplace_id() and public.can_access_channel(channel));

revoke all on public.issues from anon, authenticated;
grant select on public.issues to authenticated;

alter publication supabase_realtime add table public.issues;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Turn a JSON array of strings into uuids, skipping anything that is not a uuid.
create or replace function public.jsonb_uuid_array(p jsonb)
returns uuid[] language sql immutable as $$
  select coalesce(array_agg(x::uuid), '{}')
  from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as x
  where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

create or replace function public.can_manage_issues()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('supervisor', 'manager')
$$;

-- ---------------------------------------------------------------------------
-- AI updates from the shift brief (service role only)
--
-- p_new:      [{ "title", "severity", "source_message_ids": [uuid], "already_resolved": bool }]
-- p_resolved: [{ "issue_id": uuid, "source_message_ids": [uuid] }]
-- Everything is checked against what p_user can see: sources must be messages in
-- their workplace and channels, and only visible open issues can be resolved.
-- ---------------------------------------------------------------------------

create or replace function public.apply_brief_updates(p_user uuid, p_new jsonb, p_resolved jsonb, p_still_open uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  item jsonb;
  src uuid[];
  ch text;
  done boolean;
  new_id uuid;
  hit uuid;
  created uuid[] := '{}';
  resolved uuid[] := '{}';
begin
  select * into me from public.profiles where id = p_user;
  if me.workplace_id is null then raise exception 'No workplace'; end if;

  for item in select * from jsonb_array_elements(case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end) loop
    continue when coalesce(trim(item ->> 'title'), '') = '';
    -- Sources must be real messages this person can see. The issue takes the most
    -- restricted channel among them, so it is never shown to people who could not see a source.
    select array_agg(m.id),
           (array_agg(m.channel order by case m.channel when 'management' then 3 when 'supervisors' then 2 else 1 end desc, m.created_at))[1]
      into src, ch
      from public.messages m
     where m.id = any(public.jsonb_uuid_array(item -> 'source_message_ids'))
       and m.workplace_id = me.workplace_id
       and public.role_can_access(me.role, m.channel);
    continue when src is null;
    -- Already tracked: a source message belongs to an open issue.
    continue when exists (
      select 1 from public.issues i
      where i.workplace_id = me.workplace_id and i.status = 'open' and i.source_message_ids && src
    );
    done := coalesce((item ->> 'already_resolved')::boolean, false);
    insert into public.issues (workplace_id, channel, title, severity, status, source_message_ids, created_by, resolved_at)
    values (me.workplace_id, ch, left(trim(item ->> 'title'), 200),
            case when item ->> 'severity' = 'critical' then 'critical' else 'normal' end,
            case when done then 'resolved' else 'open' end,
            src, p_user, case when done then now() end)
    returning id into new_id;
    created := created || new_id;
  end loop;

  for item in select * from jsonb_array_elements(case when jsonb_typeof(p_resolved) = 'array' then p_resolved else '[]'::jsonb end) loop
    hit := null;
    update public.issues i
       set status = 'resolved', resolved_at = now(), resolved_by = null,
           resolution_message_ids = coalesce((
             select array_agg(m.id) from public.messages m
             where m.id = any(public.jsonb_uuid_array(item -> 'source_message_ids'))
               and m.workplace_id = me.workplace_id and public.role_can_access(me.role, m.channel)), '{}')
     where i.id = any(public.jsonb_uuid_array(jsonb_build_array(item ->> 'issue_id')))
       and i.workplace_id = me.workplace_id
       and i.status = 'open'
       and public.role_can_access(me.role, i.channel)
    returning i.id into hit;
    if hit is not null then resolved := resolved || hit; end if;
  end loop;

  update public.issues
     set last_seen_at = now()
   where id = any(coalesce(p_still_open, '{}'))
     and workplace_id = me.workplace_id and status = 'open' and public.role_can_access(me.role, channel);

  return jsonb_build_object('created', to_jsonb(created), 'resolved', to_jsonb(resolved));
end;
$$;

-- ---------------------------------------------------------------------------
-- Supervisor and manager actions
-- ---------------------------------------------------------------------------

create or replace function public.resolve_issue(p_issue uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_issues() then raise exception 'Only supervisors and managers can resolve issues'; end if;
  update public.issues
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
   where id = p_issue and workplace_id = public.my_workplace_id()
     and public.can_access_channel(channel) and status = 'open';
  if not found then raise exception 'That issue is already resolved or no longer available.'; end if;
end;
$$;

create or replace function public.reopen_issue(p_issue uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_issues() then raise exception 'Only supervisors and managers can reopen issues'; end if;
  update public.issues
     set status = 'open', resolved_at = null, resolved_by = null, resolution_message_ids = '{}'
   where id = p_issue and workplace_id = public.my_workplace_id()
     and public.can_access_channel(channel) and status = 'resolved';
  if not found then raise exception 'That issue is already open or no longer available.'; end if;
end;
$$;

create or replace function public.assign_issue(p_issue uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  iss public.issues;
  owner_role text;
begin
  if not public.can_manage_issues() then raise exception 'Only supervisors and managers can assign issues'; end if;
  select * into iss from public.issues
   where id = p_issue and workplace_id = public.my_workplace_id() and public.can_access_channel(channel);
  if not found then raise exception 'That issue is no longer available.'; end if;
  if p_owner is not null then
    select role into owner_role from public.profiles where id = p_owner and workplace_id = iss.workplace_id;
    if owner_role is null then raise exception 'That person is not in your workplace.'; end if;
    if not public.role_can_access(owner_role, iss.channel) then
      raise exception 'That person cannot see the channel this issue came from.';
    end if;
  end if;
  update public.issues set owner_id = p_owner where id = p_issue;
end;
$$;

revoke execute on function public.apply_brief_updates(uuid, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.apply_brief_updates(uuid, jsonb, jsonb, uuid[]) to service_role;

revoke execute on function public.resolve_issue(uuid), public.reopen_issue(uuid), public.assign_issue(uuid, uuid),
  public.can_manage_issues() from public, anon;
grant execute on function public.resolve_issue(uuid), public.reopen_issue(uuid), public.assign_issue(uuid, uuid),
  public.can_manage_issues() to authenticated;
