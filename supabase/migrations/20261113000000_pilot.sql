-- Pilot: usage analytics (counts only), AI usage and daily caps, founder dashboard,
-- feedback, the first-run manager checklist and the demo workspace.
--
-- Nothing here stores message content. Analytics are per-workplace counts.

-- ---------------------------------------------------------------------------
-- Platform admins (founder dashboard). Add one with:
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';
-- Admin functions also require two-factor sign-in (aal2).
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- Lets the app show the dashboard link and ask for two-factor sign-in.
create or replace function public.my_admin_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'admin', exists (select 1 from public.platform_admins where user_id = auth.uid()),
    'mfa', coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
$$;

-- ---------------------------------------------------------------------------
-- Workplace settings that only the platform can change
-- ---------------------------------------------------------------------------

alter table public.workplaces add column is_demo boolean not null default false;
alter table public.workplaces add column daily_ai_cap integer not null default 40 check (daily_ai_cap between 0 and 10000);
grant select (is_demo) on public.workplaces to authenticated;  -- daily_ai_cap stays private

-- Local date for daily counts (the pilot venues are in Australia).
create or replace function public.pilot_today()
returns date language sql stable as $$ select (now() at time zone 'Australia/Sydney')::date $$;

-- ---------------------------------------------------------------------------
-- Usage analytics: one row per person per workplace per day. Counts only.
-- ---------------------------------------------------------------------------

create table public.activity_days (
  workplace_id  uuid not null references public.workplaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  day           date not null,
  opens         integer not null default 0,
  brief_views   integer not null default 0,
  primary key (workplace_id, user_id, day)
);
alter table public.activity_days enable row level security; -- no policies: written and read only by functions
revoke all on public.activity_days from anon, authenticated;

create or replace function public.record_activity(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  wp uuid := public.my_workplace_id();
begin
  if wp is null or p_kind not in ('open', 'brief_view') then return; end if;
  insert into public.activity_days (workplace_id, user_id, day, opens, brief_views)
  values (wp, auth.uid(), public.pilot_today(),
          case when p_kind = 'open' then 1 else 0 end,
          case when p_kind = 'brief_view' then 1 else 0 end)
  on conflict (workplace_id, user_id, day) do update
    set opens = public.activity_days.opens + excluded.opens,
        brief_views = public.activity_days.brief_views + excluded.brief_views;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI usage per workplace per day, and the daily cap on fresh briefs
-- ---------------------------------------------------------------------------

create table public.ai_usage (
  workplace_id   uuid not null references public.workplaces (id) on delete cascade,
  day            date not null,
  calls          integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  primary key (workplace_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Reserve one Claude call for a workplace today, unless it has hit its cap.
create or replace function public.claim_ai_call(p_workplace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cap integer;
  used integer;
begin
  select daily_ai_cap into cap from public.workplaces where id = p_workplace;
  if cap is null then return jsonb_build_object('allowed', false, 'cap', 0, 'used', 0); end if;
  insert into public.ai_usage (workplace_id, day) values (p_workplace, public.pilot_today())
  on conflict (workplace_id, day) do nothing;
  select calls into used from public.ai_usage where workplace_id = p_workplace and day = public.pilot_today() for update;
  if used >= cap then return jsonb_build_object('allowed', false, 'cap', cap, 'used', used); end if;
  update public.ai_usage set calls = calls + 1 where workplace_id = p_workplace and day = public.pilot_today();
  return jsonb_build_object('allowed', true, 'cap', cap, 'used', used + 1);
end;
$$;

create or replace function public.record_ai_tokens(p_workplace uuid, p_input bigint, p_output bigint)
returns void language sql security definer set search_path = public as $$
  update public.ai_usage
     set input_tokens = input_tokens + greatest(coalesce(p_input, 0), 0),
         output_tokens = output_tokens + greatest(coalesce(p_output, 0), 0)
   where workplace_id = p_workplace and day = public.pilot_today()
$$;

-- ---------------------------------------------------------------------------
-- Feedback from the in-app "Send feedback" button
-- ---------------------------------------------------------------------------

create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  workplace_id  uuid references public.workplaces (id) on delete set null,
  user_id       uuid references public.profiles (id) on delete set null,
  screen        text not null check (char_length(screen) <= 200),
  message       text not null check (char_length(trim(message)) between 1 and 2000),
  app_version   text check (char_length(app_version) <= 40),
  user_agent    text check (char_length(user_agent) <= 400),
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.feedback enable row level security; -- no policies: only functions read and write it
revoke all on public.feedback from anon, authenticated;

create or replace function public.submit_feedback(p_screen text, p_message text, p_app_version text default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to send feedback.'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write a message before sending.'; end if;
  if (select count(*) from public.feedback where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of feedback today. Thank you! Try again tomorrow.';
  end if;
  insert into public.feedback (workplace_id, user_id, screen, message, app_version, user_agent, is_demo)
  values (public.my_workplace_id(), auth.uid(), left(coalesce(p_screen, ''), 200), left(trim(p_message), 2000),
          left(p_app_version, 40), left(p_user_agent, 400),
          coalesce((select is_demo from public.workplaces where id = public.my_workplace_id()), false));
end;
$$;

-- ---------------------------------------------------------------------------
-- First-run checklist for managers
-- ---------------------------------------------------------------------------

alter table public.profiles add column checklist_dismissed_at timestamptz;
grant update (checklist_dismissed_at) on public.profiles to authenticated;

create or replace function public.manager_checklist()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'staff_invited', (select count(*) from public.profiles where workplace_id = public.my_workplace_id()) > 1,
    'announcement_posted', exists (select 1 from public.messages where workplace_id = public.my_workplace_id() and channel = 'announcements'),
    'notifications_on', exists (select 1 from public.push_subscriptions where user_id = auth.uid()),
    'brief_refreshed', exists (select 1 from public.summaries where user_id = auth.uid() and workplace_id = public.my_workplace_id()),
    'dismissed', (select checklist_dismissed_at is not null from public.profiles where id = auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- Founder dashboard data: per-workplace counts only (no names, no content)
-- ---------------------------------------------------------------------------

create or replace function public.admin_workplace_stats()
returns table (
  workplace_id uuid, name text, is_demo boolean, created_at timestamptz,
  members bigint, active_7d bigint, active_prev_7d bigint,
  messages_7d bigint, messages_total bigint, brief_views_7d bigint, brief_refreshes_7d bigint,
  issues_open bigint, issues_resolved_7d bigint, push_opted_in bigint,
  ai_calls_today bigint, daily_ai_cap integer, ai_calls_7d bigint, input_tokens_7d bigint, output_tokens_7d bigint,
  feedback_7d bigint
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
    (select count(*) from public.feedback f where f.workplace_id = w.id and f.created_at > now() - interval '7 days')
  from public.workplaces w
  order by w.is_demo, w.name;
end;
$$;

create or replace function public.admin_recent_feedback(p_limit integer default 50)
returns table (created_at timestamptz, workplace text, screen text, message text, app_version text, is_demo boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only Handover admins can see this.'; end if;
  return query
  select f.created_at, coalesce(w.name, 'No workplace'), f.screen, f.message, f.app_version, f.is_demo
  from public.feedback f left join public.workplaces w on w.id = f.workplace_id
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function public.admin_set_ai_cap(p_workplace uuid, p_cap integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only Handover admins can change this.'; end if;
  if p_cap is null or p_cap < 0 or p_cap > 10000 then raise exception 'Choose a daily limit between 0 and 10,000.'; end if;
  update public.workplaces set daily_ai_cap = p_cap where id = p_workplace;
  if not found then raise exception 'That workplace no longer exists.'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo workspace lockdown: demo accounts are public, so they can't leave the
-- demo, nobody can join it, and it has a small AI cap.
-- ---------------------------------------------------------------------------

create or replace function public.in_demo_workplace(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select w.is_demo from public.profiles p join public.workplaces w on w.id = p.workplace_id where p.id = p_user), false)
$$;

create or replace function public.leave_workplace()
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  managers int;
  members int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.workplace_id is null then return; end if;
  if public.in_demo_workplace(me.id) then
    raise exception 'Demo accounts stay in the demo workplace. Ask the Handover team to reset it instead.';
  end if;

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

  select * into w from public.workplaces where join_code = upper(trim(coalesce(p_code, ''))) and not is_demo;
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

-- Demo accounts use this email domain; seeding refuses any other account.
create or replace function public.demo_account_ids()
returns table (email text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select u.email::text, u.id from auth.users u where u.email like '%@demo.handover.test'
$$;

-- Wipe and re-create the demo workspace with realistic sample data.
-- p_users: {"manager": uuid, "supervisor": uuid, "staff": [uuid, uuid, uuid]}
create or replace function public.seed_demo_workspace(p_users jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  demo constant uuid := '00000000-0000-4000-8000-00000000de00';
  mgr uuid := (p_users ->> 'manager')::uuid;
  sup uuid := (p_users ->> 'supervisor')::uuid;
  s1 uuid := (p_users -> 'staff' ->> 0)::uuid;
  s2 uuid := (p_users -> 'staff' ->> 1)::uuid;
  s3 uuid := (p_users -> 'staff' ->> 2)::uuid;
  everyone uuid[];
  m record;
  msg_ids jsonb := '{}';
  new_id uuid;
begin
  everyone := array[mgr, sup, s1, s2, s3];
  if array_position(everyone, null) is not null then raise exception 'All five demo accounts are needed'; end if;
  -- Never touch a real person: every account must be a demo account.
  if exists (select 1 from unnest(everyone) as u(id) left join auth.users au on au.id = u.id
             where au.email is null or au.email not like '%@demo.handover.test') then
    raise exception 'Only demo accounts can be seeded';
  end if;

  delete from public.workplaces where id = demo;  -- cascades to all demo data
  delete from public.push_subscriptions where user_id = any(everyone);

  insert into public.workplaces (id, name, join_code, owner_id, is_demo, daily_ai_cap)
  values (demo, 'Harbour Hotel (Demo)', 'DEMO26', mgr, true, 20);

  update public.profiles p set
    workplace_id = demo, avatar_url = null, has_onboarded = true, checklist_dismissed_at = now(),
    notification_settings = '{"general": true, "announcements": true, "team_member": true, "supervisors": true, "management": true}',
    role = case p.id when mgr then 'manager' when sup then 'supervisor' else 'team_member' end,
    display_name = case p.id when mgr then 'Ana Okafor' when sup then 'Tom Reyes' when s1 then 'Priya Shah' when s2 then 'Liam Walsh' else 'Kofi Mensah' end
  where p.id = any(everyone);

  -- Three days of realistic chat. (key, channel, author, minutes ago, text)
  for m in
    select * from (values
      ('rota',      'announcements', mgr, 60*70, 'New rota for next week is up. Check your shifts and request any swaps by Friday.'),
      ('glass',     'general',       sup, 60*68, 'Glasswasher in Bar 1 is leaking again. Towels down and a wet floor sign out. Engineer booked.'),
      ('glass2',    'supervisors',   sup, 60*67, 'Engineer can''t come until Thursday for the glasswasher. Using the back-bar machine until then.'),
      ('breakfast', 'general',       s1,  60*50, 'Breakfast service went smoothly, 64 covers.'),
      ('heater',    'supervisors',   sup, 60*46, 'Terrace heater 3 won''t light. Taped it off. Can we get it looked at before the weekend?'),
      ('till',      'management',    mgr, 60*44, 'Till 2 was £20 short on Friday night. Looks like a refund keyed twice. I''ll brief the bar team.'),
      ('swap',      'team_member',   s2,  60*30, 'Can anyone cover my Sunday late (4pm to close)? Family thing.'),
      ('swap2',     'team_member',   s1,  60*29, 'I can take it, Liam. Swap you for Thursday early?'),
      ('room214',   'general',       s2,  60*26, 'Guest in 214 complained about noise from the function room after 11pm. Offered a late checkout.'),
      ('milk',      'general',       s3,  60*20, 'Fairfield Dairy delivered 6 milk instead of 12. Supplier says the rest comes by 10am.'),
      ('room214b',  'supervisors',   sup, 60*18, 'Room 214 is sorted, guest happy with the late checkout. Closing that one.'),
      ('card',      'general',       s3,  60*8,  'Card machine on the terrace keeps dropping signal. Using the spare from reception.'),
      ('fire',      'announcements', mgr, 60*6,  'Fire alarm test on Tuesday at 11am. No need to evacuate, but please let guests know.'),
      ('card2',     'general',       sup, 60*3,  'Terrace card machine is fixed: router was unplugged. Spare is back at reception.'),
      ('wedding',   'general',       mgr, 50,    'Wedding party arrives at 2pm. All hands on room turnaround please, rooms 301 to 310 first.'),
      ('linen',     'team_member',   s1,  25,    'Floor 3 linen cupboard is running low on pillowcases. I''ve asked housekeeping for more.')
    ) as t(k, channel, author, mins, body)
  loop
    insert into public.messages (workplace_id, channel, author_id, content, created_at)
    values (demo, m.channel, m.author, m.body, now() - make_interval(mins => m.mins))
    returning id into new_id;
    msg_ids := msg_ids || jsonb_build_object(m.k, new_id);
  end loop;

  insert into public.likes (message_id, user_id)
  select (msg_ids ->> k)::uuid, u from (values
    ('rota', s1), ('rota', s2), ('rota', s3), ('rota', sup), ('breakfast', mgr), ('breakfast', sup),
    ('swap2', s2), ('room214b', mgr), ('wedding', s1), ('wedding', s3), ('wedding', sup), ('card2', mgr)) as l(k, u);

  -- Issues, including ones older than 24 hours, so carry-over shows straight away.
  insert into public.issues (workplace_id, channel, title, severity, status, owner_id, source_message_ids, created_by, resolved_by, created_at, resolved_at) values
    (demo, 'general', 'Glasswasher in Bar 1 is leaking; engineer booked for Thursday', 'critical', 'open', sup,
      array[(msg_ids ->> 'glass')::uuid, (msg_ids ->> 'glass2')::uuid], mgr, null, now() - interval '68 hours', null),
    (demo, 'supervisors', 'Terrace heater 3 won''t light and is taped off', 'critical', 'open', null,
      array[(msg_ids ->> 'heater')::uuid], mgr, null, now() - interval '46 hours', null),
    (demo, 'general', 'Fairfield Dairy delivered 6 of 12 milk; rest due by 10am', 'normal', 'open', s3,
      array[(msg_ids ->> 'milk')::uuid], mgr, null, now() - interval '20 hours', null),
    (demo, 'team_member', 'Floor 3 linen cupboard low on pillowcases', 'normal', 'open', null,
      array[(msg_ids ->> 'linen')::uuid], mgr, null, now() - interval '25 minutes', null),
    (demo, 'management', 'Till 2 was £20 short on Friday night', 'normal', 'open', mgr,
      array[(msg_ids ->> 'till')::uuid], mgr, null, now() - interval '44 hours', null),
    (demo, 'general', 'Room 214 noise complaint about the function room', 'normal', 'resolved', null,
      array[(msg_ids ->> 'room214')::uuid], mgr, sup, now() - interval '26 hours', now() - interval '18 hours'),
    (demo, 'general', 'Terrace card machine keeps dropping signal', 'critical', 'resolved', null,
      array[(msg_ids ->> 'card')::uuid], mgr, null, now() - interval '8 hours', now() - interval '3 hours');

  -- A recent brief for each person, so Home is complete before anyone refreshes.
  insert into public.summaries (workplace_id, user_id, content, created_at)
  select demo, p.id, jsonb_build_object(
    'next_priority', jsonb_build_array(
      'Turn round rooms 301 to 310 for the wedding party arriving at 2pm.',
      'Keep the wet floor sign by the Bar 1 glasswasher until the engineer comes on Thursday.',
      'Chase the rest of the Fairfield Dairy milk delivery.'),
    'message_count', 14, 'role', p.role,
    'channels', (select coalesce(jsonb_agg(c), '[]'::jsonb) from unnest(array['General', 'Announcements', 'Team Member', 'Supervisors', 'Management']) c
                 where (c <> 'Supervisors' or p.role in ('supervisor', 'manager')) and (c <> 'Management' or p.role = 'manager')),
    'new_issue_ids', '[]'::jsonb, 'resolved_issue_ids', '[]'::jsonb, 'still_open_issue_ids', '[]'::jsonb),
    now() - interval '40 minutes'
  from public.profiles p where p.id = any(everyone);

  -- Read up to a few hours ago, so a few channels show unread counts.
  insert into public.channel_reads (user_id, workplace_id, channel, last_read_at)
  select u, demo, c, now() - interval '4 hours'
  from unnest(everyone) u, unnest(array['general', 'announcements', 'team_member', 'supervisors', 'management']) c
  on conflict (user_id, workplace_id, channel) do update set last_read_at = excluded.last_read_at;

  return jsonb_build_object('workplace_id', demo, 'messages', (select count(*) from public.messages where workplace_id = demo));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public.is_platform_admin(), public.my_admin_status(), public.record_activity(text),
  public.submit_feedback(text, text, text, text), public.manager_checklist(), public.admin_workplace_stats(),
  public.admin_recent_feedback(integer), public.admin_set_ai_cap(uuid, integer) from public, anon;
grant execute on function public.is_platform_admin(), public.my_admin_status(), public.record_activity(text),
  public.submit_feedback(text, text, text, text), public.manager_checklist(), public.admin_workplace_stats(),
  public.admin_recent_feedback(integer), public.admin_set_ai_cap(uuid, integer) to authenticated;

revoke execute on function public.claim_ai_call(uuid), public.record_ai_tokens(uuid, bigint, bigint),
  public.demo_account_ids(), public.seed_demo_workspace(jsonb), public.in_demo_workplace(uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_call(uuid), public.record_ai_tokens(uuid, bigint, bigint),
  public.demo_account_ids(), public.seed_demo_workspace(jsonb), public.in_demo_workplace(uuid) to service_role;
