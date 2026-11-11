-- Database-level security checks. Each test runs as a signed-in user, the way
-- a request through the API would, so it proves the rules hold even if someone
-- bypasses the app. Run against a local stack:
--   docker exec -i supabase_db_handover psql -U postgres -v ON_ERROR_STOP=1 < e2e/security.sql
-- Everything runs in a transaction that is rolled back at the end.

begin;

create temp table results (name text, ok boolean);
grant all on results to authenticated;
grant all on all tables in schema pg_temp to authenticated;

-- Helpers: act as a user, and expect a statement to succeed or fail.
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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
select pg_temp.expect('supervisor unread counts include Supervisors but not Management',
  (select array_agg(channel order by channel) from unread_counts()) = array['announcements', 'general', 'supervisors', 'team_member']);
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

-- ---- Manager ----
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
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
select pg_temp.expect_error('old join code no longer works',
  format('select public.join_workplace(%L)', (select c from code)));
select pg_temp.expect('removed member can no longer read Harbour messages',
  not exists (select 1 from messages));

reset role;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name from results;
select count(*) filter (where ok) || '/' || count(*) || ' security checks passed' from results;

rollback;
