-- Pre-expand launch hardening. This migration is intentionally ordered before the public gateway
-- expand/contract pair: old browser RPCs remain available until the switched gateway is live.

create table public.customer_booking_access_challenges (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null check (phone ~ '^07[0-9]{8}$'),
  email      text not null check (char_length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create index customer_booking_access_challenges_expiry_idx
  on public.customer_booking_access_challenges (expires_at);

create table public.customer_booking_access_sessions (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null check (phone ~ '^07[0-9]{8}$'),
  email      text not null check (char_length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);

create index customer_booking_access_sessions_expiry_idx
  on public.customer_booking_access_sessions (expires_at);

alter table public.public_action_attempts
  drop constraint if exists public_action_attempts_action_check;
alter table public.public_action_attempts
  add constraint public_action_attempts_action_check check (
    action in ('lookup', 'list', 'cancel', 'review', 'request_access')
  );

alter table public.customer_booking_access_challenges enable row level security;
alter table public.customer_booking_access_sessions enable row level security;
revoke all on table public.customer_booking_access_challenges from public, anon, authenticated, service_role;
revoke all on table public.customer_booking_access_sessions from public, anon, authenticated, service_role;

create or replace function public.create_customer_booking_access_request(
  p_phone text,
  p_email text,
  p_token_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_has_booking boolean;
begin
  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select exists (
    select 1
    from public.bookings b
    where b.phone = p_phone
      and pg_catalog.lower(b.email) = v_email
      and b.status = 'confirmed'
  ) into v_has_booking;

  -- Keep valid and invalid requests on the same database path. The caller receives the same public
  -- response either way; only a matching booking causes the server-held code to be emailed.
  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.phone = p_phone
    and c.email = v_email
    and c.used_at is null;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (p_phone, v_email, p_token_hash, pg_catalog.now() + interval '15 minutes');

  return v_has_booking;
end;
$$;

create or replace function public.consume_public_action_attempt(
  p_action       text,
  p_ip_hash      text,
  p_phone_hash   text,
  p_window_secs  integer,
  p_ip_limit     integer,
  p_phone_limit  integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if p_action not in ('lookup', 'list', 'cancel', 'review', 'request_access')
     or char_length(p_ip_hash) <> 64
     or char_length(p_phone_hash) <> 64
     or p_window_secs not between 60 and 172800
     or p_ip_limit not between 1 and 100
     or p_phone_limit not between 1 and 100 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public-action:ip:' || p_action || ':' || p_ip_hash)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public-action:phone:' || p_action || ':' || p_phone_hash)
  );

  v_since := pg_catalog.now() - pg_catalog.make_interval(secs => p_window_secs);
  if (
    select pg_catalog.count(*)
    from public.public_action_attempts a
    where a.action = p_action and a.ip_hash = p_ip_hash and a.created_at >= v_since
  ) >= p_ip_limit or (
    select pg_catalog.count(*)
    from public.public_action_attempts a
    where a.action = p_action and a.phone_hash = p_phone_hash and a.created_at >= v_since
  ) >= p_phone_limit then
    return false;
  end if;

  insert into public.public_action_attempts (action, ip_hash, phone_hash)
  values (p_action, p_ip_hash, p_phone_hash);
  delete from public.public_action_attempts
  where created_at < pg_catalog.now() - interval '2 days';
  return true;
end;
$$;

create or replace function public.exchange_customer_booking_access(
  p_challenge_hash text,
  p_session_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
begin
  if p_challenge_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.token_hash = p_challenge_hash
    and c.used_at is null
    and c.expires_at > pg_catalog.now()
  returning c.phone, c.email into v_phone, v_email;

  if not found then
    return false;
  end if;

  insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '20 minutes');

  return true;
end;
$$;

create or replace function public.customer_booking_access_scope(p_session_hash text)
returns table(phone text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.phone, s.email
  from public.customer_booking_access_sessions s
  where s.token_hash = p_session_hash
    and s.expires_at > pg_catalog.now()
    and p_session_hash ~ '^[0-9a-f]{64}$';
$$;

create or replace function public.list_customer_bookings_with_access(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
begin
  select s.phone, s.email into v_phone, v_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bookings', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', b.id,
        'barber_id', b.barber_id,
        'service_name', b.service_name,
        'price', b.price,
        'duration_min', b.duration_min,
        'start_at', b.start_at
      ) order by b.start_at desc)
      from public.bookings b
      where b.phone = v_phone
        and pg_catalog.lower(b.email) = v_email
        and b.status = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.cancel_customer_booking_with_access(
  p_booking_id uuid,
  p_session_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
  v_cutoff_hours integer;
begin
  select s.phone, s.email into v_phone, v_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;

  select case
           when s.value ~ '^[0-9]{1,3}$' then least(s.value::integer, 168)
           else 24
         end
    into v_cutoff_hours
  from public.site_settings s
  where s.key = 'cancellation_policy_hours';

  update public.bookings b
  set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and b.start_at > pg_catalog.now() + pg_catalog.make_interval(hours => coalesce(v_cutoff_hours, 24))
    and b.phone = v_phone
    and pg_catalog.lower(b.email) = v_email;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cleanup_customer_booking_access()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_deleted integer := 0;
begin
  delete from public.customer_booking_access_challenges
  where expires_at < pg_catalog.now() - interval '1 day'
     or used_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_count = row_count;

  delete from public.customer_booking_access_sessions
  where expires_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  return v_count;
end;
$$;

revoke execute on function public.create_customer_booking_access_request(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.exchange_customer_booking_access(text, text)
  from public, anon, authenticated;
revoke execute on function public.customer_booking_access_scope(text)
  from public, anon, authenticated;
revoke execute on function public.list_customer_bookings_with_access(text)
  from public, anon, authenticated;
revoke execute on function public.cancel_customer_booking_with_access(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.cleanup_customer_booking_access()
  from public, anon, authenticated, service_role;
grant execute on function public.create_customer_booking_access_request(text, text, text) to service_role;
grant execute on function public.exchange_customer_booking_access(text, text) to service_role;
grant execute on function public.customer_booking_access_scope(text) to service_role;
grant execute on function public.list_customer_bookings_with_access(text) to service_role;
grant execute on function public.cancel_customer_booking_with_access(uuid, text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'customer-booking-access-cleanup') then
    perform cron.unschedule('customer-booking-access-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'customer-booking-access-cleanup',
  '23 3 * * *',
  'select public.cleanup_customer_booking_access()'
);

alter table public.email_templates drop constraint if exists email_templates_template_check;
alter table public.email_templates add constraint email_templates_template_check check (template in (
  'customer_confirmation',
  'barber_confirmation',
  'customer_cancellation',
  'barber_cancellation',
  'customer_reminder',
  'customer_booking_access',
  'auth_recovery',
  'auth_email_change',
  'auth_invite'
));

insert into public.email_templates (
  template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead
) values
  (
    'customer_booking_access', 'sv', 'Öppna Mina bokningar',
    'Öppna din säkra länk till Mina bokningar.', 'Öppna Mina bokningar',
    'Använd länken för att se och hantera dina bokade tider.',
    null, 'Länken gäller i 15 minuter och kan bara användas en gång.',
    'Öppna Mina bokningar', 'Om du inte begärde länken kan du ignorera detta mejl.'
  ),
  (
    'customer_booking_access', 'en', 'Open My appointments',
    'Open your secure My appointments link.', 'Open My appointments',
    'Use the link to view and manage your booked appointments.',
    null, 'The link is valid for 15 minutes and can only be used once.',
    'Open My appointments', 'Ignore this email if you did not request the link.'
  )
on conflict (template, lang) do nothing;

alter table public.booking_email_delivery_jobs
  drop constraint if exists booking_email_delivery_jobs_status_check;
alter table public.booking_email_delivery_jobs
  add constraint booking_email_delivery_jobs_status_check check (
    status in ('pending', 'dispatching', 'delivered', 'skipped', 'superseded', 'failed')
  );
alter table public.booking_email_delivery_jobs
  add column if not exists failed_at timestamptz;

create index if not exists booking_email_delivery_jobs_failed_idx
  on public.booking_email_delivery_jobs (failed_at, created_at)
  where status = 'failed';

create or replace function public.fail_booking_email_delivery(
  p_id uuid,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in ('not_configured', 'send_failed', 'message_build_failed') then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = case
        when p_error_code in ('not_configured', 'message_build_failed') then 'failed'
        when j.attempt_count >= 5 then 'failed'
        else 'pending'
      end,
      next_attempt_at = case
        when p_error_code in ('not_configured', 'message_build_failed') or j.attempt_count >= 5
          then j.next_attempt_at
        else pg_catalog.now() + pg_catalog.make_interval(
          secs => least(
            3600,
            (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
          )
        )
      end,
      failed_at = case
        when p_error_code in ('not_configured', 'message_build_failed') or j.attempt_count >= 5
          then pg_catalog.now()
        else null
      end,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;

create or replace function public.admin_list_failed_booking_email_deliveries()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', j.id,
      'booking_id', j.booking_id,
      'event', j.event,
      'attempt_count', j.attempt_count,
      'last_error_code', j.last_error_code,
      'failed_at', j.failed_at
    ) order by j.failed_at desc, j.created_at desc)
    from public.booking_email_delivery_jobs j
    where j.status = 'failed'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_retry_failed_booking_email_delivery(p_id uuid)
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
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = pg_catalog.now(),
      last_attempt_at = null,
      last_error_code = null,
      failed_at = null
  where j.id = p_id
    and j.status = 'failed';

  return pg_catalog.jsonb_build_object('ok', found);
end;
$$;

revoke execute on function public.admin_list_failed_booking_email_deliveries()
  from public, anon;
revoke execute on function public.admin_retry_failed_booking_email_delivery(uuid)
  from public, anon;
grant execute on function public.admin_list_failed_booking_email_deliveries() to authenticated;
grant execute on function public.admin_retry_failed_booking_email_delivery(uuid) to authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'booking-email-delivery-cleanup') then
    perform cron.unschedule('booking-email-delivery-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'booking-email-delivery-cleanup',
  '17 3 * * *',
  $$delete from public.booking_email_delivery_jobs
    where status in ('delivered', 'skipped', 'superseded')
      and completed_at < pg_catalog.now() - interval '90 days'$$
);

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
      and j.status in ('pending', 'dispatching')
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

create or replace function public.normalize_site_setting_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(new.value);
begin
  case new.key
    when 'homepage_scale', 'about_scale' then
      if v_value not in ('sm', 'md', 'lg', 'xl') then
        raise exception using errcode = '22023', message = 'invalid scale setting';
      end if;
    when 'business_name', 'business_street', 'business_city' then
      if char_length(v_value) not between 1 and 160 then
        raise exception using errcode = '22023', message = 'invalid business text setting';
      end if;
    when 'business_email' then
      v_value := pg_catalog.lower(v_value);
      if v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception using errcode = '22023', message = 'invalid business email setting';
      end if;
    when 'business_phone_display' then
      if char_length(v_value) not between 1 and 80 then
        raise exception using errcode = '22023', message = 'invalid business phone display setting';
      end if;
    when 'business_phone_tel' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]().-]', '', 'g');
      if v_value !~ '^\+?[0-9]{3,20}$' then
        raise exception using errcode = '22023', message = 'invalid business phone setting';
      end if;
    when 'business_postal_code' then
      v_value := pg_catalog.regexp_replace(v_value, '[[:space:]]', '', 'g');
      if v_value !~ '^[0-9]{5}$' then
        raise exception using errcode = '22023', message = 'invalid business postal code setting';
      end if;
      v_value := pg_catalog.left(v_value, 3) || ' ' || pg_catalog.right(v_value, 2);
    when 'business_maps_href' then
      if v_value !~ '^https://[^[:space:]]+$' then
        raise exception using errcode = '22023', message = 'invalid business maps URL setting';
      end if;
    when 'cancellation_policy_hours' then
      if v_value !~ '^[0-9]{1,3}$' or v_value::integer not between 1 and 168 then
        raise exception using errcode = '22023', message = 'invalid cancellation policy setting';
      end if;
    when 'seo_title_sv', 'seo_title_en' then
      if char_length(v_value) not between 1 and 120 then
        raise exception using errcode = '22023', message = 'invalid SEO title setting';
      end if;
    when 'seo_description_sv', 'seo_description_en' then
      if char_length(v_value) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'invalid SEO description setting';
      end if;
    else
      new.value := v_value;
      return new;
  end case;

  new.value := v_value;
  return new;
end;
$$;

revoke execute on function public.normalize_site_setting_value()
  from public, anon, authenticated, service_role;
drop trigger if exists site_settings_normalize_value on public.site_settings;
create trigger site_settings_normalize_value
before insert or update of key, value on public.site_settings
for each row execute function public.normalize_site_setting_value();

update public.site_settings
set value = value
where key = any (array[
  'homepage_scale', 'about_scale',
  'business_name', 'business_email', 'business_phone_display', 'business_phone_tel',
  'business_street', 'business_postal_code', 'business_city', 'business_maps_href',
  'cancellation_policy_hours',
  'seo_title_sv', 'seo_description_sv', 'seo_title_en', 'seo_description_en'
]::text[]);
