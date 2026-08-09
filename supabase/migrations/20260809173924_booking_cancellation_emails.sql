-- Reuse the secured Resend webhook for both booking confirmations and cancellations. The booking
-- row remains authoritative: the Edge Function verifies this projected status before sending, so
-- a delayed confirmation job cannot send stale information after a fast cancellation.
create or replace function public.booking_confirmation_details(
  p_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',             b.id,
    'email',          b.email,
    'phone',          b.phone,
    'customer_name',  b.customer_name,
    'start_at',       b.start_at,
    'service_name',   b.service_name,
    'price',          b.price,
    'duration_min',   b.duration_min,
    'barber_name',    coalesce(ba.name, b.barber_id),
    'barber_email',   (
      select u.email
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.role = 'barber'
        and p.barber_id = b.barber_id
      order by p.created_at asc
      limit 1
    ),
    'lang',           b.lang,
    'status',         b.status
  )
  from public.bookings b
  left join public.barbers ba on ba.id = b.barber_id
  where b.id = p_id;
$$;

revoke execute on function public.booking_confirmation_details(uuid) from public;
grant execute on function public.booking_confirmation_details(uuid) to service_role;

create or replace function public.queue_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_event  text;
begin
  if tg_op = 'INSERT' then
    v_event := 'booking_confirmed';
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled' then
    v_event := 'booking_cancelled';
  else
    return new;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'booking_confirmation_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := pg_catalog.jsonb_build_object('id', new.id, 'event', v_event),
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'booking email enqueue failed: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function public.queue_booking_confirmation() from public;

drop trigger if exists booking_cancellation_on_update on public.bookings;
create trigger booking_cancellation_on_update
after update of status on public.bookings
for each row
when (old.status = 'confirmed' and new.status = 'cancelled')
execute function public.queue_booking_confirmation();
