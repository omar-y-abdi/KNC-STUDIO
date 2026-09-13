-- Email is the identity boundary. A shared/recycled phone never joins customer histories.
-- A permanent profile merge requires fresh, explicit proof from BOTH mailboxes.
create table public.customer_profiles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  version bigint not null default 1 check (version > 0)
);
create table public.customer_profile_emails (
  email text primary key check (email = pg_catalog.lower(pg_catalog.btrim(email))
    and pg_catalog.char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  profile_id uuid not null references public.customer_profiles(id)
);
create index customer_profile_emails_profile_idx on public.customer_profile_emails(profile_id);

create table public.customer_email_links (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  source_email text not null references public.customer_profile_emails(email),
  target_email text not null references public.customer_profile_emails(email),
  -- Immutable snapshots, deliberately not FKs: a merged-away profile makes old requests stale.
  source_profile uuid not null,
  target_profile uuid not null,
  source_version bigint not null,
  target_version bigint not null,
  source_generation bigint not null,
  target_generation bigint not null,
  source_hash text not null unique check (source_hash ~ '^[0-9a-f]{64}$'),
  target_hash text not null unique check (target_hash ~ '^[0-9a-f]{64}$'),
  source_ciphertext text not null check (source_ciphertext ~ '^v1\.[A-Za-z0-9_-]+$' and length(source_ciphertext) between 40 and 700),
  target_ciphertext text not null check (target_ciphertext ~ '^v1\.[A-Za-z0-9_-]+$' and length(target_ciphertext) between 40 and 700),
  source_verified_at timestamptz,
  target_verified_at timestamptz,
  expires_at timestamptz not null default (pg_catalog.now() + interval '30 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (source_email <> target_email and source_profile <> target_profile and source_hash <> target_hash)
);
create index customer_email_links_expiry_idx on public.customer_email_links(expires_at);
create index customer_email_links_source_idx on public.customer_email_links(source_email) where used_at is null;

alter table public.customer_profiles enable row level security;
alter table public.customer_profile_emails enable row level security;
alter table public.customer_email_links enable row level security;
revoke all on public.customer_profiles, public.customer_profile_emails, public.customer_email_links
  from public, anon, authenticated, service_role;

-- A stable lock also covers an email whose first access-token row does not exist yet.
-- Merge order: profiles -> sorted email locks -> token rows. Token writers take email -> token.
create function public.lock_customer_access_emails(p_emails text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  for v_email in select distinct e from unnest(p_emails) e where e is not null order by e
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('customer-email-access'), pg_catalog.hashtext(v_email));
  end loop;
end;
$$;
revoke execute on function public.lock_customer_access_emails(text[]) from public,anon,authenticated,service_role;

create function public.ensure_customer_email_profile(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_profile uuid;
  v_created uuid;
begin
  if v_email is null or pg_catalog.char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
  select e.profile_id into v_profile from public.customer_profile_emails e where e.email = v_email;
  if found then return v_profile; end if;
  insert into public.customer_profiles default values returning id into v_created;
  insert into public.customer_profile_emails(email, profile_id) values(v_email, v_created)
    on conflict(email) do update set email = excluded.email returning profile_id into v_profile;
  if v_profile <> v_created then delete from public.customer_profiles where id = v_created; end if;
  return v_profile;
end;
$$;

-- Existing email identities start separate, even when they have the same telephone number.
do $$
declare r record;
begin
  for r in select lower(btrim(email)) as email from public.bookings where email is not null
    union select email from public.customer_booking_access_tokens
    union select email from public.customer_booking_access_sessions
  loop perform public.ensure_customer_email_profile(r.email); end loop;
end;
$$;

create function public.assign_booking_customer_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_customer_email_profile(new.email);
  return new;
end;
$$;
create trigger bookings_customer_email_profile after insert or update of email on public.bookings
  for each row execute function public.assign_booking_customer_profile();

create function public.customer_profile_emails_for_email(p_email text) returns setof text
language sql stable security definer set search_path = '' as $$
  select e.email from public.customer_profile_emails e
  join public.customer_profile_emails owner on owner.profile_id = e.profile_id
  where owner.email = p_email
  union select p_email where p_email is not null;
$$;

-- A single queue entry per recipient; raw link credentials never enter the queue payload.
create function public.request_customer_email_link(
  p_session_hash text, p_target_email text, p_source_hash text, p_target_hash text,
  p_source_ciphertext text, p_target_ciphertext text, p_lang text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source text;
  v_target text := lower(btrim(p_target_email));
  v_source_profile uuid;
  v_target_profile uuid;
  v_source_version bigint;
  v_target_version bigint;
  v_source_generation bigint;
  v_target_generation bigint;
  v_id uuid;
begin
  select s.email into v_source from public.customer_booking_access_sessions s
    where s.token_hash = p_session_hash and s.expires_at > pg_catalog.now();
  if v_source is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  if v_target is null or length(v_target) > 254 or v_target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_target_hash is null or p_target_hash !~ '^[0-9a-f]{64}$'
    or p_source_hash = p_target_hash
    or p_source_ciphertext is null or p_source_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
    or p_target_ciphertext is null or p_target_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
    or length(p_source_ciphertext) not between 40 and 700 or length(p_target_ciphertext) not between 40 and 700
    or p_lang is null or p_lang not in ('sv','en') then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  v_source_profile := public.ensure_customer_email_profile(v_source);
  v_target_profile := public.ensure_customer_email_profile(v_target);
  if v_source_profile = v_target_profile then return jsonb_build_object('ok',true,'status','already_linked'); end if;
  -- Consistent row order for merges touching the same pair in opposite directions.
  perform 1 from public.customer_profiles where id in(v_source_profile,v_target_profile) order by id for update;
  if not exists(select 1 from public.customer_profile_emails where email=v_source and profile_id=v_source_profile)
    or not exists(select 1 from public.customer_profile_emails where email=v_target and profile_id=v_target_profile) then
    return jsonb_build_object('ok',false,'error','stale');
  end if;
  perform public.lock_customer_access_emails(array[v_source,v_target]);
  if not exists(select 1 from public.customer_booking_access_sessions where token_hash=p_session_hash
    and email=v_source and expires_at > pg_catalog.now()) then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  select version into v_source_version from public.customer_profiles where id=v_source_profile;
  select version into v_target_version from public.customer_profiles where id=v_target_profile;
  select generation into v_source_generation from public.customer_booking_access_tokens where email=v_source;
  select coalesce((select generation from public.customer_booking_access_tokens where email=v_target),0) into v_target_generation;
  if v_source_generation is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  update public.customer_email_links set used_at=pg_catalog.now() where source_email=v_source and used_at is null;
  insert into public.customer_email_links(source_email,target_email,source_profile,target_profile,
    source_version,target_version,source_generation,target_generation,source_hash,target_hash,source_ciphertext,target_ciphertext)
  values(v_source,v_target,v_source_profile,v_target_profile,v_source_version,v_target_version,
    v_source_generation,v_target_generation,p_source_hash,p_target_hash,p_source_ciphertext,p_target_ciphertext)
  returning id into v_id;
  insert into public.external_action_jobs(action_type,dedupe_key,payload) values
    ('customer_email_link_send',v_id::text||'/source',jsonb_build_object('link_id',v_id,'side','source','lang',p_lang)),
    ('customer_email_link_send',v_id::text||'/target',jsonb_build_object('link_id',v_id,'side','target','lang',p_lang));
  return jsonb_build_object('ok',true,'status','queued');
end;
$$;

create function public.confirm_customer_email_link(p_session_hash text,p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.customer_email_links;
  v_source text;
  v_source_version bigint;
  v_target_version bigint;
  v_source_generation bigint;
  v_target_generation bigint;
begin
  select s.email into v_source from public.customer_booking_access_sessions s
    where s.token_hash=p_session_hash and s.expires_at > pg_catalog.now();
  if v_source is null then return jsonb_build_object('ok',false,'error','access_denied'); end if;
  -- Read the immutable identities first. Profile locks always precede the request row lock.
  select l.* into v_link from public.customer_email_links l
    where l.source_hash=p_code_hash or l.target_hash=p_code_hash;
  if not found then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if v_link.source_email <> v_source then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  perform 1 from public.customer_profiles where id in(v_link.source_profile,v_link.target_profile) order by id for update;
  select l.* into v_link from public.customer_email_links l where l.id=v_link.id for update;
  if v_link.used_at is not null or v_link.expires_at <= pg_catalog.now() then
    return jsonb_build_object('ok',false,'error','invalid');
  end if;
  perform public.lock_customer_access_emails(array[v_link.source_email,v_link.target_email]);
  -- SHARE conflicts with access-token rotation. A revoked source session cannot win after rotation.
  perform 1 from public.customer_booking_access_tokens where email in(v_link.source_email,v_link.target_email)
    order by email for share;
  if not exists(select 1 from public.customer_booking_access_sessions where token_hash=p_session_hash
    and email=v_source and expires_at > pg_catalog.now()) then
    return jsonb_build_object('ok',false,'error','access_denied');
  end if;
  select version into v_source_version from public.customer_profiles where id=v_link.source_profile;
  select version into v_target_version from public.customer_profiles where id=v_link.target_profile;
  select generation into v_source_generation from public.customer_booking_access_tokens where email=v_link.source_email;
  select coalesce((select generation from public.customer_booking_access_tokens where email=v_link.target_email),0) into v_target_generation;
  if v_source_version is distinct from v_link.source_version or v_target_version is distinct from v_link.target_version
    or v_source_generation is distinct from v_link.source_generation or v_target_generation is distinct from v_link.target_generation
    or not exists(select 1 from public.customer_profile_emails where email=v_source and profile_id=v_link.source_profile)
    or not exists(select 1 from public.customer_profile_emails where email=v_link.target_email and profile_id=v_link.target_profile) then
    return jsonb_build_object('ok',false,'error','stale');
  end if;
  update public.customer_email_links set
    source_verified_at=case when source_hash=p_code_hash then coalesce(source_verified_at,pg_catalog.now()) else source_verified_at end,
    target_verified_at=case when target_hash=p_code_hash then coalesce(target_verified_at,pg_catalog.now()) else target_verified_at end
    where id=v_link.id returning * into v_link;
  if v_link.source_verified_at is null or v_link.target_verified_at is null then
    return jsonb_build_object('ok',true,'status','waiting');
  end if;
  update public.customer_profile_emails set profile_id=v_link.source_profile where profile_id=v_link.target_profile;
  update public.customer_profiles set version=version+1 where id=v_link.source_profile;
  delete from public.customer_profiles where id=v_link.target_profile;
  update public.customer_email_links set used_at=pg_catalog.now()
    where used_at is null and (source_profile in(v_link.source_profile,v_link.target_profile)
      or target_profile in(v_link.source_profile,v_link.target_profile));
  return jsonb_build_object('ok',true,'status','linked');
end;
$$;

alter table public.external_action_jobs drop constraint external_action_jobs_action_type_check;
alter table public.external_action_jobs add constraint external_action_jobs_action_type_check check (
  action_type in ('storage_object_delete','calendar_event_sync','calendar_event_delete','calendar_disconnect',
    'customer_access_email_send','customer_email_link_send','auth_user_access_sync','auth_user_delete')
);

revoke execute on function public.ensure_customer_email_profile(text),public.assign_booking_customer_profile(),
  public.customer_profile_emails_for_email(text)
  from public,anon,authenticated,service_role;
revoke execute on function public.request_customer_email_link(text,text,text,text,text,text,text),
  public.confirm_customer_email_link(text,text) from public,anon,authenticated;
grant execute on function public.request_customer_email_link(text,text,text,text,text,text,text),
  public.confirm_customer_email_link(text,text) to service_role;

-- Every customer operation shares the same verified email group; receipts retain exact-ID scope.
create or replace function public.list_customer_bookings_for_browser(p_session_hash text, p_receipt_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_phone text;
  v_booking_phone text;
  v_name text;
  v_receipt boolean;
begin
  select s.email, s.phone into v_email, v_phone
  from public.customer_booking_access_scope(p_session_hash) s;
  select exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) into v_receipt;
  if v_email is null and not v_receipt then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  if v_email is not null then
    select b.customer_name, b.phone into v_name, v_booking_phone from public.bookings b
    where pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email)) order by b.created_at desc, b.id desc limit 1;
  end if;
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', true, 'authority', case when v_email is null then 'device' else 'verified' end,
    'email', v_email, 'phone', coalesce(v_booking_phone, v_phone), 'name', v_name, 'receipt_active', v_receipt,
    'emails', case when v_email is not null then (select jsonb_agg(e order by e)
      from public.customer_profile_emails_for_email(v_email) e) end,
    'phones', case when v_email is not null then (select jsonb_agg(distinct b.phone order by b.phone)
      from public.bookings b where lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        and b.phone ~ '^07[0-9]{8}$') end,
    'bookings', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.id, 'barber_id', b.barber_id, 'barber_name', barber.name,
      'service_name', b.service_name, 'price', b.price, 'duration_min', b.duration_min,
      'start_at', b.start_at
    ) order by b.start_at desc) from public.bookings b
      join public.barbers barber on barber.id = b.barber_id
      where b.status = 'confirmed' and (
        pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
        or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email))
      )), '[]'::jsonb)
  ));
end;
$$;

create or replace function public.cancel_customer_booking_for_browser(
  p_booking_id uuid, p_session_hash text, p_receipt_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_cutoff_hours integer;
begin
  select s.email into v_email from public.customer_booking_access_scope(p_session_hash) s;
  if v_email is null and not exists(select 1 from public.customer_booking_receipts r
    where r.token_hash = p_receipt_hash and r.expires_at > pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'access_denied');
  end if;
  select case when s.value ~ '^[0-9]{1,3}$' then least(s.value::integer, 168) else 24 end
    into v_cutoff_hours from public.site_settings s where s.key = 'cancellation_policy_hours';
  update public.bookings b set status = 'cancelled', cancelled_at = pg_catalog.now()
  where b.id = p_booking_id and b.status = 'confirmed'
    and b.start_at > pg_catalog.now() + pg_catalog.make_interval(hours => coalesce(v_cutoff_hours, 24))
    and (pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
      or b.id in (select public.customer_device_booking_ids(p_receipt_hash, v_email)));
  return case when found then pg_catalog.jsonb_build_object('ok', true)
    else pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found') end;
end;
$$;

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

  select s.email into v_scope_email
  from public.customer_booking_access_scope(p_session_hash) s;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_booking');
  end if;

  select b.id, b.customer_name
    into v_booking_id, v_customer
  from public.bookings b
  where b.status = 'confirmed'
    and b.phone = p_phone
    and pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_scope_email))
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
  where pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_email))
    and b.status = 'confirmed'
    and b.phone ~ '^07[0-9]{8}$'
  order by b.created_at desc, b.id desc
  limit 1;

  if not found then
    return false;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

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

  -- Wait for any in-flight legacy exchange before taking the session-deletion snapshot.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;

  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;

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

create or replace function public.cleanup_customer_booking_access()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer := 0; v_deleted integer := 0;
begin
  delete from public.customer_booking_access_challenges
  where expires_at < pg_catalog.now() - interval '1 day' or used_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_count = row_count;
  delete from public.customer_booking_access_sessions where expires_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.customer_booking_receipts where expires_at <= pg_catalog.now();
  get diagnostics v_deleted = row_count;
  v_count := v_count + v_deleted;
  delete from public.customer_email_links where expires_at < pg_catalog.now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_count + v_deleted;
end;
$$;

create or replace function public.list_customer_bookings_with_access(p_session_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.list_customer_bookings_for_browser(p_session_hash,null);
$$;
create or replace function public.cancel_customer_booking_with_access(p_booking_id uuid,p_session_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.cancel_customer_booking_for_browser(p_booking_id,p_session_hash,null);
$$;

-- Dispatch all jobs through one contract; remove superseded inline Calendar implementations.
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
  v_challenge public.customer_booking_access_challenges;
  v_token_ciphertext text;
  v_profile public.profiles;
  v_link public.customer_email_links;
  v_calendar jsonb;
begin
  select j.* into v_job
  from public.external_action_jobs j
  where j.id = p_id
    and j.status = 'dispatching'
    and j.dispatch_token = p_dispatch_token;

  if not found then
    return null;
  end if;

  -- The current Calendar implementation is the only source of Calendar dispatch context.
  v_calendar := public.calendar_external_action_for_dispatch(p_id,p_dispatch_token);
  if v_calendar is not null then return v_calendar; end if;

  if v_job.action_type = 'customer_email_link_send' then
    select l.* into v_link from public.customer_email_links l
      join public.customer_profiles a on a.id=l.source_profile and a.version=l.source_version
      join public.customer_profiles b on b.id=l.target_profile and b.version=l.target_version
      join public.customer_booking_access_tokens t on t.email=l.source_email and t.generation=l.source_generation
      where l.id=(v_job.payload->>'link_id')::uuid and l.used_at is null and l.expires_at > pg_catalog.now()
        and coalesce((select generation from public.customer_booking_access_tokens where email=l.target_email),0)=l.target_generation
        and ((v_job.payload->>'side'='source' and l.source_verified_at is null)
          or (v_job.payload->>'side'='target' and l.target_verified_at is null));
    if not found then return jsonb_build_object('id',v_job.id,'dispatch_token',v_job.dispatch_token,
      'action_type',v_job.action_type,'superseded',true); end if;
    return jsonb_build_object('id',v_job.id,'dispatch_token',v_job.dispatch_token,'action_type',v_job.action_type,
      'link_id',v_link.id,'side',v_job.payload->>'side',
      'email',case when v_job.payload->>'side'='source' then v_link.source_email else v_link.target_email end,
      'source_email',v_link.source_email,'target_email',v_link.target_email,'lang',v_job.payload->>'lang',
      'token_ciphertext',case when v_job.payload->>'side'='source' then v_link.source_ciphertext else v_link.target_ciphertext end);
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
        and pg_catalog.lower(b.email) in (select public.customer_profile_emails_for_email(v_challenge.email))
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


  return pg_catalog.jsonb_build_object(
    'id', v_job.id,
    'dispatch_token', v_job.dispatch_token,
    'action_type', v_job.action_type,
    'user_id', v_job.payload->>'user_id'
  );
end;
$$;

-- Existing token initialization and ciphertext repair join the same lock family.
CREATE OR REPLACE FUNCTION public.ensure_customer_booking_access_token(p_email text, p_phone text, p_token_hash text, p_token_ciphertext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_row public.customer_booking_access_tokens;
begin
  if v_email is null or p_phone is null or p_token_hash is null or p_token_ciphertext is null
     or p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$' then
    return null;
  end if;

  if not exists (
    select 1
    from public.bookings b
    where b.phone = p_phone
      and pg_catalog.lower(b.email) = v_email
      and b.status = 'confirmed'
  ) then
    return null;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

  insert into public.customer_booking_access_tokens (
    email, phone, token_hash, token_ciphertext
  ) values (
    v_email, p_phone, p_token_hash, p_token_ciphertext
  )
  on conflict (email) do update
    set phone = excluded.phone,
        updated_at = pg_catalog.now()
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'token_ciphertext', v_row.token_ciphertext,
    'generation', v_row.generation
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_customer_booking_access_token(p_email text, p_phone text, p_token_hash text, p_token_ciphertext text, p_expected_generation bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if v_email is null or p_phone is null or p_token_hash is null
     or p_token_ciphertext is null or p_expected_generation is null
     or p_expected_generation < 1
     or p_phone !~ '^07[0-9]{8}$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or pg_catalog.char_length(v_email) > 254
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.char_length(p_token_ciphertext) not between 40 and 700
     or p_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+$'
     or not exists (
       select 1 from public.bookings b
       where b.phone = p_phone and pg_catalog.lower(b.email) = v_email
         and b.status = 'confirmed'
     ) then
    return false;
  end if;

  perform public.lock_customer_access_emails(array[v_email]);

  update public.customer_booking_access_tokens t
  set phone = p_phone, token_hash = p_token_hash, token_ciphertext = p_token_ciphertext,
      generation = t.generation + 1, updated_at = pg_catalog.now()
  where t.email = v_email and t.generation = p_expected_generation;
  if not found then return false; end if;

  -- Same lock order as fresh-link rotation: token, challenges, sessions.
  delete from public.customer_booking_access_challenges c
  where pg_catalog.lower(c.email) = v_email;
  delete from public.customer_booking_access_sessions s
  where pg_catalog.lower(s.email) = v_email;
  return true;
end;
$function$;
