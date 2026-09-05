-- #46: the assigned barber's Calendar event needs the customer contact details that the
-- booking already authorizes. Keep OAuth credentials in the server-side dispatch context only;
-- the event builder never receives them as part of the Google event body.
--
-- The generic external-action dispatcher is intentionally not redefined here. Its customer-access
-- branch belongs to the customer-access contract, while Calendar reads the current booking through
-- calendar_sync_source immediately before constructing the Google event.

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
