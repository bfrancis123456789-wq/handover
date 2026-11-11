-- Web push notifications.
--
-- Devices subscribe through save_push_subscription(). When a message is posted,
-- a trigger calls the send-push Edge Function, which asks push_recipients() who
-- should be notified and sends each of them an encrypted Web Push message.
--
-- To switch sending on, store two Vault secrets (see README):
--   push_function_url    e.g. https://<project-ref>.supabase.co/functions/v1/send-push
--   push_webhook_secret  a long random string, also set as PUSH_WEBHOOK_SECRET on the function
-- Without them, the trigger does nothing.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Role and channel rules in one place, usable for any role (not just the caller's)
-- ---------------------------------------------------------------------------

create or replace function public.role_can_access(p_role text, p_channel text)
returns boolean language sql immutable as $$
  select case p_channel
    when 'general'       then true
    when 'announcements' then true
    when 'team_member'   then true
    when 'supervisors'   then p_role in ('supervisor', 'manager')
    when 'management'    then p_role = 'manager'
    else false
  end
$$;

create or replace function public.can_access_channel(p_channel text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.role_can_access(public.my_role(), p_channel)
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions: one row per device (browser push endpoint)
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https?://' and char_length(endpoint) <= 1000),
  p256dh        text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,87}=?$'),  -- 65-byte P-256 key, base64url
  auth          text not null check (auth ~ '^[A-Za-z0-9_-]{21,22}(==)?$'),   -- 16-byte secret, base64url
  user_agent    text check (char_length(user_agent) <= 400),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "see own devices" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

create policy "remove own devices" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Save or refresh this device's subscription for the signed-in person. If the
-- device was previously signed in as someone else, it moves to the new person,
-- so a shared phone never notifies the previous user.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who gets a notification for a message: everyone in the workplace who can
-- access the channel, has it switched on in Notifications, and is not the author.
-- Only the send-push function (service role) may call this.
-- ---------------------------------------------------------------------------

create or replace function public.push_recipients(p_message uuid)
returns table (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, s.endpoint, s.p256dh, s.auth
  from public.messages m
  join public.profiles p
    on p.workplace_id = m.workplace_id
   and p.id is distinct from m.author_id
   and public.role_can_access(p.role, m.channel)
   and coalesce(p.notification_settings ->> m.channel, 'true') <> 'false'
  join public.push_subscriptions s on s.user_id = p.id
  where m.id = p_message
$$;

revoke execute on function public.push_recipients(uuid) from public, anon, authenticated;
grant execute on function public.push_recipients(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: ask the send-push function to deliver notifications for a new message
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fn_url text;
  fn_secret text;
begin
  -- Skip the network call when nobody else in the workplace has a device subscribed.
  if not exists (
    select 1 from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id
    where p.workplace_id = new.workplace_id and p.id is distinct from new.author_id
  ) then
    return new;
  end if;

  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if fn_url is null or fn_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := fn_url,
    body := jsonb_build_object('message_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', fn_secret),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

create trigger messages_notify_push
  after insert on public.messages
  for each row execute function public.notify_new_message();
