-- Calendar reassignment hardening.
--
-- `calendar_event_map` is the durable cleanup authority for one booking.  A reassignment must not
-- replace that row before Google has deleted the event in the old barber's calendar.  The new
-- calendar_id column makes the old Google identity complete (barber + calendar + event) without
-- storing OAuth credentials in durable data.  Current refresh tokens are resolved at dispatch time.

alter table public.calendar_event_map
  add column if not exists calendar_id text;

-- Rows created before calendar_id was durable can be repaired from the credential row when it still
-- exists.  An ambiguous row is a deployment blocker: guessing `primary`, or allowing a blank account
-- identity, could make deletion target the wrong Calendar or make later same-account repair
-- impossible.  The linked read-only preflight for this rollout found map_count=1,
-- maps_without_token=0, maps_without_calendar_id=0, and mapped_tokens_without_email=0 after joining
-- each map to its token row.
do $$
begin
  if exists (
    select 1
    from public.calendar_event_map m
    left join public.barber_calendar_tokens t on t.barber_id = m.barber_id
    where t.barber_id is null
       or t.calendar_id is null
       or pg_catalog.btrim(t.calendar_id) = ''
       or t.google_email is null
       or pg_catalog.btrim(t.google_email) = ''
  ) then
    raise exception using
      errcode = '55000',
      message = 'calendar_event_map_calendar_identity_missing';
  end if;
end;
$$;

update public.calendar_event_map m
set calendar_id = t.calendar_id
from public.barber_calendar_tokens t
where t.barber_id = m.barber_id
  and m.calendar_id is null;

alter table public.calendar_event_map
  alter column calendar_id set not null,
  alter column calendar_id drop default;

create index if not exists calendar_event_map_identity_idx
  on public.calendar_event_map (barber_id, calendar_id, google_event_id);

-- Durable fallback for a Google event that was created but could not be recorded because a newer
-- mapping won the compare-and-swap.  The payload is deliberately identifier-only: the worker
-- resolves the current server credential for this immutable old barber/calendar identity.
create or replace function public.calendar_queue_event_deletion_for_identity(
  p_booking_id uuid,
  p_barber_id text,
  p_calendar_id text,
  p_google_event_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_booking_id is null
     or p_barber_id is null
     or pg_catalog.char_length(p_barber_id) not between 1 and 32
     or p_calendar_id is null
     or pg_catalog.char_length(p_calendar_id) not between 1 and 200
     or p_google_event_id is null
     or pg_catalog.char_length(p_google_event_id) not between 1 and 1024 then
    raise exception using errcode = '22023', message = 'invalid calendar event identity';
  end if;

  return public.queue_external_action(
    'calendar_event_delete',
    p_booking_id::text || ':identity:' || pg_catalog.md5(
      p_barber_id || pg_catalog.chr(31) || p_calendar_id || pg_catalog.chr(31) || p_google_event_id
    ),
    pg_catalog.jsonb_build_object(
      'booking_id', p_booking_id,
      'barber_id', p_barber_id,
      'calendar_id', p_calendar_id,
      'google_event_id', p_google_event_id
    )
  );
end;
$$;

revoke execute on function public.calendar_queue_event_deletion_for_identity(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_queue_event_deletion_for_identity(uuid, text, text, text)
  to service_role;

-- The booking-keyed cleanup path remains a single coalescing job, but snapshots the complete old
-- identity into its payload.  This is what cancellation, hard deletion, disconnect, and barber
-- deletion use; old pre-migration payloads are still supported by the dispatcher below.
create or replace function public.queue_calendar_event_deletion(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.calendar_event_map;
begin
  select m.* into v_map
  from public.calendar_event_map m
  where m.booking_id = p_booking_id
  for update;

  if not found then
    return null;
  end if;

  return public.queue_external_action(
    'calendar_event_delete',
    p_booking_id::text,
    pg_catalog.jsonb_build_object(
      'booking_id', v_map.booking_id,
      'barber_id', v_map.barber_id,
      'calendar_id', v_map.calendar_id,
      'google_event_id', v_map.google_event_id
    )
  );
end;
$$;

revoke execute on function public.queue_calendar_event_deletion(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.queue_calendar_event_deletion(uuid) to service_role;

-- A reassignment to an unlinked barber still needs a sync action: its only job is to delete the old
-- mapped event.  A confirmed booking with neither a destination token nor an existing map remains a
-- no-op until a barber connects (the OAuth callback then queues its backfill explicitly).
create or replace function public.queue_calendar_event_sync(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.bookings b
    where b.id = p_booking_id
      and b.status = 'confirmed'
      and (
        exists (
          select 1
          from public.barber_calendar_tokens t
          where t.barber_id = b.barber_id
            and t.disconnect_requested_at is null
        )
        or exists (
          select 1
          from public.calendar_event_map m
          where m.booking_id = b.id
        )
      )
  ) then
    return null;
  end if;

  return public.queue_external_action(
    'calendar_event_sync',
    p_booking_id::text,
    pg_catalog.jsonb_build_object('booking_id', p_booking_id)
  );
end;
$$;

revoke execute on function public.queue_calendar_event_sync(uuid)
  from public, anon, authenticated;
grant execute on function public.queue_calendar_event_sync(uuid) to service_role;

-- Delete only the exact identity that the worker successfully removed at Google.  A false result is
-- a compare-and-swap miss, not permission to delete or overwrite the newer mapping.
create or replace function public.calendar_forget_event_if_matches(
  p_booking_id uuid,
  p_barber_id text,
  p_calendar_id text,
  p_google_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_event_map m
  where m.booking_id = p_booking_id
    and m.barber_id = p_barber_id
    and m.calendar_id = p_calendar_id
    and m.google_event_id = p_google_event_id;
  return found;
end;
$$;

revoke execute on function public.calendar_forget_event_if_matches(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_forget_event_if_matches(uuid, text, text, text)
  to service_role;

-- Source data is authoritative at execution time.  It exposes the target credentials transiently
-- and separately exposes the immutable mapped identity plus the old barber's current credential.
-- A target event id is returned only when the mapping belongs to the target barber and calendar.
create or replace function public.calendar_sync_source(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'barber_id', b.barber_id,
    'service_name', b.service_name,
    'customer_name', b.customer_name,
    'phone', b.phone,
    'email', b.email,
    'start_at', b.start_at,
    'end_at', b.end_at,
    'status', b.status,
    'refresh_token', case when target.disconnect_requested_at is null then target.refresh_token end,
    'calendar_id', case when target.disconnect_requested_at is null then target.calendar_id end,
    'google_event_id', case
      when target.disconnect_requested_at is null
       and m.barber_id = b.barber_id
       and m.calendar_id = target.calendar_id
      then m.google_event_id
    end,
    'mapped_barber_id', m.barber_id,
    'mapped_refresh_token', mapped.refresh_token,
    'mapped_calendar_id', m.calendar_id,
    'mapped_google_event_id', m.google_event_id
  )
  from public.bookings b
  left join public.barber_calendar_tokens target on target.barber_id = b.barber_id
  left join public.calendar_event_map m on m.booking_id = b.id
  left join public.barber_calendar_tokens mapped on mapped.barber_id = m.barber_id
  where b.id = p_booking_id;
$$;

-- Backfill uses the same identity contract as normal sync.  Rows mapped to a different calendar are
-- handed to the callback for old-event cleanup before any replacement is created.
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
        'google_event_id', case
          when m.barber_id = b.barber_id and m.calendar_id = t.calendar_id
          then m.google_event_id
        end,
        'mapped_barber_id', m.barber_id,
        'mapped_refresh_token', mapped.refresh_token,
        'mapped_calendar_id', m.calendar_id,
        'mapped_google_event_id', m.google_event_id
      ) order by b.start_at)
      from public.bookings b
      left join public.calendar_event_map m on m.booking_id = b.id
      left join public.barber_calendar_tokens mapped on mapped.barber_id = m.barber_id
      where b.barber_id = p_barber_id
        and b.status = 'confirmed'
        and b.end_at > pg_catalog.now()
    ), '[]'::jsonb)
  )
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
    and t.disconnect_requested_at is null;
$$;

-- Conditional map write.  It never replaces another barber/calendar/event.  The caller compensates
-- for a false result at Google immediately and queues the exact identifier only if that compensation
-- fails.
create or replace function public.calendar_record_event_if_current(
  p_booking_id uuid,
  p_barber_id text,
  p_calendar_id text,
  p_google_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_booking_barber_id text;
  v_target_calendar_id text;
  v_disconnect_requested_at timestamptz;
  v_map public.calendar_event_map;
  v_map_found boolean;
begin
  if p_booking_id is null
     or p_barber_id is null
     or p_calendar_id is null
     or p_google_event_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('calendar-booking:' || p_booking_id::text, 0)
  );

  select b.status, b.barber_id
    into v_status, v_booking_barber_id
  from public.bookings b
  where b.id = p_booking_id;

  select t.calendar_id, t.disconnect_requested_at
    into v_target_calendar_id, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;

  select m.* into v_map
  from public.calendar_event_map m
  where m.booking_id = p_booking_id
  for update;
  v_map_found := found;

  if v_status is distinct from 'confirmed'
     or v_booking_barber_id is distinct from p_barber_id
     or v_target_calendar_id is distinct from p_calendar_id
     or v_disconnect_requested_at is not null then
    return false;
  end if;

  if v_map_found and (
    v_map.barber_id is distinct from p_barber_id
    or v_map.calendar_id is distinct from p_calendar_id
    or v_map.google_event_id is distinct from p_google_event_id
  ) then
    return false;
  end if;

  if not v_map_found then
    insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
    values (p_booking_id, p_barber_id, p_calendar_id, p_google_event_id);
  end if;

  update public.barber_calendar_tokens
  set last_sync_at = pg_catalog.now(), last_sync_error = null
  where barber_id = p_barber_id;
  return true;
end;
$$;

revoke execute on function public.calendar_record_event_if_current(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_record_event_if_current(uuid, text, text, text)
  to service_role;

-- Compatibility path for the old three-argument callback.  It is now non-destructive: a late or
-- mismatched event is queued for deletion rather than overwriting a newer mapping.
create or replace function public.calendar_record_event(
  p_booking_id uuid,
  p_barber_id text,
  p_google_event_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar_id text;
  v_map public.calendar_event_map;
  v_map_found boolean;
begin
  select t.calendar_id into v_calendar_id
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;

  if v_calendar_id is null or pg_catalog.btrim(v_calendar_id) = '' then
    raise exception using errcode = '55000', message = 'calendar_id_required';
  end if;

  select m.* into v_map
  from public.calendar_event_map m
  where m.booking_id = p_booking_id
  for update;
  v_map_found := found;

  if v_map_found and (
    v_map.barber_id is distinct from p_barber_id
    or v_map.calendar_id is distinct from v_calendar_id
    or v_map.google_event_id is distinct from p_google_event_id
  ) then
    -- Old workers use the booking-derived id.  Let the new state machine adopt that event after it
    -- removes the immutable old mapping; queuing a separate delete for the same stable id would race
    -- the replacement.  A non-stable legacy id is an orphan, so retain its identifier-only delete.
    if p_google_event_id <> ('bbs' || pg_catalog.replace(p_booking_id::text, '-', ''))
       or (v_map.barber_id = p_barber_id
           and v_map.calendar_id = v_calendar_id) then
      execute 'select public.calendar_queue_event_deletion_for_identity($1, $2, $3, $4)'
        using p_booking_id, p_barber_id, v_calendar_id, p_google_event_id;
    end if;
    -- This resets the old booking-keyed dispatch token.  A mixed-version worker therefore cannot
    -- complete the stale action after the compatibility write; the new worker retries from source.
    perform public.queue_calendar_event_sync(p_booking_id);
    return;
  end if;

  if not v_map_found then
    insert into public.calendar_event_map (booking_id, barber_id, calendar_id, google_event_id)
    values (p_booking_id, p_barber_id, v_calendar_id, p_google_event_id);
  end if;

  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and b.status = 'confirmed'
      and b.barber_id = p_barber_id
  ) or exists (
    select 1 from public.barber_calendar_tokens t
    where t.barber_id = p_barber_id and t.disconnect_requested_at is not null
  ) then
    -- The row was just inserted by a legacy callback, so retain the established booking-keyed
    -- cleanup job and snapshot this exact map identity into its payload.
    perform public.queue_calendar_event_deletion(p_booking_id);
    return;
  end if;

  update public.barber_calendar_tokens
  set last_sync_at = pg_catalog.now(), last_sync_error = null
  where barber_id = p_barber_id;
end;
$$;

revoke execute on function public.calendar_record_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.calendar_record_event(uuid, text, text) to service_role;

-- Calendar-only dispatch lookup.  PR #55 owns the generic dispatcher, so the worker tries this
-- narrow function first and falls back to external_action_for_dispatch for non-Calendar jobs.
create or replace function public.calendar_external_action_for_dispatch(
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
  v_booking public.bookings;
  v_map public.calendar_event_map;
  v_map_found boolean := false;
  v_target public.barber_calendar_tokens;
  v_target_found boolean := false;
  v_mapped_refresh_token text;
  v_booking_id uuid;
  v_barber_id text;
  v_calendar_id text;
  v_google_event_id text;
  v_refresh_token text;
  v_disconnect_requested_at timestamptz;
  v_event_count bigint;
  v_delete_job_count bigint;
begin
  select j.* into v_job
  from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  if not found or v_job.action_type not in (
    'calendar_event_sync', 'calendar_event_delete', 'calendar_disconnect'
  ) then
    return null;
  end if;

  if v_job.action_type = 'calendar_event_sync' then
    select b.* into v_booking
    from public.bookings b
    where b.id = (v_job.payload->>'booking_id')::uuid;

    if not found or v_booking.status <> 'confirmed' then
      return pg_catalog.jsonb_build_object(
        'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
        'action_type', v_job.action_type, 'superseded', true
      );
    end if;

    select t.* into v_target
    from public.barber_calendar_tokens t
    where t.barber_id = v_booking.barber_id;
    v_target_found := found;

    select m.* into v_map
    from public.calendar_event_map m
    where m.booking_id = v_booking.id;
    v_map_found := found;

    if v_map_found then
      select t.refresh_token into v_mapped_refresh_token
      from public.barber_calendar_tokens t
      where t.barber_id = v_map.barber_id;
    end if;

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
      'refresh_token', case when v_target_found and v_target.disconnect_requested_at is null
        then v_target.refresh_token end,
      'calendar_id', case when v_target_found and v_target.disconnect_requested_at is null
        then v_target.calendar_id end,
      'google_event_id', case when v_map_found and v_target_found
        and v_target.disconnect_requested_at is null
        and v_map.barber_id = v_booking.barber_id
        and v_map.calendar_id = v_target.calendar_id
        then v_map.google_event_id end,
      'mapped_barber_id', case when v_map_found then v_map.barber_id end,
      'mapped_refresh_token', case when v_map_found then v_mapped_refresh_token end,
      'mapped_calendar_id', case when v_map_found then v_map.calendar_id end,
      'mapped_google_event_id', case when v_map_found then v_map.google_event_id end
    );
  end if;

  if v_job.action_type = 'calendar_event_delete' then
    v_booking_id := (v_job.payload->>'booking_id')::uuid;
    if pg_catalog.jsonb_path_exists(v_job.payload, '$.barber_id ? (@.type() == "string")')
       and pg_catalog.jsonb_path_exists(v_job.payload, '$.calendar_id ? (@.type() == "string")')
       and pg_catalog.jsonb_path_exists(v_job.payload, '$.google_event_id ? (@.type() == "string")')
       and pg_catalog.char_length(v_job.payload->>'barber_id') > 0
       and pg_catalog.char_length(v_job.payload->>'calendar_id') > 0
       and pg_catalog.char_length(v_job.payload->>'google_event_id') > 0 then
      v_barber_id := v_job.payload->>'barber_id';
      v_calendar_id := v_job.payload->>'calendar_id';
      v_google_event_id := v_job.payload->>'google_event_id';
    else
      select m.barber_id, m.calendar_id, m.google_event_id
        into v_barber_id, v_calendar_id, v_google_event_id
      from public.calendar_event_map m
      where m.booking_id = v_booking_id;
      if not found then
        return pg_catalog.jsonb_build_object(
          'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
          'action_type', v_job.action_type, 'superseded', true
        );
      end if;
    end if;

    select t.refresh_token into v_refresh_token
    from public.barber_calendar_tokens t
    where t.barber_id = v_barber_id;

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'booking_id', v_booking_id,
      'barber_id', v_barber_id,
      'google_event_id', v_google_event_id,
      'refresh_token', v_refresh_token,
      'calendar_id', v_calendar_id
    );
  end if;

  select t.refresh_token, t.disconnect_requested_at
    into v_refresh_token, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = v_job.payload->>'barber_id';

  if not found then
    return pg_catalog.jsonb_build_object(
      'id', v_job.id, 'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type, 'superseded', true
    );
  end if;

  select pg_catalog.count(*) into v_event_count
  from public.calendar_event_map m
  where m.barber_id = v_job.payload->>'barber_id';

  select pg_catalog.count(*) into v_delete_job_count
  from public.external_action_jobs j
  where j.action_type = 'calendar_event_delete'
    and j.status in ('pending', 'dispatching', 'blocked')
    and (
      j.payload->>'barber_id' = v_job.payload->>'barber_id'
      or exists (
        select 1
        from public.calendar_event_map m
        where m.booking_id = (j.payload->>'booking_id')::uuid
          and m.barber_id = v_job.payload->>'barber_id'
      )
    );

  return pg_catalog.jsonb_build_object(
    'id', v_job.id,
    'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'barber_id', v_job.payload->>'barber_id',
      'refresh_token', v_refresh_token,
      'ready', v_event_count = 0
        and v_delete_job_count = 0
      and v_disconnect_requested_at is not null
      and v_disconnect_requested_at <= pg_catalog.now() - interval '5 minutes'
  );
end;
$$;

revoke execute on function public.calendar_external_action_for_dispatch(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_external_action_for_dispatch(uuid, uuid)
  to service_role;

-- Reauthorization rotates the credential and resumes blocked Calendar work for this barber.  The
-- old identity remains in its map/job until the new current credential deletes it.
create or replace function public.calendar_store_token(
  p_barber_id text,
  p_refresh_token text,
  p_google_email text,
  p_calendar_id text default 'primary'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_email text;
  v_disconnect_requested_at timestamptz;
  v_token_found boolean;
  v_identity_bound boolean;
  v_repair_required boolean;
  v_map record;
begin
  select t.google_email, t.disconnect_requested_at
    into v_existing_email, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
  for update;
  v_token_found := found;

  select exists (
    select 1
    from public.calendar_event_map m
    where m.barber_id = p_barber_id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and (
        j.payload->>'barber_id' = p_barber_id
        or exists (
          select 1
          from public.calendar_event_map m
          where m.booking_id = (j.payload->>'booking_id')::uuid
            and m.barber_id = p_barber_id
        )
      )
  ) into v_identity_bound;

  select coalesce(exists (
    select 1
    from public.external_action_jobs j
    where j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and (
        (j.action_type = 'calendar_event_delete' and (
          j.payload->>'barber_id' = p_barber_id
          or exists (
            select 1
            from public.calendar_event_map m
            where m.booking_id = (j.payload->>'booking_id')::uuid
              and m.barber_id = p_barber_id
          )
        ))
        or (j.action_type = 'calendar_event_sync' and exists (
          select 1
          from public.bookings b
          where b.id = (j.payload->>'booking_id')::uuid
            and b.barber_id = p_barber_id
        ))
      )
  ), false) into v_repair_required;

  if v_token_found and v_disconnect_requested_at is not null then
    if v_existing_email is null
       or p_google_email is null
       or pg_catalog.lower(v_existing_email) <> pg_catalog.lower(p_google_email) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'account_mismatch');
    end if;

    update public.barber_calendar_tokens t
    set refresh_token = p_refresh_token,
        calendar_id = coalesce(p_calendar_id, 'primary'),
        updated_at = pg_catalog.now(),
        last_sync_error = null
    where t.barber_id = p_barber_id;

    for v_map in
      select m.booking_id
      from public.calendar_event_map m
      where m.barber_id = p_barber_id
    loop
      perform public.queue_calendar_event_deletion(v_map.booking_id);
    end loop;

    update public.external_action_jobs j
    set status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
    where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
      and j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and (
        j.payload->>'barber_id' = p_barber_id
        or (j.action_type = 'calendar_event_delete' and exists (
          select 1
          from public.calendar_event_map m
          where m.booking_id = (j.payload->>'booking_id')::uuid
            and m.barber_id = p_barber_id
        ))
        or (j.action_type = 'calendar_event_sync' and exists (
          select 1
          from public.bookings b
          where b.id = (j.payload->>'booking_id')::uuid
            and b.barber_id = p_barber_id
        ))
      );

    return pg_catalog.jsonb_build_object('ok', true, 'cleanup_pending', true);
  end if;

  if v_token_found
     and v_disconnect_requested_at is null
     and (v_identity_bound or v_repair_required)
     and (v_existing_email is null
       or p_google_email is null
       or pg_catalog.lower(v_existing_email) <> pg_catalog.lower(p_google_email)) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'account_mismatch');
  end if;

  if v_token_found and v_disconnect_requested_at is null and v_repair_required then
    update public.barber_calendar_tokens t
    set refresh_token = p_refresh_token,
        calendar_id = coalesce(p_calendar_id, 'primary'),
        updated_at = pg_catalog.now(),
        last_sync_error = null
    where t.barber_id = p_barber_id;

    update public.external_action_jobs j
    set status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
    where j.action_type in ('calendar_event_delete', 'calendar_event_sync')
      and j.status = 'blocked'
      and j.last_error_code = 'calendar_authorization_required'
      and (
        j.payload->>'barber_id' = p_barber_id
        or (j.action_type = 'calendar_event_delete' and exists (
          select 1
          from public.calendar_event_map m
          where m.booking_id = (j.payload->>'booking_id')::uuid
            and m.barber_id = p_barber_id
        ))
        or (j.action_type = 'calendar_event_sync' and exists (
          select 1
          from public.bookings b
          where b.id = (j.payload->>'booking_id')::uuid
            and b.barber_id = p_barber_id
        ))
      );

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'cleanup_pending', false,
      'repair_pending', true
    );
  end if;

  insert into public.barber_calendar_tokens
    (barber_id, refresh_token, google_email, calendar_id, connected_at, updated_at,
     disconnect_requested_at)
  values
    (p_barber_id, p_refresh_token, p_google_email, coalesce(p_calendar_id, 'primary'),
     pg_catalog.now(), pg_catalog.now(), null)
  on conflict (barber_id) do update
    set refresh_token = excluded.refresh_token,
        google_email = excluded.google_email,
        calendar_id = excluded.calendar_id,
        updated_at = pg_catalog.now(),
        last_sync_error = null,
        disconnect_requested_at = null;

  return pg_catalog.jsonb_build_object('ok', true, 'cleanup_pending', false);
end;
$$;

revoke execute on function public.calendar_store_token(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.calendar_store_token(text, text, text, text) to service_role;

-- Disconnect readiness includes durable direct-identity cleanup jobs, even after their map was
-- removed.  This prevents token revocation or barber deletion from losing the old event identity.
create or replace function public.prepare_calendar_disconnect(p_barber_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
  v_event_count bigint;
  v_map record;
begin
  update public.barber_calendar_tokens t
  set disconnect_requested_at = coalesce(t.disconnect_requested_at, pg_catalog.now())
  where t.barber_id = p_barber_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', true, 'pending', false);
  end if;

  for v_map in
    select m.booking_id
    from public.calendar_event_map m
    where m.barber_id = p_barber_id
  loop
    perform public.queue_calendar_event_deletion(v_map.booking_id);
  end loop;

  select pg_catalog.count(*) into v_event_count
  from public.calendar_event_map m
  where m.barber_id = p_barber_id;

  v_action_id := public.queue_external_action(
    'calendar_disconnect',
    p_barber_id,
    pg_catalog.jsonb_build_object('barber_id', p_barber_id)
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'pending', true,
    'calendar_events', v_event_count,
    'action_id', v_action_id
  );
end;
$$;

revoke execute on function public.prepare_calendar_disconnect(text)
  from public, anon, authenticated;
grant execute on function public.prepare_calendar_disconnect(text) to service_role;

create or replace function public.calendar_connection_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'connected', t.barber_id is not null and t.disconnect_requested_at is null,
    'disconnect_pending', t.disconnect_requested_at is not null,
    'repair_required', coalesce(exists (
      select 1
      from public.external_action_jobs j
      where j.status = 'blocked'
        and j.last_error_code = 'calendar_authorization_required'
        and (
          (j.action_type = 'calendar_event_delete' and (
            j.payload->>'barber_id' = me.bid
            or exists (
              select 1
              from public.calendar_event_map m
              where m.booking_id = (j.payload->>'booking_id')::uuid
                and m.barber_id = me.bid
            )
          ))
          or (j.action_type = 'calendar_event_sync' and exists (
            select 1
            from public.bookings b
            where b.id = (j.payload->>'booking_id')::uuid
              and b.barber_id = me.bid
          ))
        )
    ), false),
    'google_email', t.google_email,
    'last_sync_at', t.last_sync_at,
    'last_sync_error', t.last_sync_error
  )
  from (select public.current_barber_id() as bid) me
  left join public.barber_calendar_tokens t on t.barber_id = me.bid;
$$;

revoke execute on function public.calendar_connection_status() from public, anon;
grant execute on function public.calendar_connection_status() to authenticated;

-- Direct table deletion must not cascade away a barber's token/map while any immutable Calendar
-- cleanup identity is still pending, in flight, or blocked for human reauthorization.
create or replace function public.prevent_barber_delete_with_calendar_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.calendar_event_map m
    where m.barber_id = old.id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and j.payload->>'barber_id' = old.id
  ) then
    raise exception using errcode = '55000', message = 'calendar_cleanup_pending';
  end if;
  return old;
end;
$$;

revoke execute on function public.prevent_barber_delete_with_calendar_cleanup()
  from public, anon, authenticated, service_role;

drop trigger if exists barbers_prevent_calendar_cleanup_delete on public.barbers;
create trigger barbers_prevent_calendar_cleanup_delete
before delete on public.barbers
for each row execute function public.prevent_barber_delete_with_calendar_cleanup();

-- The token itself is deleted only after its map and all identity cleanup jobs have drained.  The
-- worker calls this after Google revoke; raising here keeps a disconnect race safe.
create or replace function public.calendar_delete_token(p_barber_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if exists (
    select 1 from public.calendar_event_map m where m.barber_id = p_barber_id
  ) or exists (
    select 1
    from public.external_action_jobs j
    where j.action_type = 'calendar_event_delete'
      and j.status in ('pending', 'dispatching', 'blocked')
      and j.payload->>'barber_id' = p_barber_id
  ) then
    raise exception using errcode = '55000', message = 'calendar_cleanup_pending';
  end if;

  select refresh_token into v_token
  from public.barber_calendar_tokens
  where barber_id = p_barber_id;
  delete from public.barber_calendar_tokens where barber_id = p_barber_id;
  return v_token;
end;
$$;

revoke execute on function public.calendar_delete_token(text)
  from public, anon, authenticated;
grant execute on function public.calendar_delete_token(text) to service_role;
