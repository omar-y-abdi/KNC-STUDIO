-- Keep permanent customer bearer credentials out of durable external-action payloads. The canonical
-- token table already stores encrypted material; dispatch resolves that ciphertext by challenge id,
-- and the Edge worker decrypts it only immediately before constructing the email.

-- Forward scrub any queued legacy customer-access payloads before replacing the queue contract.
update public.external_action_jobs
set payload = pg_catalog.jsonb_build_object(
  'challenge_id', payload->'challenge_id',
  'lang', payload->'lang'
)
where action_type = 'customer_access_email_send'
  and payload ? 'access_code';

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
    if pg_catalog.jsonb_typeof(p_payload->'challenge_id') <> 'string'
       or p_payload->>'challenge_id' is null
       or pg_catalog.jsonb_typeof(p_payload->'lang') <> 'string'
       or p_payload->>'lang' not in ('sv', 'en')
       or (p_payload - 'challenge_id' - 'lang') <> '{}'::jsonb then
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

-- Keep the existing RPC signature for the public gateway, but only the challenge identifier and
-- language cross the durable boundary. The caller still passes the raw code transiently so the
-- existing request contract and canonical encrypted-token write remain unchanged.
create or replace function public.rotate_customer_booking_access_token(
  p_email text,
  p_token_hash text,
  p_token_ciphertext text,
  p_access_code text,
  p_lang text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_phone text;
  v_challenge_id uuid;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or p_access_code !~ '^[0-9a-f]{64}$'
     or p_lang not in ('sv', 'en') then
    return false;
  end if;

  select b.phone into v_phone
  from public.bookings b
  where pg_catalog.lower(b.email) = v_email
    and b.status = 'confirmed'
    and b.phone ~ '^07[0-9]{8}$'
  order by b.created_at desc, b.id desc
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, v_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        token_hash = excluded.token_hash,
        token_ciphertext = excluded.token_ciphertext,
        generation = public.customer_booking_access_tokens.generation + 1,
        updated_at = pg_catalog.now();

  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;

  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;

  insert into public.customer_booking_access_challenges (phone, email, token_hash, expires_at)
  values (v_phone, v_email, p_token_hash, 'infinity'::timestamptz)
  returning id into v_challenge_id;

  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'lang', p_lang
    )
  );

  return true;
end;
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

create or replace function public.consume_customer_access_email_challenge(
  p_challenge_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_booking_access_challenges c
  where c.id = p_challenge_id
    and c.used_at is null;
  return found;
end;
$$;

revoke execute on function public.consume_customer_access_email_challenge(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_customer_access_email_challenge(uuid)
  to service_role;

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
        when j.action_type = 'customer_access_email_send'
          then j.payload - 'access_code' - 'token_ciphertext'
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

-- Retain the service-role compatibility signature for old callers, but never persist its raw
-- access-code argument. Without the canonical encrypted token row, dispatch safely supersedes the
-- resulting finite compatibility challenge; active callers use rotate_customer_booking_access_token.
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

  perform public.queue_external_action(
    'customer_access_email_send',
    v_challenge_id::text,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_challenge_id,
      'lang', p_lang
    )
  );

  return v_has_booking;
end;
$$;
