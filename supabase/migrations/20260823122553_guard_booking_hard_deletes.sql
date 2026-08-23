-- Hard-deleting a booking cascades its transactional email ledger. Guard every deletion path so
-- pending, in-flight, or owner-reviewable failed deliveries cannot disappear silently.
create or replace function public.prevent_booking_delete_with_unresolved_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.booking_id = old.id
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    raise exception using
      errcode = '55000',
      message = 'booking_email_delivery_unresolved';
  end if;

  return old;
end;
$$;

revoke execute on function public.prevent_booking_delete_with_unresolved_email()
  from public, anon, authenticated, service_role;

drop trigger if exists bookings_prevent_unresolved_email_delete on public.bookings;
create trigger bookings_prevent_unresolved_email_delete
before delete on public.bookings
for each row execute function public.prevent_booking_delete_with_unresolved_email();

-- Owners need an explicit acknowledgement path for deliveries that can never succeed. Dismissal is
-- recorded as a terminal skipped row before history can be deliberately deleted.
create or replace function public.admin_discard_failed_booking_email_delivery(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  update public.booking_email_delivery_jobs j
  set status = 'skipped',
      completed_at = pg_catalog.now()
  where j.id = p_id
    and j.status = 'failed';

  return pg_catalog.jsonb_build_object('ok', found);
end;
$$;

revoke execute on function public.admin_discard_failed_booking_email_delivery(uuid)
  from public, anon;
grant execute on function public.admin_discard_failed_booking_email_delivery(uuid)
  to authenticated;

create or replace function public.admin_delete_bookings(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner  boolean := public.is_owner();
  v_barber_id text    := public.current_barber_id();
  v_count     bigint;
begin
  if pg_catalog.array_length(p_ids, 1) is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  if not v_is_owner and v_barber_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if not v_is_owner and exists (
    select 1
    from pg_catalog.unnest(p_ids) as req(id)
    where not exists (
      select 1 from public.bookings b
      where b.id = req.id and b.barber_id = v_barber_id
    )
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Serialize against cancellation, which creates a cancellation email job in the same booking-row
  -- transaction. After this lock, either that job is visible or the cancellation waits for deletion.
  perform 1
  from public.bookings b
  where b.id = any(p_ids)
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.id = any(p_ids)
      and b.status = 'confirmed'
      and b.start_at >= pg_catalog.now()
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'has_upcoming');
  end if;

  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    where j.booking_id = any(p_ids)
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  delete from public.bookings
  where id = any(p_ids)
    and not (status = 'confirmed' and start_at >= pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

create or replace function public.admin_purge_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1
  from public.bookings b
  where b.status = 'cancelled'
     or (b.status = 'confirmed' and b.start_at < pg_catalog.now())
  order by b.id
  for update;

  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    where (b.status = 'cancelled'
        or (b.status = 'confirmed' and b.start_at < pg_catalog.now()))
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  delete from public.bookings b
  where b.status = 'cancelled'
     or (b.status = 'confirmed' and b.start_at < pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

revoke execute on function public.admin_purge_history() from public, anon;
grant execute on function public.admin_purge_history() to authenticated;

create or replace function public.admin_delete_barber(
  p_barber_id text,
  p_purge_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_upcoming bigint;
  v_past bigint;
  v_deleted bigint := 0;
  v_calendar_count bigint;
  v_user_id uuid;
  v_auth_action_id uuid;
  v_map record;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_barber_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('availability:' || p_barber_id, 0)
  );

  perform 1 from public.barbers b where b.id = p_barber_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform 1
  from public.bookings b
  where b.barber_id = p_barber_id
  order by b.id
  for update;

  select pg_catalog.count(*),
         pg_catalog.count(*) filter (
           where b.status = 'confirmed' and b.end_at > pg_catalog.now()
         )
    into v_count, v_upcoming
  from public.bookings b
  where b.barber_id = p_barber_id;
  v_past := v_count - v_upcoming;

  if v_upcoming > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_upcoming',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if v_count > 0 and not coalesce(p_purge_bookings, false) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'has_bookings',
      'count', v_count,
      'past', v_past,
      'upcoming', v_upcoming
    );
  end if;

  if coalesce(p_purge_bookings, false) and exists (
    select 1
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    where b.barber_id = p_barber_id
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  select pg_catalog.count(*) into v_calendar_count
  from public.calendar_event_map m
  where m.barber_id = p_barber_id;

  if v_calendar_count > 0 then
    for v_map in
      select m.booking_id
      from public.calendar_event_map m
      where m.barber_id = p_barber_id
    loop
      perform public.queue_calendar_event_deletion(v_map.booking_id);
    end loop;

    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'external_cleanup_pending',
      'calendar_events', v_calendar_count
    );
  end if;

  if exists (
    select 1 from public.barber_calendar_tokens t where t.barber_id = p_barber_id
  ) then
    perform public.prepare_calendar_disconnect(p_barber_id);
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'external_cleanup_pending',
      'calendar_events', 0
    );
  end if;

  if coalesce(p_purge_bookings, false) then
    delete from public.bookings b
    where b.barber_id = p_barber_id
      and not (b.status = 'confirmed' and b.end_at > pg_catalog.now());
    get diagnostics v_deleted = row_count;
  end if;

  select p.id into v_user_id
  from public.profiles p
  where p.role = 'barber' and p.barber_id = p_barber_id;

  if v_user_id is not null then
    v_auth_action_id := public.queue_external_action(
      'auth_user_delete',
      v_user_id::text,
      pg_catalog.jsonb_build_object('user_id', v_user_id)
    );
  end if;

  delete from public.profiles p where p.barber_id = p_barber_id;
  delete from public.barbers b where b.id = p_barber_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'deleted_bookings', v_deleted,
    'auth_action_id', v_auth_action_id
  );
end;
$$;

revoke execute on function public.admin_delete_barber(text, boolean) from public, anon;
grant execute on function public.admin_delete_barber(text, boolean) to authenticated;
