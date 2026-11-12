-- Shift reports: supervisors and managers complete a daily report (overview,
-- incidents, hazards, resolutions, handover notes), start from an AI draft,
-- edit and submit. The shift brief uses submitted reports as a source.
--
-- Field visibility (fixed, no per-report switch):
--   shared with everyone's brief:      hazards, resolutions, handover_notes
--   supervisors and managers only:     overview, incidents
-- Team members never read reports themselves, only shared fields through the brief.

create table public.shift_reports (
  id              uuid primary key default gen_random_uuid(),
  workplace_id    uuid not null references public.workplaces (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  report_date     date not null default public.pilot_today(),
  shift           text not null default 'day' check (shift in ('day', 'am', 'pm', 'night')),
  overview        text not null default '' check (char_length(overview) <= 4000),
  incidents       text not null default '' check (char_length(incidents) <= 4000),
  hazards         text not null default '' check (char_length(hazards) <= 4000),
  resolutions     text not null default '' check (char_length(resolutions) <= 4000),
  handover_notes  text not null default '' check (char_length(handover_notes) <= 4000),
  status          text not null default 'draft' check (status in ('draft', 'submitted')),
  ai_drafted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  edited_at       timestamptz,
  check ((status = 'submitted') = (submitted_at is not null)),
  unique (workplace_id, author_id, report_date, shift)
);
create index shift_reports_recent_idx on public.shift_reports (workplace_id, status, submitted_at desc);

-- Every earlier version of a submitted report, kept when it is edited. Managers can view them.
create table public.shift_report_versions (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.shift_reports (id) on delete cascade,
  version         integer not null,
  overview        text not null,
  incidents       text not null,
  hazards         text not null,
  resolutions     text not null,
  handover_notes  text not null,
  saved_at        timestamptz not null,  -- when this version was submitted or last saved
  replaced_at     timestamptz not null default now(),
  unique (report_id, version)
);

alter table public.shift_reports enable row level security;
alter table public.shift_report_versions enable row level security;

-- Supervisors and managers read every submitted report in their workplace; drafts only by their author.
create policy "supervisors and managers read reports" on public.shift_reports
  for select to authenticated
  using (
    workplace_id = public.my_workplace_id()
    and public.my_role() in ('supervisor', 'manager')
    and (status = 'submitted' or author_id = auth.uid())
  );

create policy "managers read earlier versions" on public.shift_report_versions
  for select to authenticated
  using (
    public.my_role() = 'manager'
    and exists (select 1 from public.shift_reports r where r.id = report_id and r.workplace_id = public.my_workplace_id())
  );

revoke all on public.shift_reports, public.shift_report_versions from anon, authenticated;
grant select on public.shift_reports, public.shift_report_versions to authenticated;

alter publication supabase_realtime add table public.shift_reports;

-- Issues can now come from report fields as well as messages ("<report id>:<field>").
alter table public.issues add column source_report_refs text[] not null default '{}';
create index issues_report_refs_idx on public.issues using gin (source_report_refs);

-- ---------------------------------------------------------------------------
-- Writing reports
-- ---------------------------------------------------------------------------

-- Start of today in the pilot's time zone, for "today's messages" in AI drafts.
create or replace function public.report_day_start()
returns timestamptz language sql stable as $$
  select (public.pilot_today()::timestamp at time zone 'Australia/Sydney')
$$;

-- Get (or start) the signed-in person's report for today and a shift.
create or replace function public.start_shift_report(p_shift text default 'day')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if public.my_role() not in ('supervisor', 'manager') then
    raise exception 'Only supervisors and managers write shift reports.';
  end if;
  if coalesce(p_shift, 'day') not in ('day', 'am', 'pm', 'night') then raise exception 'Choose Day, AM, PM or Night.'; end if;
  select id into rid from public.shift_reports
   where workplace_id = public.my_workplace_id() and author_id = auth.uid()
     and report_date = public.pilot_today() and shift = coalesce(p_shift, 'day');
  if rid is null then
    insert into public.shift_reports (workplace_id, author_id, shift)
    values (public.my_workplace_id(), auth.uid(), coalesce(p_shift, 'day'))
    returning id into rid;
  end if;
  return rid;
end;
$$;

-- Save a report. Drafts save freely. A submitted report can be changed by its
-- author for 24 hours; each change keeps the previous version. Then it's locked.
create or replace function public.update_shift_report(p_report uuid, p_fields jsonb, p_submit boolean default false, p_ai_drafted boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.shift_reports;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  k text;
begin
  select * into r from public.shift_reports where id = p_report for update;
  if not found or r.author_id is distinct from auth.uid() or r.workplace_id is distinct from public.my_workplace_id() then
    raise exception 'That report is not yours to change.';
  end if;
  if public.my_role() not in ('supervisor', 'manager') then
    raise exception 'Only supervisors and managers write shift reports.';
  end if;
  for k in select jsonb_object_keys(f) loop
    if k not in ('overview', 'incidents', 'hazards', 'resolutions', 'handover_notes') then
      raise exception 'Unknown report field: %', k;
    end if;
    if char_length(coalesce(f ->> k, '')) > 4000 then raise exception 'Each section can be up to 4,000 characters.'; end if;
  end loop;

  if r.status = 'submitted' then
    if now() > r.submitted_at + interval '24 hours' then
      raise exception 'This report is locked. Reports can be changed for 24 hours after they are submitted.';
    end if;
    insert into public.shift_report_versions (report_id, version, overview, incidents, hazards, resolutions, handover_notes, saved_at)
    values (r.id, coalesce((select max(version) from public.shift_report_versions where report_id = r.id), 0) + 1,
            r.overview, r.incidents, r.hazards, r.resolutions, r.handover_notes, coalesce(r.edited_at, r.submitted_at));
  end if;

  update public.shift_reports set
    overview       = coalesce(f ->> 'overview', overview),
    incidents      = coalesce(f ->> 'incidents', incidents),
    hazards        = coalesce(f ->> 'hazards', hazards),
    resolutions    = coalesce(f ->> 'resolutions', resolutions),
    handover_notes = coalesce(f ->> 'handover_notes', handover_notes),
    ai_drafted     = coalesce(p_ai_drafted, ai_drafted),
    updated_at     = now(),
    status         = case when p_submit then 'submitted' else status end,
    submitted_at   = case when r.status = 'draft' and p_submit then now() else submitted_at end,
    edited_at      = case when r.status = 'submitted' then now() else edited_at end
  where id = r.id
  returning * into r;

  return jsonb_build_object('id', r.id, 'status', r.status, 'submitted_at', r.submitted_at, 'edited_at', r.edited_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports as a source for the shift brief, filtered by the reader's role.
-- Team members get only hazards, resolutions and handover notes.
-- ---------------------------------------------------------------------------

create or replace function public.brief_report_context()
returns table (report_id uuid, report_date date, shift text, author text, changed_at timestamptz,
               overview text, incidents text, hazards text, resolutions text, handover_notes text)
language sql stable security definer set search_path = public as $$
  select r.id, r.report_date, r.shift, coalesce(p.display_name, 'Former member'),
         coalesce(r.edited_at, r.submitted_at),
         case when public.my_role() in ('supervisor', 'manager') then r.overview end,
         case when public.my_role() in ('supervisor', 'manager') then r.incidents end,
         r.hazards, r.resolutions, r.handover_notes
  from public.shift_reports r
  left join public.profiles p on p.id = r.author_id
  where r.workplace_id = public.my_workplace_id()
    and r.status = 'submitted'
    and coalesce(r.edited_at, r.submitted_at) > now() - interval '24 hours'
  order by coalesce(r.edited_at, r.submitted_at) desc
  limit 10
$$;

-- AI updates from the brief, now accepting report fields as sources.
-- p_new items: { title, severity, source_message_ids: [uuid], source_report_refs: ["<report id>:<field>"], already_resolved }
create or replace function public.apply_brief_updates(p_user uuid, p_new jsonb, p_resolved jsonb, p_still_open uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  item jsonb;
  src uuid[];
  ch text;
  rsrc text[];
  rlevel int;
  rank int;
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
    src := null; ch := null; rsrc := null; rlevel := null;

    -- Message sources: messages this person can see.
    select array_agg(m.id),
           (array_agg(m.channel order by case m.channel when 'management' then 3 when 'supervisors' then 2 else 1 end desc, m.created_at))[1]
      into src, ch
      from public.messages m
     where m.id = any(public.jsonb_uuid_array(item -> 'source_message_ids'))
       and m.workplace_id = me.workplace_id
       and public.role_can_access(me.role, m.channel);

    -- Report sources: submitted reports in their workplace, and only fields their role may see.
    select array_agg(x.ref), max(case when x.field in ('overview', 'incidents') then 2 else 1 end)
      into rsrc, rlevel
      from (select r.value as ref, split_part(r.value, ':', 1) as rid, split_part(r.value, ':', 2) as field
              from jsonb_array_elements_text(case when jsonb_typeof(item -> 'source_report_refs') = 'array' then item -> 'source_report_refs' else '[]'::jsonb end) r) x
      join public.shift_reports sr on sr.id::text = x.rid
     where sr.workplace_id = me.workplace_id and sr.status = 'submitted'
       and x.field in ('overview', 'incidents', 'hazards', 'resolutions', 'handover_notes')
       and (x.field in ('hazards', 'resolutions', 'handover_notes') or me.role in ('supervisor', 'manager'));

    continue when src is null and rsrc is null;

    -- The issue takes the most restricted visibility among its sources:
    -- incidents and overview count as the Supervisors channel.
    rank := greatest(
      case when ch is null then 0 when ch = 'management' then 3 when ch = 'supervisors' then 2 else 1 end,
      coalesce(rlevel, 0));
    ch := case when rank = 3 then 'management' when rank = 2 then 'supervisors' else coalesce(ch, 'general') end;

    -- Already tracked: a source message belongs to an open issue, or the same
    -- report section already produced an open issue with this title. (One
    -- section can list several hazards, so the section alone isn't enough.)
    continue when exists (
      select 1 from public.issues i
      where i.workplace_id = me.workplace_id and i.status = 'open'
        and (i.source_message_ids && coalesce(src, '{}')
             or (i.source_report_refs && coalesce(rsrc, '{}') and lower(i.title) = lower(left(trim(item ->> 'title'), 200))))
    );

    done := coalesce((item ->> 'already_resolved')::boolean, false);
    insert into public.issues (workplace_id, channel, title, severity, status, source_message_ids, source_report_refs, created_by, resolved_at)
    values (me.workplace_id, ch, left(trim(item ->> 'title'), 200),
            case when item ->> 'severity' = 'critical' then 'critical' else 'normal' end,
            case when done then 'resolved' else 'open' end,
            coalesce(src, '{}'), coalesce(rsrc, '{}'), p_user, case when done then now() end)
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
-- Demo: a submitted report from yesterday's supervisor, for realism.
-- ---------------------------------------------------------------------------

create or replace function public.seed_demo_reports(p_supervisor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  demo constant uuid := '00000000-0000-4000-8000-00000000de00';
begin
  if not exists (select 1 from auth.users where id = p_supervisor and email like '%@demo.handover.test') then
    raise exception 'Only demo accounts can be seeded';
  end if;
  delete from public.shift_reports where workplace_id = demo;
  insert into public.shift_reports (workplace_id, author_id, report_date, shift, overview, incidents, hazards, resolutions, handover_notes,
                                    status, ai_drafted, created_at, updated_at, submitted_at)
  values (demo, p_supervisor, public.pilot_today() - 1, 'day',
    'Busy day: 64 breakfast covers and a full function room. Two staff short at lunch, covered by moving Liam from housekeeping.',
    'Guest in room 214 complained about function room noise after 11pm. Offered a late checkout, which they accepted.',
    'Wet floor by the Bar 1 glasswasher until the engineer comes on Thursday. Terrace heater 3 is taped off.',
    'Terrace card machine fixed: the router had been unplugged. Spare is back at reception.',
    'Wedding party arrives at 2pm: turn round rooms 301 to 310 first. Chase the rest of the Fairfield Dairy milk delivery.',
    'submitted', true, now() - interval '20 hours', now() - interval '18 hours', now() - interval '18 hours');
end;
$$;

-- ---------------------------------------------------------------------------
-- Export my data now includes reports you wrote; the dashboard counts reports.
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
    'shift_reports', coalesce((
      select jsonb_agg(jsonb_build_object('date', report_date, 'shift', shift, 'status', status, 'overview', overview,
               'incidents', incidents, 'hazards', hazards, 'resolutions', resolutions, 'handover_notes', handover_notes,
               'submitted_at', submitted_at, 'edited_at', edited_at) order by report_date, shift)
      from public.shift_reports where author_id = auth.uid()), '[]'::jsonb),
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

drop function public.admin_workplace_stats();
create function public.admin_workplace_stats()
returns table (
  workplace_id uuid, name text, is_demo boolean, created_at timestamptz,
  members bigint, active_7d bigint, active_prev_7d bigint,
  messages_7d bigint, messages_total bigint, brief_views_7d bigint, brief_refreshes_7d bigint,
  issues_open bigint, issues_resolved_7d bigint, push_opted_in bigint,
  ai_calls_today bigint, daily_ai_cap integer, ai_calls_7d bigint, input_tokens_7d bigint, output_tokens_7d bigint,
  feedback_7d bigint, reports_7d bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.pilot_today();
begin
  if not public.is_platform_admin() then raise exception 'Only Handover admins can see this.'; end if;
  return query
  select w.id, w.name, w.is_demo, w.created_at,
    (select count(*) from public.profiles p where p.workplace_id = w.id),
    (select count(distinct a.user_id) from public.activity_days a where a.workplace_id = w.id and a.day > today - 7),
    (select count(distinct a.user_id) from public.activity_days a where a.workplace_id = w.id and a.day <= today - 7 and a.day > today - 14),
    (select count(*) from public.messages m where m.workplace_id = w.id and m.created_at > now() - interval '7 days'),
    (select count(*) from public.messages m where m.workplace_id = w.id),
    (select coalesce(sum(a.brief_views), 0)::bigint from public.activity_days a where a.workplace_id = w.id and a.day > today - 7),
    (select count(*) from public.summaries s where s.workplace_id = w.id and s.created_at > now() - interval '7 days'),
    (select count(*) from public.issues i where i.workplace_id = w.id and i.status = 'open'),
    (select count(*) from public.issues i where i.workplace_id = w.id and i.resolved_at > now() - interval '7 days'),
    (select count(distinct s.user_id) from public.push_subscriptions s join public.profiles p on p.id = s.user_id where p.workplace_id = w.id),
    (select coalesce(sum(u.calls), 0)::bigint from public.ai_usage u where u.workplace_id = w.id and u.day = today),
    w.daily_ai_cap,
    (select coalesce(sum(u.calls), 0)::bigint from public.ai_usage u where u.workplace_id = w.id and u.day > today - 7),
    (select coalesce(sum(u.input_tokens), 0)::bigint from public.ai_usage u where u.workplace_id = w.id and u.day > today - 7),
    (select coalesce(sum(u.output_tokens), 0)::bigint from public.ai_usage u where u.workplace_id = w.id and u.day > today - 7),
    (select count(*) from public.feedback f where f.workplace_id = w.id and f.created_at > now() - interval '7 days'),
    (select count(*) from public.shift_reports r where r.workplace_id = w.id and r.status = 'submitted' and r.submitted_at > now() - interval '7 days')
  from public.workplaces w
  order by w.is_demo, w.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

grant execute on function public.report_day_start() to authenticated;
revoke execute on function public.start_shift_report(text), public.update_shift_report(uuid, jsonb, boolean, boolean),
  public.brief_report_context(), public.admin_workplace_stats() from public, anon;
grant execute on function public.start_shift_report(text), public.update_shift_report(uuid, jsonb, boolean, boolean),
  public.brief_report_context(), public.admin_workplace_stats() to authenticated;
revoke execute on function public.seed_demo_reports(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_reports(uuid) to service_role;
