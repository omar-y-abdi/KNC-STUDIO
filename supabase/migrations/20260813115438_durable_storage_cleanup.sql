-- One durable outbox owns external side effects that cannot join a PostgreSQL transaction:
-- Storage object deletion, Google Calendar event deletion, and Supabase Auth account state.
-- Jobs carry identifiers only. Credentials are resolved server-side by service-role RPCs.

alter table public.profiles
  add column auth_sync_version bigint not null default 0;

create table public.external_action_jobs (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (
    action_type in (
      'storage_object_delete',
      'calendar_event_delete',
      'calendar_disconnect',
      'auth_user_access_sync',
      'auth_user_delete'
    )
  ),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'dispatching', 'blocked')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  dispatch_token uuid,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  created_at timestamptz not null default pg_catalog.now(),
  unique (action_type, dedupe_key),
  check (
    (status in ('pending', 'blocked') and dispatch_token is null)
    or (status = 'dispatching' and dispatch_token is not null)
  )
);

create index external_action_jobs_dispatch_idx
  on public.external_action_jobs (next_attempt_at, created_at)
  where status = 'pending';

create index external_action_jobs_reclaim_idx
  on public.external_action_jobs (last_attempt_at)
  where status = 'dispatching';

alter table public.external_action_jobs enable row level security;
revoke all on table public.external_action_jobs from public, anon, authenticated, service_role;

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
  elsif p_action_type = 'calendar_event_delete' then
    if not pg_catalog.jsonb_path_exists(
      p_payload,
      '$.booking_id ? (@.type() == "string")'
    ) then
      raise exception using errcode = '22023', message = 'invalid calendar deletion target';
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
      select 1
      from public.gallery_images g
      where g.storage_path = v_job.payload->>'path'
    )) or (v_job.payload->>'bucket' = 'barber-photos' and exists (
      select 1
      from public.barber_photos p
      where p.storage_path = v_job.payload->>'path'
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

create or replace function public.claim_external_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_token uuid := pg_catalog.gen_random_uuid();
begin
  update public.external_action_jobs j
  set status = 'dispatching',
      attempt_count = j.attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      dispatch_token = v_dispatch_token,
      last_error_code = null
  where j.id = p_id
    and (
      j.status = 'pending'
      or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    );

  if not found then
    return null;
  end if;

  return public.external_action_for_dispatch(p_id, v_dispatch_token);
end;
$$;

create or replace function public.complete_external_action(
  p_id uuid,
  p_dispatch_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;
  return found;
end;
$$;

create or replace function public.fail_external_action(
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
  if p_error_code is null
     or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    return false;
  end if;

  update public.external_action_jobs j
  set status = 'pending',
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(
          3600,
          (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
        )
      ),
      dispatch_token = null,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  return found;
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
  if p_error_code is null
     or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    return false;
  end if;

  update public.external_action_jobs j
  set status = 'blocked',
      dispatch_token = null,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  return found;
end;
$$;

revoke execute on function public.external_action_for_dispatch(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.claim_external_action(uuid)
  from public, anon, authenticated;
revoke execute on function public.complete_external_action(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.fail_external_action(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.block_external_action(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.external_action_for_dispatch(uuid, uuid) to service_role;
grant execute on function public.claim_external_action(uuid) to service_role;
grant execute on function public.complete_external_action(uuid, uuid) to service_role;
grant execute on function public.fail_external_action(uuid, uuid, text) to service_role;
grant execute on function public.block_external_action(uuid, uuid, text) to service_role;

-- Upload compensation is best-effort at request time. Reconcile old, unreferenced bytes into the
-- same durable outbox so a simultaneous Storage/API failure cannot create a permanent orphan.
-- Existing jobs are left untouched; this avoids invalidating an in-flight dispatch token.
create or replace function public.queue_orphaned_storage_objects()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object record;
  v_queued integer := 0;
begin
  for v_object in
    select o.bucket_id, o.name
    from storage.objects o
    where o.bucket_id in ('gallery', 'barber-photos')
      and o.created_at < pg_catalog.now() - interval '30 minutes'
      and not exists (
        select 1
        from public.external_action_jobs j
        where j.action_type = 'storage_object_delete'
          and j.dedupe_key = o.bucket_id || ':' || o.name
      )
      and (
        (o.bucket_id = 'gallery' and not exists (
          select 1
          from public.gallery_images g
          where g.storage_path = o.name
        ))
        or
        (o.bucket_id = 'barber-photos' and not exists (
          select 1
          from public.barber_photos p
          where p.storage_path = o.name
        ))
      )
    order by o.created_at, o.id
    limit 100
  loop
    perform public.queue_external_action(
      'storage_object_delete',
      v_object.bucket_id || ':' || v_object.name,
      pg_catalog.jsonb_build_object('bucket', v_object.bucket_id, 'path', v_object.name)
    );
    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

revoke execute on function public.queue_orphaned_storage_objects()
  from public, anon, authenticated, service_role;

create or replace function public.queue_due_external_actions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_job record;
  v_dispatch_token uuid;
  v_queued integer := 0;
begin
  begin
    perform public.queue_orphaned_storage_objects();
  exception when others then
    raise warning 'orphaned Storage reconciliation failed';
  end;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'external_cleanup_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'booking_webhook_secret';

  if v_url is null or v_secret is null then
    return 0;
  end if;

  for v_job in
    select j.id
    from public.external_action_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= pg_catalog.now())
       or (j.status = 'dispatching' and j.last_attempt_at < pg_catalog.now() - interval '5 minutes')
    order by j.next_attempt_at, j.created_at
    for update skip locked
    limit 25
  loop
    update public.external_action_jobs j
    set status = 'dispatching',
        attempt_count = j.attempt_count + 1,
        last_attempt_at = pg_catalog.now(),
        dispatch_token = pg_catalog.gen_random_uuid(),
        last_error_code = null
    where j.id = v_job.id
    returning j.dispatch_token into v_dispatch_token;

    perform net.http_post(
      url := v_url,
      body := pg_catalog.jsonb_build_object(
        'action_id', v_job.id,
        'dispatch_token', v_dispatch_token
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_secret
      ),
      timeout_milliseconds := 5000
    );

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
exception when others then
  raise warning 'external action enqueue failed';
  return v_queued;
end;
$$;

revoke execute on function public.queue_due_external_actions()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'storage-deletion-dispatch') then
    perform cron.unschedule('storage-deletion-dispatch');
  end if;
  if exists (select 1 from cron.job where jobname = 'external-action-dispatch') then
    perform cron.unschedule('external-action-dispatch');
  end if;
end;
$$;

select cron.schedule(
  'external-action-dispatch',
  '* * * * *',
  'select public.queue_due_external_actions()'
);

-- Image bytes and metadata must move through upload-image so replacement/deletion intent cannot be
-- split across browser requests. Public reads remain unchanged.
revoke insert, update, delete on table public.gallery_images from authenticated;
revoke insert, update, delete on table public.barber_photos from authenticated;

drop policy if exists gallery_insert_owner on public.gallery_images;
drop policy if exists gallery_update_owner on public.gallery_images;
drop policy if exists gallery_delete_owner on public.gallery_images;
drop policy if exists barber_photos_insert_owner on public.barber_photos;
drop policy if exists barber_photos_insert_own on public.barber_photos;
drop policy if exists barber_photos_update_owner on public.barber_photos;
drop policy if exists barber_photos_update_own on public.barber_photos;
drop policy if exists barber_photos_delete_owner on public.barber_photos;
drop policy if exists barber_photos_delete_own on public.barber_photos;

drop policy if exists gallery_owner_delete on storage.objects;
drop policy if exists barber_photos_owner_delete on storage.objects;
drop policy if exists barber_photos_own_delete on storage.objects;

-- Storage metadata changes and object deletion intent commit together. The Edge Function may process
-- the returned action immediately; otherwise cron retries it from the same outbox.
create or replace function public.queue_storage_deletion(p_bucket text, p_object_path text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.queue_external_action(
    'storage_object_delete',
    p_bucket || ':' || p_object_path,
    pg_catalog.jsonb_build_object('bucket', p_bucket, 'path', p_object_path)
  );
$$;

revoke execute on function public.queue_storage_deletion(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.internal_queue_storage_deletion(
  p_bucket text,
  p_object_path text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.queue_storage_deletion(p_bucket, p_object_path);
$$;

revoke execute on function public.internal_queue_storage_deletion(text, text)
  from public, anon, authenticated;
grant execute on function public.internal_queue_storage_deletion(text, text) to service_role;

create or replace function public.internal_queue_auth_user_delete(p_user_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.queue_external_action(
    'auth_user_delete',
    p_user_id::text,
    pg_catalog.jsonb_build_object('user_id', p_user_id)
  );
$$;

revoke execute on function public.internal_queue_auth_user_delete(uuid)
  from public, anon, authenticated;
grant execute on function public.internal_queue_auth_user_delete(uuid) to service_role;

create or replace function public.internal_insert_gallery_image(
  p_kind text,
  p_storage_path text,
  p_alt text,
  p_sort_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gallery_images;
begin
  if p_kind not in ('salon', 'cuts')
     or p_storage_path is null
     or pg_catalog.char_length(p_storage_path) not between 1 and 200
     or p_storage_path not like p_kind || '/%.webp'
     or p_alt is null
     or pg_catalog.char_length(p_alt) > 2000
     or p_sort_order is null then
    raise exception using errcode = '22023', message = 'invalid gallery image';
  end if;

  insert into public.gallery_images (kind, storage_path, alt, sort_order)
  values (p_kind, p_storage_path, p_alt, p_sort_order)
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'storage_path', v_row.storage_path,
    'alt', v_row.alt,
    'sort_order', v_row.sort_order
  );
end;
$$;

create or replace function public.internal_delete_gallery_image(
  p_id uuid,
  p_expected_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_job_id uuid;
begin
  delete from public.gallery_images g
  where g.id = p_id
    and g.storage_path = p_expected_path
  returning g.storage_path into v_path;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_job_id := public.queue_storage_deletion('gallery', v_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'gallery',
    'path', v_path,
    'deletion_id', v_job_id
  );
end;
$$;

create or replace function public.internal_delete_barber_photo(
  p_barber_id text,
  p_expected_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_job_id uuid;
begin
  delete from public.barber_photos p
  where p.barber_id = p_barber_id
    and p.storage_path = p_expected_path
  returning p.storage_path into v_path;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_job_id := public.queue_storage_deletion('barber-photos', v_path);
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'bucket', 'barber-photos',
    'path', v_path,
    'deletion_id', v_job_id
  );
end;
$$;

create or replace function public.internal_replace_barber_photo(
  p_barber_id text,
  p_expected_path text,
  p_new_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_path text;
  v_job_id uuid;
begin
  if p_new_path is null
     or p_new_path not like p_barber_id || '/%'
     or pg_catalog.char_length(p_new_path) > 300 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('barber-photo:' || p_barber_id, 0)
  );

  select p.storage_path into v_current_path
  from public.barber_photos p
  where p.barber_id = p_barber_id
  for update;

  if v_current_path is distinct from p_expected_path then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.barber_photos (barber_id, storage_path)
  values (p_barber_id, p_new_path)
  on conflict (barber_id) do update set storage_path = excluded.storage_path;

  if v_current_path is not null and v_current_path <> p_new_path then
    v_job_id := public.queue_storage_deletion('barber-photos', v_current_path);
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'previous_path', v_current_path,
    'deletion_id', v_job_id
  );
end;
$$;

revoke execute on function public.internal_delete_gallery_image(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.internal_delete_barber_photo(text, text)
  from public, anon, authenticated;
revoke execute on function public.internal_replace_barber_photo(text, text, text)
  from public, anon, authenticated;
grant execute on function public.internal_delete_gallery_image(uuid, text) to service_role;
revoke execute on function public.internal_insert_gallery_image(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.internal_insert_gallery_image(text, text, text, integer)
  to service_role;
grant execute on function public.internal_delete_barber_photo(text, text) to service_role;
grant execute on function public.internal_replace_barber_photo(text, text, text) to service_role;

-- Database authorization changes immediately. Auth-side ban/unban follows through the outbox. A
-- monotonically increasing version makes a stale in-flight action harmless and preserves latest-wins.
create or replace function public.admin_set_barber_account_enabled(
  p_barber_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_version bigint;
  v_action_id uuid;
begin
  if not public.is_owner() then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_enabled is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  update public.profiles p
  set account_enabled = p_enabled,
      auth_sync_version = p.auth_sync_version + 1
  where p.role = 'barber'
    and p.barber_id = p_barber_id
  returning p.id, p.auth_sync_version into v_user_id, v_version;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;

  v_action_id := public.queue_external_action(
    'auth_user_access_sync',
    v_user_id::text,
    pg_catalog.jsonb_build_object(
      'user_id', v_user_id,
      'account_enabled', p_enabled,
      'version', v_version
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'account_enabled', p_enabled,
    'auth_sync_version', v_version,
    'action_id', v_action_id
  );
end;
$$;

revoke execute on function public.admin_set_barber_account_enabled(text, boolean)
  from public, anon;
grant execute on function public.admin_set_barber_account_enabled(text, boolean)
  to authenticated;

-- Cancellation and hard deletion preserve Calendar deletion intent. A late event insert also checks
-- current booking state, closing the insert/delete race before recording its mapping.
alter table public.barber_calendar_tokens
  add column disconnect_requested_at timestamptz;

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

drop function public.calendar_store_token(text, text, text, text);

create function public.calendar_store_token(
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
  v_map record;
begin
  select t.google_email, t.disconnect_requested_at
    into v_existing_email, v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id
  for update;

  if found and v_disconnect_requested_at is not null then
    if v_existing_email is null
       or p_google_email is null
       or pg_catalog.lower(v_existing_email) <> pg_catalog.lower(p_google_email) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'account_mismatch');
    end if;

    update public.barber_calendar_tokens t
    set refresh_token = p_refresh_token,
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

    return pg_catalog.jsonb_build_object('ok', true, 'cleanup_pending', true);
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

create or replace function public.queue_calendar_event_deletion(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.calendar_event_map m where m.booking_id = p_booking_id
  ) then
    return null;
  end if;

  return public.queue_external_action(
    'calendar_event_delete',
    p_booking_id::text,
    pg_catalog.jsonb_build_object('booking_id', p_booking_id)
  );
end;
$$;

revoke execute on function public.queue_calendar_event_deletion(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.queue_booking_calendar_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.queue_calendar_event_deletion(old.id);
    return old;
  end if;

  if old.status = 'confirmed' and new.status <> 'confirmed' then
    perform public.queue_calendar_event_deletion(new.id);
  end if;
  return new;
end;
$$;

revoke execute on function public.queue_booking_calendar_cleanup()
  from public, anon, authenticated, service_role;

drop trigger if exists booking_calendar_cleanup_on_status on public.bookings;
drop trigger if exists booking_calendar_cleanup_on_delete on public.bookings;

create trigger booking_calendar_cleanup_on_status
after update of status on public.bookings
for each row execute function public.queue_booking_calendar_cleanup();

create trigger booking_calendar_cleanup_on_delete
after delete on public.bookings
for each row execute function public.queue_booking_calendar_cleanup();

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
  v_status text;
  v_booking_confirmed boolean;
  v_disconnect_requested_at timestamptz;
begin
  insert into public.calendar_event_map (booking_id, barber_id, google_event_id)
  values (p_booking_id, p_barber_id, p_google_event_id)
  on conflict (booking_id) do update
    set barber_id = excluded.barber_id,
        google_event_id = excluded.google_event_id;

  select b.status into v_status
  from public.bookings b
  where b.id = p_booking_id;
  v_booking_confirmed := found and v_status = 'confirmed';

  select t.disconnect_requested_at into v_disconnect_requested_at
  from public.barber_calendar_tokens t
  where t.barber_id = p_barber_id;

  if not v_booking_confirmed or v_disconnect_requested_at is not null then
    perform public.queue_calendar_event_deletion(p_booking_id);
    return;
  end if;

  update public.barber_calendar_tokens t
  set last_sync_at = pg_catalog.now(), last_sync_error = null
  where t.barber_id = p_barber_id;
end;
$$;

revoke execute on function public.calendar_record_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.calendar_record_event(uuid, text, text) to service_role;

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
      from public.calendar_event_map m
      join public.external_action_jobs j
        on j.action_type = 'calendar_event_delete'
       and j.dedupe_key = m.booking_id::text
      where m.barber_id = me.bid
        and j.status = 'blocked'
        and j.last_error_code = 'calendar_authorization_required'
    ), false),
    'google_email', t.google_email,
    'last_sync_at', t.last_sync_at,
    'last_sync_error', t.last_sync_error
  )
  from (select public.current_barber_id() as bid) me
  left join public.barber_calendar_tokens t on t.barber_id = me.bid;
$$;

revoke execute on function public.calendar_sync_source(uuid) from public, anon, authenticated;
revoke execute on function public.calendar_backfill_source(text) from public, anon, authenticated;
revoke execute on function public.calendar_store_token(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.prepare_calendar_disconnect(text)
  from public, anon, authenticated;
revoke execute on function public.calendar_connection_status() from public, anon;
grant execute on function public.calendar_sync_source(uuid) to service_role;
grant execute on function public.calendar_backfill_source(text) to service_role;
grant execute on function public.calendar_store_token(text, text, text, text) to service_role;
grant execute on function public.prepare_calendar_disconnect(text) to service_role;
grant execute on function public.calendar_connection_status() to authenticated;

-- Hard barber deletion waits for mapped Google events to be removed, then atomically queues Auth
-- cleanup before deleting local rows. Owner retry is safe and eventually succeeds after outbox drain.
-- Direct table deletion would cascade Calendar credentials/mappings before cleanup intent survives.
revoke delete on table public.barbers from authenticated;
drop policy if exists barbers_delete_owner on public.barbers;

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
