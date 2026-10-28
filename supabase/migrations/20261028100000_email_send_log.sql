-- Owner-visible record of every transactional email the Edge Functions hand to Resend. One row per
-- message: the sender records each attempt after the provider answered, keyed by the SHA-256 of the
-- message's idempotency key, so retries update the same row. booking_email_delivery_jobs stays the
-- source of truth for booking delivery and retries; this table is only a read model of what was sent.
create table public.email_send_log (
  id              uuid primary key default gen_random_uuid(),
  dedupe_key      text not null unique check (dedupe_key ~ '^[0-9a-f]{64}$'),
  kind            text not null check (kind in (
    'customer_confirmation',
    'barber_confirmation',
    'customer_cancellation',
    'barber_cancellation',
    'customer_reminder',
    'customer_booking_access',
    'customer_email_link',
    'auth_recovery',
    'auth_email_change',
    'auth_invite'
  )),
  recipient       text not null check (
    char_length(recipient) between 3 and 254 and position('@' in recipient) > 1
  ),
  subject         text not null check (char_length(subject) between 1 and 998),
  -- The copy as sent, except that credential-bearing links are replaced before the row is written.
  html            text not null check (char_length(html) <= 500000),
  text_body       text not null check (char_length(text_body) <= 100000),
  status          text not null check (status in ('sent', 'failed')),
  error_code      text check (error_code in ('send_failed_transient', 'send_failed_permanent')),
  -- A hard-deleted booking keeps its sent emails visible until the 30-day purge.
  booking_id      uuid references public.bookings(id) on delete set null,
  attempt_count   integer not null default 1 check (attempt_count >= 1),
  created_at      timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz not null default pg_catalog.now(),
  constraint email_send_log_error_matches_status check ((status = 'failed') = (error_code is not null))
);

create index email_send_log_listing_idx on public.email_send_log (created_at desc, id desc);

create index email_send_log_booking_idx on public.email_send_log (booking_id)
where booking_id is not null;

alter table public.email_send_log enable row level security;
revoke all on table public.email_send_log from anon, authenticated, service_role;

-- A delivered message stays delivered: a later attempt under the same idempotency key (a reclaimed
-- dispatch, an expired provider key) cannot turn the row back into a failure.
create or replace function public.internal_record_email_send(
  p_dedupe_key text,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_html text,
  p_text_body text,
  p_status text,
  p_error_code text,
  p_booking_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_send_log as l (
    dedupe_key, kind, recipient, subject, html, text_body, status, error_code, booking_id
  )
  values (
    p_dedupe_key, p_kind, p_recipient, p_subject, p_html, p_text_body, p_status, p_error_code,
    p_booking_id
  )
  on conflict (dedupe_key) do update
  set kind = excluded.kind,
      recipient = excluded.recipient,
      subject = excluded.subject,
      html = excluded.html,
      text_body = excluded.text_body,
      status = excluded.status,
      error_code = excluded.error_code,
      booking_id = excluded.booking_id,
      attempt_count = l.attempt_count + 1,
      last_attempt_at = pg_catalog.now()
  where l.status = 'failed';
end;
$$;

revoke execute on function public.internal_record_email_send(
  text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.internal_record_email_send(
  text, text, text, text, text, text, text, text, uuid
) to service_role;

-- Newest first without bodies. The cursor is the last entry's (created_at, id); pass created_at
-- back verbatim, since a JavaScript Date drops its microseconds.
create or replace function public.admin_list_email_send_log(
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
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'entries', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', page.id,
          'created_at', page.created_at,
          'last_attempt_at', page.last_attempt_at,
          'kind', page.kind,
          'recipient', page.recipient,
          'subject', page.subject,
          'status', page.status,
          'error_code', page.error_code,
          'booking_id', page.booking_id,
          'attempt_count', page.attempt_count
        ) order by page.position) filter (where page.position <= v_limit),
        '[]'::jsonb
      ),
      'has_more', pg_catalog.count(*) > v_limit
    )
    from (
      select l.id, l.created_at, l.last_attempt_at, l.kind, l.recipient, l.subject, l.status,
             l.error_code, l.booking_id, l.attempt_count,
             pg_catalog.row_number() over (order by l.created_at desc, l.id desc) as position
      from public.email_send_log l
      where p_before is null
         or l.created_at < p_before
         or (p_before_id is not null and l.created_at = p_before and l.id < p_before_id)
      order by l.created_at desc, l.id desc
      limit v_limit + 1
    ) page
  );
end;
$$;

-- One stored copy; null once it has been purged.
create or replace function public.admin_get_email_send_log_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = 'owner required';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'id', l.id,
      'subject', l.subject,
      'html', l.html,
      'text_body', l.text_body
    )
    from public.email_send_log l
    where l.id = p_id
  );
end;
$$;

revoke execute on function public.admin_list_email_send_log(timestamptz, integer, uuid)
  from public, anon;
revoke execute on function public.admin_get_email_send_log_entry(uuid)
  from public, anon;
grant execute on function public.admin_list_email_send_log(timestamptz, integer, uuid)
  to authenticated;
grant execute on function public.admin_get_email_send_log_entry(uuid) to authenticated;

-- Adds who and when to every failed delivery so the owner knows whom to contact. Every earlier key
-- is unchanged; the deployed frontend's non-strict schema ignores the new ones.
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
      'failed_at', j.failed_at,
      'sent_kinds', j.sent_kinds,
      'customer_name', b.customer_name,
      'customer_email', b.email,
      'customer_phone', b.phone,
      'booking_start_at', b.start_at,
      'barber_name', coalesce(ba.name, b.barber_id),
      'barber_email', (
        select u.email
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.role = 'barber'
          and p.barber_id = b.barber_id
        order by p.created_at asc
        limit 1
      )
    ) order by j.failed_at desc, j.created_at desc)
    from public.booking_email_delivery_jobs j
    join public.bookings b on b.id = j.booking_id
    left join public.barbers ba on ba.id = b.barber_id
    where j.status = 'failed'
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_list_failed_booking_email_deliveries()
  from public, anon;
grant execute on function public.admin_list_failed_booking_email_deliveries() to authenticated;

create or replace function public.internal_purge_email_send_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.email_send_log l
  where l.created_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.internal_purge_email_send_log()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-send-log-purge') then
    perform cron.unschedule('email-send-log-purge');
  end if;
end;
$$;

select cron.schedule(
  'email-send-log-purge',
  '29 3 * * *',
  'select public.internal_purge_email_send_log()'
);
