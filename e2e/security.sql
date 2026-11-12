-- Database-level security checks. Each test runs as a signed-in user, the way
-- a request through the API would, so it proves the rules hold even if someone
-- bypasses the app. Run against a local stack:
--   docker exec -i supabase_db_handover psql -U postgres -v ON_ERROR_STOP=1 < e2e/security.sql
-- Everything runs in a transaction that is rolled back at the end.

begin;

create temp table results (name text, ok boolean);
grant all on results to authenticated, anon;
grant all on all tables in schema pg_temp to authenticated;

-- Helpers: act as a user, and expect a statement to succeed or fail.
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Same, but signed in with two-factor (aal2), as the founder dashboard requires.
create function pg_temp.act_as_mfa(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

create function pg_temp.expect_error(name text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    insert into results values (name, false);
  exception when others then
    insert into results values (name, true);
  end;
end $$;

create function pg_temp.expect(name text, cond boolean) returns void language plpgsql as $$
begin
  insert into results values (name, coalesce(cond, false));
end $$;

-- People: manager and staff at Harbour, a supervisor there, and someone at another workplace.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000a1', 'sec-mgr@example.com',   '{"full_name":"Sec Manager"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'sec-staff@example.com', '{"full_name":"Sec Staff"}',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'sec-sup@example.com',   '{"full_name":"Sec Super"}',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'sec-out@example.com',   '{"full_name":"Sec Outsider"}','authenticated', 'authenticated');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.create_workplace('Sec Harbour');
create temp table code as select public.get_join_code() as c;
insert into messages (workplace_id, channel, author_id, content)
  values (my_workplace_id(), 'management', auth.uid(), 'mgmt secret'),
         (my_workplace_id(), 'general', auth.uid(), 'manager general');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.join_workplace((select c from code));
insert into messages (workplace_id, channel, author_id, content)
  values (my_workplace_id(), 'general', auth.uid(), 'staff general');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select public.join_workplace((select c from code));

-- Posted after staff joined, so it should count as unread for them.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into messages (workplace_id, channel, author_id, content, created_at)
  values (my_workplace_id(), 'general', auth.uid(), 'manager after join', clock_timestamp());

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.set_member_role('00000000-0000-0000-0000-0000000000c3', 'supervisor');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select public.create_workplace('Sec Other');
insert into messages (workplace_id, channel, author_id, content)
  values (my_workplace_id(), 'general', auth.uid(), 'other secret');

-- ---- Team member ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect('staff sees only their workplace messages',
  (select bool_and(content <> 'other secret') from messages));
select pg_temp.expect('staff cannot read Management',
  not exists (select 1 from messages where channel = 'management'));
select pg_temp.expect('my_channels() gives a team member three channels',
  public.my_channels() = array['general', 'announcements', 'team_member']);
select pg_temp.expect('staff unread counts list only their channels',
  (select array_agg(channel order by channel) from unread_counts()) = array['announcements', 'general', 'team_member']);
select pg_temp.expect('staff start caught up and see only newer messages as unread, not their own',
  (select unread from unread_counts() where channel = 'general') = 1);
delete from messages where content = 'manager general';
select pg_temp.expect('staff cannot delete the manager''s message',
  exists (select 1 from messages where content = 'manager general'));
delete from messages where content = 'staff general';
select pg_temp.expect('staff can delete their own message',
  not exists (select 1 from messages where content = 'staff general'));
select pg_temp.expect_error('staff cannot post in Announcements',
  $$insert into messages (workplace_id, channel, author_id, content) values (my_workplace_id(), 'announcements', auth.uid(), 'x')$$);
select pg_temp.expect_error('staff cannot upload photos to Announcements',
  $$insert into storage.objects (bucket_id, name, owner) values ('message-images', my_workplace_id() || '/announcements/x.jpg', auth.uid())$$);
select pg_temp.expect_error('staff cannot remove members',
  $$select public.remove_member('00000000-0000-0000-0000-0000000000c3')$$);
select pg_temp.expect_error('staff cannot reset the join code',
  $$select public.regenerate_join_code()$$);
reset role;
create temp table mark_before as
  select last_read_at from channel_reads where channel = 'management' and user_id = '00000000-0000-0000-0000-0000000000b2';
grant select on mark_before to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.mark_channel_read('management');
select pg_temp.expect('marking an inaccessible channel read does nothing',
  (select last_read_at from channel_reads where channel = 'management' and user_id = auth.uid()) = (select last_read_at from pg_temp.mark_before));
select public.mark_channel_read('general');
select pg_temp.expect('marking a channel read clears its count',
  (select unread from unread_counts() where channel = 'general') = 0);
select pg_temp.expect_error('staff cannot write read markers directly',
  $$insert into channel_reads (user_id, workplace_id, channel) values (auth.uid(), my_workplace_id(), 'general')$$);

-- ---- Supervisor ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select pg_temp.expect('my_channels() adds Supervisors for a supervisor',
  public.my_channels() = array['general', 'announcements', 'team_member', 'supervisors']);
select pg_temp.expect('supervisor unread counts include Supervisors but not Management',
  (select array_agg(channel order by channel) from unread_counts()) = array['announcements', 'general', 'supervisors', 'team_member']);
insert into messages (workplace_id, channel, author_id, content) values (my_workplace_id(), 'announcements', auth.uid(), 'supervisor news');
select pg_temp.expect('supervisor can post in Announcements',
  exists (select 1 from messages where content = 'supervisor news'));
delete from messages where content = 'manager general';
select pg_temp.expect('supervisor cannot delete others'' messages',
  exists (select 1 from messages where content = 'manager general'));

-- ---- Outsider ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
delete from messages where content = 'manager general';
reset role;
select pg_temp.expect('another workplace cannot delete Harbour messages',
  exists (select 1 from messages where content = 'manager general'));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect_error('another workplace''s manager cannot remove Harbour staff',
  $$select public.remove_member('00000000-0000-0000-0000-0000000000b2')$$);
select pg_temp.expect('another workplace sees no Harbour read markers',
  not exists (select 1 from channel_reads where user_id <> auth.uid()));

-- ---- Push notifications ----
create temp table keys as select 'B' || repeat('A', 86) as p256dh, repeat('a', 22) as auth;
grant select on keys to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.save_push_subscription('https://push.example.com/staff', (select p256dh from pg_temp.keys), (select auth from pg_temp.keys), 'test');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select public.save_push_subscription('https://push.example.com/sup', (select p256dh from pg_temp.keys), (select auth from pg_temp.keys), 'test');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.save_push_subscription('https://push.example.com/mgr', (select p256dh from pg_temp.keys), (select auth from pg_temp.keys), 'test');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select public.save_push_subscription('https://push.example.com/out', (select p256dh from pg_temp.keys), (select auth from pg_temp.keys), 'test');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect('people see only their own push devices',
  (select count(*) from push_subscriptions) = 1 and (select endpoint from push_subscriptions) = 'https://push.example.com/staff');
delete from push_subscriptions where endpoint = 'https://push.example.com/mgr';
reset role;
select pg_temp.expect('people cannot remove someone else''s device',
  exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/mgr'));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error('devices cannot be added for someone else directly',
  $$insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-0000000000a1', 'https://evil.example.com/x', 'x', 'y')$$);
select pg_temp.expect_error('devices cannot be edited directly',
  $$update push_subscriptions set endpoint = 'https://evil.example.com/x'$$);
select pg_temp.expect_error('malformed push keys are rejected',
  $$select public.save_push_subscription('https://push.example.com/bad', 'not-a-key', 'short', null)$$);
select pg_temp.expect_error('signed-in users cannot ask who gets notified',
  $$select * from public.push_recipients(gen_random_uuid())$$);
select set_config('role', 'anon', true);
select pg_temp.expect_error('signed-out visitors cannot save devices',
  $$select public.save_push_subscription('https://push.example.com/anon', 'x', 'y', null)$$);

reset role;
create temp table msg_ids as
  select content, id from messages where content in ('manager general', 'mgmt secret', 'supervisor news');
with ins as (
  insert into messages (workplace_id, channel, author_id, content)
  select workplace_id, 'supervisors', '00000000-0000-0000-0000-0000000000c3', 'sup in supervisors'
  from profiles where id = '00000000-0000-0000-0000-0000000000c3' returning id)
insert into msg_ids select 'sup in supervisors', id from ins;
create function pg_temp.recipients_of(c text) returns text[] language sql as $$
  select coalesce(array_agg(endpoint order by endpoint), '{}') from public.push_recipients((select id from pg_temp.msg_ids where content = c))
$$;
select pg_temp.expect('manager''s General post notifies staff and supervisor, not the author or another workplace',
  pg_temp.recipients_of('manager general') = array['https://push.example.com/staff', 'https://push.example.com/sup']);
select pg_temp.expect('Management posts notify no one who lacks access',
  pg_temp.recipients_of('mgmt secret') = '{}');
select pg_temp.expect('Supervisors posts notify the manager but not team members',
  pg_temp.recipients_of('sup in supervisors') = array['https://push.example.com/mgr']);
select pg_temp.expect('supervisor''s Announcements post notifies everyone else in the workplace',
  pg_temp.recipients_of('supervisor news') = array['https://push.example.com/mgr', 'https://push.example.com/staff']);
update profiles set notification_settings = notification_settings || '{"general": false}' where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.expect('a channel switched off sends no push',
  pg_temp.recipients_of('manager general') = array['https://push.example.com/sup']);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select public.save_push_subscription('https://push.example.com/staff', (select p256dh from pg_temp.keys), (select auth from pg_temp.keys), 'shared phone');
reset role;
select pg_temp.expect('a device that signs in as someone else moves to them',
  (select user_id from push_subscriptions where endpoint = 'https://push.example.com/staff') = '00000000-0000-0000-0000-0000000000d4');

-- ---- Tracked issues ----
reset role;
create temp table ids as
  select content, id from messages where content in ('manager general', 'mgmt secret', 'supervisor news', 'other secret', 'sup in supervisors');
grant select on ids to authenticated;
create function pg_temp.mid(c text) returns text language sql as $$ select id::text from pg_temp.ids where content = c $$;

-- The brief's write path (service role) checks everything against the person it runs for.
create temp table applied as select public.apply_brief_updates('00000000-0000-0000-0000-0000000000b2',
  jsonb_build_array(
    jsonb_build_object('title', 'General problem', 'severity', 'critical', 'source_message_ids', jsonb_build_array(pg_temp.mid('manager general')), 'already_resolved', false),
    jsonb_build_object('title', 'Sneaky management issue', 'severity', 'critical', 'source_message_ids', jsonb_build_array(pg_temp.mid('mgmt secret')), 'already_resolved', false),
    jsonb_build_object('title', 'Other workplace issue', 'severity', 'normal', 'source_message_ids', jsonb_build_array(pg_temp.mid('other secret')), 'already_resolved', false),
    jsonb_build_object('title', 'Junk ids', 'severity', 'normal', 'source_message_ids', jsonb_build_array('not-a-uuid', 42), 'already_resolved', false)
  ), '[]'::jsonb, '{}') as r;
select pg_temp.expect('the brief creates an issue from a message the person can see',
  exists (select 1 from issues where title = 'General problem' and channel = 'general' and status = 'open'));
select pg_temp.expect('the brief cannot create issues from messages the person cannot see',
  not exists (select 1 from issues where title in ('Sneaky management issue', 'Other workplace issue', 'Junk ids')));
select public.apply_brief_updates('00000000-0000-0000-0000-0000000000b2',
  jsonb_build_array(jsonb_build_object('title', 'General problem again', 'severity', 'normal', 'source_message_ids', jsonb_build_array(pg_temp.mid('manager general')), 'already_resolved', false)),
  '[]'::jsonb, '{}');
select pg_temp.expect('the same problem is not recorded twice',
  not exists (select 1 from issues where title = 'General problem again'));
select public.apply_brief_updates('00000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(jsonb_build_object('title', 'Mixed sources', 'severity', 'critical',
    'source_message_ids', jsonb_build_array(pg_temp.mid('supervisor news'), pg_temp.mid('mgmt secret')), 'already_resolved', false)),
  '[]'::jsonb, '{}');
select pg_temp.expect('an issue takes the most restricted channel among its sources',
  (select channel from issues where title = 'Mixed sources') = 'management');
create temp table iss as select title, id from issues;
grant select on iss to authenticated;
select public.apply_brief_updates('00000000-0000-0000-0000-0000000000b2', '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('issue_id', (select id from pg_temp.iss where title = 'Mixed sources'), 'source_message_ids', '[]'::jsonb)), '{}');
select pg_temp.expect('the brief cannot resolve issues the person cannot see',
  (select status from issues where title = 'Mixed sources') = 'open');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect('team members see issues from their channels only',
  exists (select 1 from issues where title = 'General problem') and not exists (select 1 from issues where title = 'Mixed sources'));
select pg_temp.expect_error('team members cannot add issues directly',
  $$insert into issues (workplace_id, channel, title) values (my_workplace_id(), 'general', 'fake')$$);
select pg_temp.expect_error('team members cannot edit issues directly',
  $$update issues set status = 'resolved', resolved_at = now()$$);
select pg_temp.expect_error('team members cannot delete issues',
  $$delete from issues$$);
select pg_temp.expect_error('team members cannot resolve issues',
  format('select public.resolve_issue(%L)', (select id from pg_temp.iss where title = 'General problem')));
select pg_temp.expect_error('team members cannot assign owners',
  format('select public.assign_issue(%L, auth.uid())', (select id from pg_temp.iss where title = 'General problem')));
select pg_temp.expect_error('signed-in users cannot call the brief''s write function',
  $$select public.apply_brief_updates(auth.uid(), '[]'::jsonb, '[]'::jsonb, '{}')$$);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect('another workplace sees none of Harbour''s issues', not exists (select 1 from issues));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select public.resolve_issue((select id from pg_temp.iss where title = 'General problem'));
select pg_temp.expect('a supervisor can resolve an issue',
  (select status = 'resolved' and resolved_by = auth.uid() from issues where title = 'General problem'));
select public.reopen_issue((select id from pg_temp.iss where title = 'General problem'));
select pg_temp.expect('a supervisor can reopen an issue',
  (select status = 'open' and resolved_at is null from issues where title = 'General problem'));
select pg_temp.expect_error('a supervisor cannot resolve a Management issue',
  format('select public.resolve_issue(%L)', (select id from pg_temp.iss where title = 'Mixed sources')));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error('owners must be able to see the issue''s channel',
  format('select public.assign_issue(%L, %L)', (select id from pg_temp.iss where title = 'Mixed sources'), '00000000-0000-0000-0000-0000000000b2'));
select pg_temp.expect_error('owners must be in the workplace',
  format('select public.assign_issue(%L, %L)', (select id from pg_temp.iss where title = 'General problem'), '00000000-0000-0000-0000-0000000000d4'));
select public.assign_issue((select id from pg_temp.iss where title = 'General problem'), '00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect('a manager can assign an owner who can see the channel',
  (select owner_id from issues where title = 'General problem') = '00000000-0000-0000-0000-0000000000b2');
reset role;
select public.apply_brief_updates('00000000-0000-0000-0000-0000000000a1', '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('issue_id', (select id from pg_temp.iss where title = 'Mixed sources'), 'source_message_ids', jsonb_build_array(pg_temp.mid('mgmt secret')))), '{}');
select pg_temp.expect('the brief can resolve an issue the person can see, recording the message',
  (select status = 'resolved' and resolved_by is null and resolution_message_ids <> '{}' from issues where title = 'Mixed sources'));

-- ---- Launch hardening ----
reset role;
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000e5', 'sec-guesser@example.com', '{"full_name":"Sec Guesser"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f6', 'sec-owner@example.com',   '{"full_name":"Sec Owner"}',   'authenticated', 'authenticated');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
create temp table owner_wp as select (public.create_workplace('Owner Test') ->> 'join_code') as c;
grant select on owner_wp to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5');
select pg_temp.expect('a wrong join code returns a clear error', (public.join_workplace('ZZZZZZ') ->> 'error') like 'That join code%');
select public.join_workplace('ZZZZZ' || g) from generate_series(1, 9) g;
select pg_temp.expect('after 10 wrong codes, even the right code is refused for an hour',
  (public.join_workplace((select c from pg_temp.owner_wp)) ->> 'error') like 'Too many wrong codes%');
select pg_temp.expect_error('people cannot read join attempts', $$select * from join_attempts$$);
select pg_temp.expect_error('people cannot clear their join attempts', $$delete from join_attempts$$);

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f6';
select pg_temp.expect('deleting the person who created a workplace keeps the workplace',
  exists (select 1 from workplaces where name = 'Owner Test' and owner_id is null));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
create temp table my_export as select public.export_my_data() as d;
select pg_temp.expect('Export my data returns your own account',
  (select d -> 'account' ->> 'email' from my_export) = 'sec-staff@example.com');
select pg_temp.expect('Export my data contains no one else''s messages',
  not exists (select 1 from my_export, jsonb_array_elements(d -> 'messages') m where m ->> 'text' in ('manager general', 'mgmt secret', 'other secret')));
select pg_temp.expect('Export my data leaves out device keys',
  (select d::text from my_export) not like '%p256dh%');
select set_config('role', 'anon', true);
select pg_temp.expect_error('signed-out visitors cannot export data', $$select public.export_my_data()$$);

-- ---- Pilot: analytics, AI usage, feedback, admin, checklist, demo ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.record_activity('open');
select public.record_activity('brief_view');
select public.record_activity('something_else');
select public.submit_feedback('Home', 'The brief is great', '0.1.0', 'test');
select pg_temp.expect_error('people cannot read usage analytics', $$select * from activity_days$$);
select pg_temp.expect_error('people cannot read AI usage', $$select * from ai_usage$$);
select pg_temp.expect_error('people cannot read feedback, even their own', $$select * from feedback$$);
select pg_temp.expect_error('people cannot see who the admins are', $$select * from platform_admins$$);
select pg_temp.expect_error('people cannot make themselves admins', $$insert into platform_admins values (auth.uid())$$);
select pg_temp.expect_error('people cannot spend the AI budget directly', format('select public.claim_ai_call(%L)', public.my_workplace_id()));
select pg_temp.expect_error('people cannot log AI tokens', format('select public.record_ai_tokens(%L, 1, 1)', public.my_workplace_id()));
select pg_temp.expect_error('people cannot see the dashboard numbers', $$select * from public.admin_workplace_stats()$$);
select pg_temp.expect_error('people cannot change AI limits', format('select public.admin_set_ai_cap(%L, 9999)', public.my_workplace_id()));
select pg_temp.expect_error('people cannot change workplace settings directly', $$update workplaces set daily_ai_cap = 9999, is_demo = true$$);
select pg_temp.expect_error('people cannot seed the demo', $$select public.seed_demo_workspace('{}'::jsonb)$$);
select pg_temp.expect_error('people cannot list demo accounts', $$select * from public.demo_account_ids()$$);
update profiles set checklist_dismissed_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select pg_temp.expect('activity is counted for your own workplace, ignoring unknown kinds',
  (select opens = 1 and brief_views = 1 from activity_days where user_id = '00000000-0000-0000-0000-0000000000b2'));
select pg_temp.expect('feedback is saved with the workplace',
  exists (select 1 from feedback f join profiles p on p.id = f.user_id where f.message = 'The brief is great' and f.workplace_id = p.workplace_id));
select pg_temp.expect('people cannot hide someone else''s checklist',
  (select checklist_dismissed_at is null from profiles where id = '00000000-0000-0000-0000-0000000000a1'));

-- The daily AI cap
update workplaces set daily_ai_cap = 1 where id = (select workplace_id from profiles where id = '00000000-0000-0000-0000-0000000000b2');
create temp table claims as
  select public.claim_ai_call(workplace_id) as first, public.claim_ai_call(workplace_id) as second
  from profiles where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.expect('the daily cap allows calls up to the limit, then stops',
  (select (first ->> 'allowed')::boolean and not (second ->> 'allowed')::boolean from claims));

-- Admins need two-factor sign-in
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('admins can see they are admins before two-factor',
  (public.my_admin_status() ->> 'admin')::boolean and not (public.my_admin_status() ->> 'mfa')::boolean);
select pg_temp.expect_error('admins without two-factor cannot see the dashboard numbers', $$select * from public.admin_workplace_stats()$$);
select pg_temp.act_as_mfa('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('admins with two-factor see per-venue counts',
  (select count(*) from public.admin_workplace_stats()) >= 2);
select pg_temp.expect('admins with two-factor see feedback',
  exists (select 1 from public.admin_recent_feedback(10) where message = 'The brief is great'));
select public.admin_set_ai_cap((select workplace_id from profiles where id = '00000000-0000-0000-0000-0000000000a1'), 25);
reset role;
select pg_temp.expect('admins with two-factor can change a venue''s daily limit',
  (select daily_ai_cap from workplaces w join profiles p on p.workplace_id = w.id where p.id = '00000000-0000-0000-0000-0000000000a1') = 25);
select pg_temp.act_as_mfa('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error('two-factor alone does not make someone an admin', $$select * from public.admin_workplace_stats()$$);

-- Manager checklist
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('the manager checklist reports progress from real activity',
  (public.manager_checklist() ->> 'staff_invited')::boolean and not (public.manager_checklist() ->> 'dismissed')::boolean);

-- Demo workspace
reset role;
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-00000000d001', 'sec-demo1@demo.handover.test', '{"full_name":"D1"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d002', 'sec-demo2@demo.handover.test', '{"full_name":"D2"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d003', 'sec-demo3@demo.handover.test', '{"full_name":"D3"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d004', 'sec-demo4@demo.handover.test', '{"full_name":"D4"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000d005', 'sec-demo5@demo.handover.test', '{"full_name":"D5"}', 'authenticated', 'authenticated');
select pg_temp.expect_error('the demo seed refuses real accounts',
  $$select public.seed_demo_workspace('{"manager":"00000000-0000-0000-0000-0000000000b2","supervisor":"00000000-0000-0000-0000-00000000d002","staff":["00000000-0000-0000-0000-00000000d003","00000000-0000-0000-0000-00000000d004","00000000-0000-0000-0000-00000000d005"]}')$$);
select pg_temp.expect('a refused seed leaves the real person where they were',
  (select workplace_id from profiles where id = '00000000-0000-0000-0000-0000000000b2') is not distinct from
  (select workplace_id from profiles where id = '00000000-0000-0000-0000-0000000000a1'));
select public.seed_demo_workspace('{"manager":"00000000-0000-0000-0000-00000000d001","supervisor":"00000000-0000-0000-0000-00000000d002","staff":["00000000-0000-0000-0000-00000000d003","00000000-0000-0000-0000-00000000d004","00000000-0000-0000-0000-00000000d005"]}');
select pg_temp.expect('the demo seed creates a full demo workplace',
  (select count(*) from messages m join workplaces w on w.id = m.workplace_id where w.is_demo) = 16
  and (select count(*) from issues i join workplaces w on w.id = i.workplace_id where w.is_demo) = 7);
select pg_temp.act_as('00000000-0000-0000-0000-00000000d003');
select pg_temp.expect_error('demo accounts cannot leave the demo', $$select public.leave_workplace()$$);
select pg_temp.expect_error('demo accounts cannot create workplaces', $$select public.create_workplace('Escape')$$);
select pg_temp.expect('demo accounts cannot see real venues'' messages',
  not exists (select 1 from messages m join workplaces w on w.id = m.workplace_id where not w.is_demo));
select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select pg_temp.expect_error('the demo manager cannot change AI limits', format('select public.admin_set_ai_cap(%L, 9999)', public.my_workplace_id()));
select pg_temp.expect_error('the demo manager cannot change workplace settings directly', $$update workplaces set is_demo = false$$);
reset role;
delete from join_attempts where user_id = '00000000-0000-0000-0000-0000000000e5';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5');
select pg_temp.expect('nobody can join the demo workplace with its code',
  (public.join_workplace('DEMO26') ->> 'error') is not null and public.my_workplace_id() is null);

-- ---- Manager ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('my_channels() gives a manager all five channels',
  public.my_channels() = array['general', 'announcements', 'team_member', 'supervisors', 'management']);
select pg_temp.expect_error('manager cannot remove themselves',
  $$select public.remove_member(auth.uid())$$);
delete from messages where content = 'mgmt secret';
select pg_temp.expect('manager can delete messages',
  not exists (select 1 from messages where content = 'mgmt secret'));
select public.remove_member('00000000-0000-0000-0000-0000000000c3');
reset role;
select pg_temp.expect('removed member has no workplace and is a team member again',
  (select workplace_id is null and role = 'team_member' from profiles where id = '00000000-0000-0000-0000-0000000000c3'));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect('reset join code changes the code',
  public.regenerate_join_code() <> (select c from code));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select pg_temp.expect('old join code no longer works',
  (public.join_workplace((select c from code)) ->> 'error') is not null);
select pg_temp.expect('removed member can no longer read Harbour messages',
  not exists (select 1 from messages));

reset role;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name from results;
select count(*) filter (where ok) || '/' || count(*) || ' security checks passed' from results;
-- Exit with an error if anything failed, so CI stops.
do $$ begin
  if exists (select 1 from pg_temp.results where not ok) then raise exception 'Security checks failed'; end if;
end $$;

rollback;
