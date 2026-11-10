-- Admin audit log: who changed which row of a staff-managed table and, for an update, the names of
-- the changed columns. Values are never stored: no customer name, phone, e-mail address or text.

-- CREATE TRIGGER blocks writes to its table until commit, so the triggers come last and bookings
-- last of all (see the end of the file); a lock wait over 5 s fails the migration.
set lock_timeout = '5s';

create table if not exists public.admin_audit_log (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  created_at      timestamptz not null default pg_catalog.now(),
  -- No foreign key: an entry outlives the staff account it names.
  actor_id        uuid not null,
  action          text not null,
  target_table    text not null,
  target_id       text not null,
  changed_columns text[],
  constraint admin_audit_log_action_check check (action in ('insert', 'update', 'delete')),
  constraint admin_audit_log_target_table_check check (target_table in (
    'bookings',
    'barbers',
    'services',
    'profiles',
    'site_settings',
    'barber_schedules',
    'barber_time_off',
    'barber_slot_blocks',
    'barber_recurring_breaks',
    'reviews',
    'staff_invitations',
    'barber_photos',
    'barber_calendar_tokens',
    'cms_revisions'
  )),
  -- Each shape is the shape the source table's own constraints give its primary key.
  constraint admin_audit_log_target_id_check check (
    case
      when target_table in (
        'bookings', 'services', 'profiles', 'barber_time_off', 'barber_slot_blocks',
        'barber_recurring_breaks', 'reviews', 'staff_invitations'
      ) then target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when target_table in ('barbers', 'barber_photos', 'barber_calendar_tokens')
        then target_id ~ '^[a-z0-9-]{1,32}$'
      when target_table = 'barber_schedules' then target_id ~ '^[a-z0-9-]{1,32}/[0-6]$'
      when target_table = 'site_settings' then pg_catalog.char_length(target_id) between 1 and 40
      when target_table = 'cms_revisions' then target_id ~ '^[0-9]{1,18}$'
      else false
    end
  ),
  constraint admin_audit_log_changed_columns_check check (
    changed_columns is null
    or (
      coalesce(pg_catalog.array_ndims(changed_columns), 0) = 1
      and pg_catalog.array_position(changed_columns, null::text) is null
      and pg_catalog.array_to_string(changed_columns, ',')
        ~ '^[a-z_][a-z0-9_]{0,62}(,[a-z_][a-z0-9_]{0,62})*$'
    )
  ),
  constraint admin_audit_log_changed_matches_action check (
    (action = 'update') = (changed_columns is not null)
  )
);

create index if not exists admin_audit_log_listing_idx
  on public.admin_audit_log (created_at desc, id desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;

-- Arguments: the primary-key columns of the table. Records only requests with a staff JWT, and must
-- never fail the write it observes (least of all a booking): every statement here is total.
create or replace function public.internal_audit_staff_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub text;
  v_claims text;
  v_actor uuid;
  v_row jsonb;
  v_old jsonb;
  v_target_id text := '';
  v_changed text[];
begin
  -- The same two places auth.uid() reads, without its cast that raises on a malformed subject.
  v_sub := nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
  if v_sub is null then
    v_claims := nullif(pg_catalog.current_setting('request.jwt.claims', true), '');
    if v_claims is not null and pg_catalog.pg_input_is_valid(v_claims, 'jsonb') then
      v_sub := v_claims::jsonb ->> 'sub';
    end if;
  end if;
  if v_sub is null or not pg_catalog.pg_input_is_valid(v_sub, 'uuid') then
    return null;
  end if;

  select p.id into v_actor
  from public.profiles p
  where p.id = v_sub::uuid;
  if not found then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := pg_catalog.to_jsonb(old);
  else
    v_row := pg_catalog.to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    v_old := pg_catalog.to_jsonb(old);
    select pg_catalog.array_agg(n.key order by n.key) into v_changed
    from pg_catalog.jsonb_each(v_row) as n(key, value)
    where n.value is distinct from (v_old -> n.key)
      and n.key ~ '^[a-z_][a-z0-9_]{0,62}$';
    if v_changed is null then
      return null;
    end if;
  end if;

  for i in 0 .. tg_nargs - 1 loop
    v_target_id := v_target_id
      || case when i > 0 then '/' else '' end
      || (v_row ->> tg_argv[i]);
  end loop;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id, changed_columns)
  values (v_actor, pg_catalog.lower(tg_op), tg_table_name::text, v_target_id, v_changed);
  return null;
end;
$$;

revoke all on function public.internal_audit_staff_change()
  from public, anon, authenticated, service_role;

-- One entry per CMS Studio publish, which writes with the service role, unseen by the staff
-- trigger. A row without request_id is the first publish's snapshot, not a publish.
create or replace function public.internal_audit_cms_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_id is null
     or new.actor_id is null
     or coalesce(new.revision::text, '') !~ '^[0-9]{1,18}$'
     or not exists (select 1 from public.profiles p where p.id = new.actor_id) then
    return null;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id)
  values (new.actor_id, 'insert', 'cms_revisions', new.revision::text);
  return null;
end;
$$;

revoke all on function public.internal_audit_cms_publish()
  from public, anon, authenticated, service_role;

-- For Edge Functions acting with the service role for a signed-in staff member, where the database
-- sees no staff JWT. Called through supabase/functions/_shared/adminAudit.ts.
create or replace function public.internal_record_admin_action(
  p_actor uuid,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_detail jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id text;
  v_changed text[];
begin
  if p_actor is null
     or not exists (select 1 from public.profiles p where p.id = p_actor) then
    raise exception using errcode = '22023', message = 'actor is not a staff profile';
  end if;

  if p_action is null or p_action not in ('insert', 'update', 'delete') then
    raise exception using errcode = '22023', message = 'unknown action';
  end if;

  if p_target_table is null
     or p_target_table not in (
       'profiles', 'staff_invitations', 'barber_photos', 'barber_calendar_tokens'
     ) then
    raise exception using errcode = '22023', message = 'unknown target table';
  end if;

  if p_target_table in ('profiles', 'staff_invitations') then
    if p_target_id is null or not pg_catalog.pg_input_is_valid(p_target_id, 'uuid') then
      raise exception using errcode = '22023', message = 'invalid target id';
    end if;
    v_target_id := p_target_id::uuid::text;
  else
    if p_target_id is null
       or not exists (select 1 from public.barbers b where b.id = p_target_id) then
      raise exception using errcode = '22023', message = 'invalid target id';
    end if;
    v_target_id := p_target_id;
  end if;

  if p_detail is not null then
    if pg_catalog.jsonb_typeof(p_detail) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid detail';
    end if;
    if p_detail - 'changed' <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_detail -> 'changed') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid detail';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_detail -> 'changed') as e(value)
      where pg_catalog.jsonb_typeof(e.value) is distinct from 'string'
         or not exists (
           select 1
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = p_target_table
             and a.attnum > 0
             and not a.attisdropped
             and a.attname = (e.value #>> '{}')
         )
    ) then
      raise exception using errcode = '22023', message = 'invalid detail';
    end if;
    select pg_catalog.array_agg(distinct e.value #>> '{}' order by e.value #>> '{}')
      into v_changed
    from pg_catalog.jsonb_array_elements(p_detail -> 'changed') as e(value);
    if v_changed is null then
      raise exception using errcode = '22023', message = 'invalid detail';
    end if;
  end if;

  if (p_action = 'update') <> (v_changed is not null) then
    raise exception using errcode = '22023', message = 'invalid detail';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id, changed_columns)
  values (p_actor, p_action, p_target_table, v_target_id, v_changed);
end;
$$;

revoke all on function public.internal_record_admin_action(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.internal_record_admin_action(uuid, text, text, text, jsonb)
  to service_role;

-- actor_role and actor_barber_id are the profile as it is now; null once the account is gone.
create or replace function public.admin_list_audit_log(
  p_before timestamptz default null,
  p_limit integer default 50,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.account_enabled
      and not p.must_change_password
  ) then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  if p_before is null and p_before_id is null then
    return (
      select pg_catalog.jsonb_build_object(
        'entries', coalesce(
          pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', page.id,
            'created_at', page.created_at,
            'actor_id', page.actor_id,
            'actor_role', actor.role,
            'actor_barber_id', actor.barber_id,
            'action', page.action,
            'target_table', page.target_table,
            'target_id', page.target_id,
            'changed_columns', pg_catalog.to_jsonb(page.changed_columns)
          ) order by page.position) filter (where page.position <= v_limit),
          '[]'::jsonb
        ),
        'has_more', pg_catalog.count(*) > v_limit
      )
      from (
        select l.id, l.created_at, l.actor_id, l.action, l.target_table, l.target_id,
               l.changed_columns,
               pg_catalog.row_number() over (order by l.created_at desc, l.id desc) as position
        from public.admin_audit_log l
        order by l.created_at desc, l.id desc
        limit v_limit + 1
      ) page
      left join public.profiles actor on actor.id = page.actor_id
    );
  end if;

  if p_before is null or p_before_id is null then
    raise exception using errcode = '22023',
      message = 'a log cursor needs both p_before and p_before_id';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'entries', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', page.id,
          'created_at', page.created_at,
          'actor_id', page.actor_id,
          'actor_role', actor.role,
          'actor_barber_id', actor.barber_id,
          'action', page.action,
          'target_table', page.target_table,
          'target_id', page.target_id,
          'changed_columns', pg_catalog.to_jsonb(page.changed_columns)
        ) order by page.position) filter (where page.position <= v_limit),
        '[]'::jsonb
      ),
      'has_more', pg_catalog.count(*) > v_limit
    )
    from (
      select l.id, l.created_at, l.actor_id, l.action, l.target_table, l.target_id,
             l.changed_columns,
             pg_catalog.row_number() over (order by l.created_at desc, l.id desc) as position
      from public.admin_audit_log l
      where (l.created_at, l.id) < (p_before, p_before_id)
      order by l.created_at desc, l.id desc
      limit v_limit + 1
    ) page
    left join public.profiles actor on actor.id = page.actor_id
  );
end;
$$;

revoke all on function public.admin_list_audit_log(timestamptz, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_audit_log(timestamptz, integer, uuid)
  to authenticated;

create or replace function public.internal_purge_admin_audit_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.admin_audit_log l
  where l.created_at < pg_catalog.now() - interval '12 months';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.internal_purge_admin_audit_log()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'admin-audit-log-purge') then
    perform cron.unschedule('admin-audit-log-purge');
  end if;
end;
$$;

select cron.schedule(
  'admin-audit-log-purge',
  '41 3 * * *',
  'select public.internal_purge_admin_audit_log()'
);

-- Lock order: the tables only staff write first, then the two customers write (reviews, bookings),
-- so no lock wait happens while bookings is held.
create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.barbers
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.services
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.profiles
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.site_settings
  for each row execute function public.internal_audit_staff_change('key');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.barber_schedules
  for each row execute function public.internal_audit_staff_change('barber_id', 'weekday');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.barber_time_off
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.barber_slot_blocks
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.barber_recurring_breaks
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture_publish
  after insert on public.cms_revisions
  for each row execute function public.internal_audit_cms_publish();

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.reviews
  for each row execute function public.internal_audit_staff_change('id');

create or replace trigger admin_audit_log_capture
  after insert or update or delete on public.bookings
  for each row execute function public.internal_audit_staff_change('id');

reset lock_timeout;
