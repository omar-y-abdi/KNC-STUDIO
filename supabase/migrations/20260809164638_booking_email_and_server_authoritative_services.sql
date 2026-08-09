-- Public bookings now require an email confirmation address while phone remains the lookup key for
-- Mina bokningar and reviews. Commercial service fields are derived from public.services inside the
-- database; the browser can no longer choose persisted name, price, or duration.

drop function if exists public.create_booking(
  text, text, text, int, int, timestamptz, text, text, text
);

create or replace function public.create_booking(
  p_barber_id     text,
  p_service_id    text,
  p_start_at      timestamptz,
  p_phone         text,
  p_email         text,
  p_lang          text,
  p_customer_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service   public.services;
  v_end_at    timestamptz;
  v_row       public.bookings;
  v_local_ts  timestamp;
  v_weekday   int;
  v_slot_min  int;
begin
  if p_start_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_time');
  end if;

  if p_phone is null or p_phone = '' or p_email is null or p_email = '' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  if p_lang not in ('sv', 'en') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.* into v_service
  from public.services s
  where s.id::text = p_service_id
    and s.barber_id = p_barber_id
    and s.active = true;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_local_ts := p_start_at at time zone 'Europe/Stockholm';
  v_weekday  := pg_catalog.date_part('dow', v_local_ts)::int;
  v_slot_min := pg_catalog.date_part('hour', v_local_ts)::int * 60
              + pg_catalog.date_part('minute', v_local_ts)::int;

  if not exists (
    select 1
    from public.barber_schedules s
    where s.barber_id = p_barber_id
      and s.working = true
      and s.weekday = v_weekday
      and v_slot_min >= s.start_min
      and v_slot_min + v_service.duration_min <= s.end_min
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  if exists (
    select 1
    from public.barber_time_off t
    where t.barber_id = p_barber_id
      and v_local_ts::date between t.start_date and t.end_date
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'outside_hours');
  end if;

  v_end_at := p_start_at + pg_catalog.make_interval(mins => v_service.duration_min);

  begin
    insert into public.bookings (
      barber_id, service_id, service_name, price, duration_min,
      start_at, end_at, customer_name, method, phone, email, lang
    ) values (
      p_barber_id, v_service.id::text, v_service.name, v_service.price, v_service.duration_min,
      p_start_at, v_end_at, p_customer_name, 'sms', p_phone, pg_catalog.lower(p_email), p_lang
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'slot_taken');
    when check_violation or foreign_key_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'booking', pg_catalog.jsonb_build_object(
      'id',           v_row.id,
      'barber_id',    v_row.barber_id,
      'service_id',   v_row.service_id,
      'service_name', v_row.service_name,
      'price',        v_row.price,
      'duration_min', v_row.duration_min,
      'start_at',     v_row.start_at,
      'end_at',       v_row.end_at,
      'method',       v_row.method,
      'lang',         v_row.lang
    )
  );
end;
$$;

revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from public;
revoke execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) from anon, authenticated;
grant execute on function public.create_booking(
  text, text, timestamptz, text, text, text, text
) to service_role;

-- Exact DB-authoritative projection used by send-confirmation. Barber recipient comes from the
-- linked Auth account; a barber without an account simply has no barber email recipient.
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
    'lang',           b.lang
  )
  from public.bookings b
  left join public.barbers ba on ba.id = b.barber_id
  where b.id = p_id;
$$;

revoke execute on function public.booking_confirmation_details(uuid) from public;
grant execute on function public.booking_confirmation_details(uuid) to service_role;

-- Queue send-confirmation asynchronously after every insert. Runtime URL and shared secret live in
-- Supabase Vault as booking_confirmation_url / booking_webhook_secret; absent local secrets make the
-- trigger a no-op rather than breaking local seeds or tests.
create or replace function public.queue_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
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
    body := pg_catalog.jsonb_build_object('id', new.id),
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
    raise warning 'booking confirmation enqueue failed: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function public.queue_booking_confirmation() from public;

drop trigger if exists booking_confirmation_on_insert on public.bookings;
create trigger booking_confirmation_on_insert
after insert on public.bookings
for each row execute function public.queue_booking_confirmation();

-- Existing owner-edited copy still describes SMS/My bookings. Move both stored defaults to the new
-- email behavior; owner can continue editing these values in the admin panel afterward.
insert into public.site_content (key, lang, value)
values
  (
    'confirmSent',
    'sv',
    'En bokningsbekräftelse har skickats till {email}. Bokningen finns även under "Mina bokningar" via ditt telefonnummer.'
  ),
  (
    'confirmSent',
    'en',
    'A booking confirmation has been sent to {email}. You can also find the booking under "My appointments" using your phone number.'
  )
on conflict (key, lang) do update set value = excluded.value;
