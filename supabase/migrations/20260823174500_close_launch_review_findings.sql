-- Close the final adversarial launch-review gaps without relying on browser timing or operator luck.
--
-- 1. A confirmed appointment remains live until end_at, not merely until its start_at.
-- 2. Calendar create/update and customer-access email delivery join the durable external-action outbox.
-- 3. Reviews require the email-possession customer session in addition to the booking phone.

alter table public.external_action_jobs
  drop constraint if exists external_action_jobs_action_type_check;
alter table public.external_action_jobs
  add constraint external_action_jobs_action_type_check check (
    action_type in (
      'storage_object_delete',
      'calendar_event_sync',
      'calendar_event_delete',
      'calendar_disconnect',
      'customer_access_email_send',
      'auth_user_access_sync',
      'auth_user_delete'
    )
  );

create or replace function public.queue_external_action(
  p_action_type text,
  p_dedupe_key text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_dedupe_key is null
     or pg_catalog.char_length(p_dedupe_key) not between 1 and 300
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid external action';
  end if;

  if p_action_type = 'storage_object_delete' then
    if p_payload->>'bucket' not in ('gallery', 'barber-photos')
       or p_payload->>'path' is null
       or pg_catalog.char_length(p_payload->>'path') not between 1 and 300 then
      raise exception using errcode = '22023', message = 'invalid storage deletion target';
    end if;
  elsif p_action_type in ('calendar_event_sync', 'calendar_event_delete') then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.booking_id ? (@.type() == "string")'
    ) then
      raise exception using errcode = '22023', message = 'invalid calendar action target';
    end if;
    perform (p_payload->>'booking_id')::uuid;
  elsif p_action_type = 'calendar_disconnect' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.barber_id ? (@.type() == "string")'
    )
       or pg_catalog.char_length(p_payload->>'barber_id') not between 1 and 32 then
      raise exception using errcode = '22023', message = 'invalid calendar disconnect target';
    end if;
  elsif p_action_type = 'customer_access_email_send' then
    if p_payload->>'challenge_id' is null
       or p_payload->>'access_code' is null
       or p_payload->>'access_code' !~ '^[0-9a-f]{64}$'
       or p_payload->>'lang' not in ('sv', 'en') then
      raise exception using errcode = '22023', message = 'invalid customer access delivery';
    end if;
    perform (p_payload->>'challenge_id')::uuid;
  elsif p_action_type = 'auth_user_access_sync' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.user_id ? (@.type() == "string")'
    )
       or pg_catalog.jsonb_typeof(p_payload->'account_enabled') <> 'boolean'
       or pg_catalog.jsonb_typeof(p_payload->'version') <> 'number' then
      raise exception using errcode = '22023', message = 'invalid auth access target';
    end if;
    perform (p_payload->>'user_id')::uuid;
    perform (p_payload->>'version')::bigint;
  elsif p_action_type = 'auth_user_delete' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.user_id ? (@.type() == "string")'
    ) then
      raise exception using errcode = '22023', message = 'invalid auth deletion target';
    end if;
    perform (p_payload->>'user_id')::uuid;
  else
    raise exception using errcode = '22023', message = 'unsupported external action';
  end if;

  insert into public.external_action_jobs (action_type, dedupe_key, payload)
  values (p_action_type, p_dedupe_key, p_payload)
  on conflict (action_type, dedupe_key) do update
    set payload = excluded.payload,
        status = 'pending',
        next_attempt_at = pg_catalog.now(),
        dispatch_token = null,
        last_error_code = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.queue_external_action(text, text, jsonb)
  from public, anon, authenticated, service_role;

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
    join public.barber_calendar_tokens t on t.barber_id = b.barber_id
    where b.id = p_booking_id
      and b.status = 'confirmed'
      and t.disconnect_requested_at is null
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
     or old.start_at is distinct from new.start_at
     or old.end_at is distinct from new.end_at then
    perform public.queue_calendar_event_sync(new.id);
  end if;

  return new;
end;
$$;

revoke execute on function public.queue_booking_calendar_sync()
  from public, anon, authenticated, service_role;

drop trigger if exists booking_calendar_sync_on_change on public.bookings;
create trigger booking_calendar_sync_on_change
after insert or update of status, barber_id, service_name, customer_name, phone, start_at, end_at
on public.bookings
for each row execute function public.queue_booking_calendar_sync();

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
    where c.id = (v_job.payload->>'challenge_id')::uuid
      and c.used_at is null
      and c.expires_at > pg_catalog.now();

    if not found or not exists (
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

    return pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'dispatch_token', v_job.dispatch_token,
      'action_type', v_job.action_type,
      'email', v_challenge.email,
      'lang', v_job.payload->>'lang',
      'access_code', v_job.payload->>'access_code'
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

create or replace function public.block_external_action(
  p_id uuid,
  p_dispatch_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    return false;
  end if;

  update public.external_action_jobs j
  set status = 'blocked',
      payload = case
        when j.action_type = 'customer_access_email_send' then j.payload - 'access_code'
        else j.payload
      end,
      dispatch_token = null,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  return found;
end;
$$;

create or replace function public.create_customer_booking_access_request(
  p_phone text,
  p_email text,
  p_token_hash text,
  p_access_code text,
  p_lang text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_has_booking boolean;
  v_challenge_id uuid;
begin
  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_access_code !~ '^[0-9a-f]{64}$'
     or p_lang not in ('sv', 'en') then
    return false;
  end if;

  select exists (
    select 1
    from public.bookings b
    where b.phone = p_phone
      and pg_catalog.lower(b.email) = v_email
      and b.status = 'confirmed'
  ) into v_has_booking;

  update public.customer_booking_access_challenges c
  set used_at = pg_catalog.now()
  where c.phone = p_phone
    and c.email = v_email
    and c.used_at is null;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (p_phone, v_email, p_token_hash, pg_catalog.now() + interval '15 minutes')
  returning id into v_challenge_id;

  -- Queue for every syntactically valid request. The dispatcher re-checks whether a confirmed
  -- booking matches before exposing the email/code to the worker, keeping public response behavior
  -- and the durable write path uniform for matching and non-matching requests.
  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'access_code', p_access_code,
      'lang', p_lang
    )
  );

  return v_has_booking;
end;
$$;

revoke execute on function public.create_customer_booking_access_request(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_customer_booking_access_request(text, text, text, text, text)
  to service_role;

create or replace function public.create_review_with_access(
  p_session_hash text,
  p_phone text,
  p_rating int,
  p_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_phone text;
  v_scope_email text;
  v_booking_id uuid;
  v_customer text;
  v_first text;
  v_second text;
  v_display text;
  v_row public.reviews;
begin
  if p_session_hash is null
     or p_session_hash !~ '^[0-9a-f]{64}$'
     or p_phone is null
     or p_phone !~ '^07[0-9]{8}$'
     or p_rating is null or p_rating < 1 or p_rating > 5
     or p_text is null
     or pg_catalog.char_length(p_text) < 1
     or pg_catalog.char_length(p_text) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.phone, s.email into v_scope_phone, v_scope_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found or v_scope_phone <> p_phone then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = v_scope_phone
    and pg_catalog.lower(b.email) = v_scope_email
    and b.end_at < pg_catalog.now()
    and not exists (
      select 1 from public.reviews r where r.booking_id = b.id
    )
  order by b.end_at desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  v_customer := pg_catalog.btrim(v_customer);
  v_first := pg_catalog.split_part(v_customer, ' ', 1);
  v_second := pg_catalog.split_part(v_customer, ' ', 2);
  v_display := v_first
    || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;
  v_display := pg_catalog.left(v_display, 80);
  if v_display = '' then
    v_display := 'Kund';
  end if;

  begin
    insert into public.reviews (name, rating, text, booking_id, published)
    values (v_display, p_rating::smallint, p_text, v_booking_id, true)
    returning * into v_row;
  exception
    when unique_violation then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'review', pg_catalog.jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'rating', v_row.rating,
      'text', v_row.text
    )
  );
end;
$$;

revoke execute on function public.create_review_with_access(text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.create_review_with_access(text, text, int, text) to service_role;

create or replace function public.admin_delete_bookings(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  v_barber_id text := public.current_barber_id();
  v_count bigint;
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
      and b.end_at > pg_catalog.now()
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
    and not (status = 'confirmed' and end_at > pg_catalog.now());
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
     or (b.status = 'confirmed' and b.end_at <= pg_catalog.now())
  order by b.id
  for update;

  if exists (
    select 1
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    where (b.status = 'cancelled'
        or (b.status = 'confirmed' and b.end_at <= pg_catalog.now()))
      and j.status in ('pending', 'dispatching', 'failed')
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'delivery_pending');
  end if;

  delete from public.bookings b
  where b.status = 'cancelled'
     or (b.status = 'confirmed' and b.end_at <= pg_catalog.now());
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

create or replace function public.cleanup_customer_access_email_actions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.external_action_jobs j
  where j.action_type = 'customer_access_email_send'
    and (
      j.status = 'blocked'
      or not exists (
        select 1
        from public.customer_booking_access_challenges c
        where c.id = (j.payload->>'challenge_id')::uuid
          and c.used_at is null
          and c.expires_at > pg_catalog.now()
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.cleanup_customer_access_email_actions()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'customer-access-email-action-cleanup') then
    perform cron.unschedule('customer-access-email-action-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'customer-access-email-action-cleanup',
  '*/10 * * * *',
  'select public.cleanup_customer_access_email_actions()'
);
