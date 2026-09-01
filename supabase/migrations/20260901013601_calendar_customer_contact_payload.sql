-- #46: the assigned barber's Calendar event needs the customer contact details that the
-- booking already authorizes. Keep OAuth credentials in the server-side dispatch context only;
-- the event builder never receives them as part of the Google event body.

-- This migration intentionally depends on the secure #42 customer-access contract. Applying it
-- before that migration is unsupported: fail closed instead of replacing the secure dispatcher with
-- an older customer-access branch.
do $$
declare
  v_queue_definition text;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
    into v_queue_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.queue_external_action(text,text,jsonb)');

  if pg_catalog.to_regprocedure('public.consume_customer_access_email_challenge(uuid)') is null
     or coalesce(v_queue_definition, '') not like '%customer_access_email_send%'
     or coalesce(v_queue_definition, '') not like '%challenge_id%'
     or coalesce(v_queue_definition, '') like '%access_code%' then
    raise exception 'secure #42 customer-access outbox contract must be deployed first';
  end if;
end;
$$;

create or replace function public.queue_booking_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.barber_id is distinct from new.barber_id
     or old.service_name is distinct from new.service_name
     or old.customer_name is distinct from new.customer_name
     or old.phone is distinct from new.phone
     or old.email is distinct from new.email
     or old.start_at is distinct from new.start_at
     or old.end_at is distinct from new.end_at then
    perform public.queue_calendar_event_sync(new.id);
  end if;

  return new;
end;
$$;

revoke execute on function public.queue_booking_calendar_sync() from public, anon, authenticated, service_role;

drop trigger if exists booking_calendar_sync_on_change on public.bookings;
create trigger booking_calendar_sync_on_change
after insert or update of status, barber_id, service_name, customer_name, phone, email, start_at, end_at
on public.bookings
for each row execute function public.queue_booking_calendar_sync();

create or replace function public.calendar_sync_source(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'barber_id',       b.barber_id,
    'service_name',    b.service_name,
    'customer_name',   b.customer_name,
    'phone',           b.phone,
    'email',           b.email,
    'start_at',        b.start_at,
    'end_at',          b.end_at,
    'status',          b.status,
    'refresh_token',   case when t.disconnect_requested_at is null then t.refresh_token end,
    'calendar_id',     t.calendar_id,
    'google_event_id', m.google_event_id
  )
  from public.bookings b
  left join public.barber_calendar_tokens t on t.barber_id = b.barber_id
  left join public.calendar_event_map m on m.booking_id = b.id
  where b.id = p_booking_id;
$$;

create or replace function public.calendar_backfill_source(p_barber_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'refresh_token', t.refresh_token,
    'calendar_id', t.calendar_id,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'service_name', b.service_name,
        'customer_name', b.customer_name,
        'phone', b.phone,
        'email', b.email,
        'start_at', b.start_at,
        'end_at', b.end_at,
        'google_event_id', m.google_event_id
      ) order by b.start_at)
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.end_at > pg_catalog.now()
    ), '[]'::jsonb)
  )
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
    and t.disconnect_requested_at is null;
$$;

create or replace function public.external_action_for_dispatch(
  p_id uuid,
  p_dispatch_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.external_action_jobs;
  v_map public.calendar_event_map;
  v_booking public.bookings;
  v_token public.barber_calendar_tokens;
  v_challenge public.customer_booking_access_challenges;
  v_token_ciphertext text;
  v_refresh_token text;
  v_calendar_id text;
  v_disconnect_requested_at timestamptz;
  v_calendar_event_count bigint;
  v_profile public.profiles;
begin
  select j.* into v_job
  from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  if not found then
    return null;
  end if;

  if v_job.action_type = 'storage_object_delete' then
    if (v_job.payload->>'bucket' = 'gallery' and exists (
      select 1 from public.gallery_images g where g.storage_path = v_job.payload->>'path'
    )) or (v_job.payload->>'bucket' = 'barber-photos' and exists (
      select 1 from public.barber_photos p where p.storage_path = v_job.payload->>'path'
    )) then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'bucket', v_job.payload->>'bucket',
      'path', v_job.payload->>'path'
    );
  end if;

  if v_job.action_type = 'calendar_event_sync' then
    select b.* into v_booking
    from public.bookings b
    where b.id = (v_job.payload->>'booking_id')::uuid
      and b.status = 'confirmed';

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select t.* into v_token
    from public.barber_calendar_tokens t
    where t.barber_id = v_booking.barber_id
      and t.disconnect_requested_at is null;

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select m.* into v_map
    from public.calendar_event_map m
    where m.booking_id = v_booking.id;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'booking_id', v_booking.id,
      'barber_id', v_booking.barber_id,
      'service_name', v_booking.service_name,
      'customer_name', v_booking.customer_name,
      'phone', v_booking.phone,
      'email', v_booking.email,
      'start_at', v_booking.start_at,
      'end_at', v_booking.end_at,
      'refresh_token', v_token.refresh_token,
      'calendar_id', v_token.calendar_id,
      'google_event_id', v_map.google_event_id
    );
  end if;

  if v_job.action_type = 'calendar_event_delete' then
    select m.* into v_map
    from public.calendar_event_map m
    where m.booking_id = (v_job.payload->>'booking_id')::uuid;

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select t.refresh_token, t.calendar_id
      into v_refresh_token, v_calendar_id
    from public.barber_calendar_tokens t
    where t.barber_id = v_map.barber_id;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'booking_id', v_map.booking_id,
      'barber_id', v_map.barber_id,
      'google_event_id', v_map.google_event_id,
      'refresh_token', v_refresh_token,
      'calendar_id', coalesce(v_calendar_id, 'primary')
    );
  end if;

  if v_job.action_type = 'customer_access_email_send' then
    select c.* into v_challenge
    from public.customer_booking_access_challenges c
    join public.customer_booking_access_tokens t
      on t.email = c.email
     and t.token_hash = c.token_hash
    where c.id = (v_job.payload->>'challenge_id')::uuid
      and c.used_at is null
      and c.expires_at > pg_catalog.now();

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    if not exists (
      select 1
      from public.bookings b
      where b.phone = v_challenge.phone
        and pg_catalog.lower(b.email) = v_challenge.email
        and b.status = 'confirmed'
    ) then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select t.token_ciphertext into v_token_ciphertext
    from public.customer_booking_access_tokens t
    where t.email = v_challenge.email
      and t.token_hash = v_challenge.token_hash;

    if not found or v_token_ciphertext is null then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'challenge_id', v_challenge.id,
      'email', v_challenge.email,
      'lang', v_job.payload->>'lang',
      'token_ciphertext', v_token_ciphertext
    );
  end if;

  if v_job.action_type = 'auth_user_access_sync' then
    select p.* into v_profile
    from public.profiles p
    where p.id = (v_job.payload->>'user_id')::uuid;

    if not found
       or v_profile.auth_sync_version <> (v_job.payload->>'version')::bigint
       or v_profile.account_enabled <> (v_job.payload->>'account_enabled')::boolean then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'user_id', v_profile.id,
      'account_enabled', v_profile.account_enabled,
      'version', v_profile.auth_sync_version
    );
  end if;

  if v_job.action_type = 'calendar_disconnect' then
    select t.refresh_token, t.disconnect_requested_at
      into v_refresh_token, v_disconnect_requested_at
    from public.barber_calendar_tokens t
    where t.barber_id = v_job.payload->>'barber_id';

    if not found then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id,
        'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type,
        'superseded', true
      );
    end if;

    select pg_catalog.count(*) into v_calendar_event_count
    from public.calendar_event_map m
    where m.barber_id = v_job.payload->>'barber_id';

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'barber_id', v_job.payload->>'barber_id',
      'refresh_token', v_refresh_token,
      'ready', v_calendar_event_count = 0
        and v_disconnect_requested_at is not null
        and v_disconnect_requested_at <= pg_catalog.now() - interval '5 minutes'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_job.id,
    'dispatch_token', v_job.dispatch_token,
    'action_type', v_job.action_type,
    'user_id', v_job.payload->>'user_id'
  );
end;
$$;
