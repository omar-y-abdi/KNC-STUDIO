-- The nightly customer-booking-access-cleanup job now also deletes access challenges whose e-mail
-- can no longer be sent, and the tokens, profile memberships and profiles of addresses no longer in
-- use (a linked group only when none of it is). Its first run removes what earlier booking
-- deletions left behind, at most 200 profiles a night.

-- Normalised addresses in use. Every stored link counts, expired or not: its foreign keys forbid
-- deleting the memberships it names.
create or replace function public.customer_emails_in_use()
returns setof text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.btrim(b.email))
  from public.bookings b
  where b.email is not null
  union
  select pg_catalog.lower(pg_catalog.btrim(s.email))
  from public.customer_booking_access_sessions s
  where s.expires_at > pg_catalog.now()
  union
  select pg_catalog.lower(pg_catalog.btrim(c.email))
  from public.customer_booking_access_challenges c
  where c.used_at is null
    and c.expires_at > pg_catalog.now()
  union
  select rb.parent_email
  from public.customer_booking_receipt_bookings rb
  join public.customer_booking_receipts r on r.token_hash = rb.receipt_hash
  where rb.parent_email is not null
    and r.expires_at > pg_catalog.now()
  union
  select l.source_email
  from public.customer_email_links l
  union
  select l.target_email
  from public.customer_email_links l;
$$;

revoke all on function public.customer_emails_in_use()
  from public, anon, authenticated, service_role;

-- The orphan steps run in their own block: a failure rolls back only them and logs the SQLSTATE
-- alone (a message can quote an address). Left open, to keep locks out of the booking path: a
-- booking committing during the run can lose its address's token, membership and profile; the next
-- e-mail to the address writes the token again, the next booking or link the profile.
create or replace function public.cleanup_customer_booking_access()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer := 0; v_deleted integer := 0;
  v_orphaned integer := 0;
  v_dead text[] := '{}';
  v_profiles uuid[];
  v_emails text[] := '{}';
  v_email text;
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
  v_count := v_count + v_deleted;

  begin
    -- Steps 0 to 2 take the locks the request, link and token functions take; each later delete
    -- re-checks from its own, later snapshot.

    -- Step 0. Challenges whose e-mail can no longer be sent: a job is only ever queued together
    -- with its challenge (rotate_customer_booking_access_token), so such a challenge stays so.
    -- Address lock: lock_customer_access_emails' key; a held address is left to a later run.
    for v_email in
      select d.email
      from (
        select distinct pg_catalog.lower(pg_catalog.btrim(c.email)) as email
        from public.customer_booking_access_challenges c
        where c.used_at is null
          and c.expires_at > pg_catalog.now()
          and not exists (
            select 1
            from public.external_action_jobs j
            where j.action_type = 'customer_access_email_send'
              and j.payload ->> 'challenge_id' = c.id::text
              and j.status in ('pending', 'dispatching')
          )
      ) d
      order by d.email
      limit 200
    loop
      if pg_catalog.pg_try_advisory_xact_lock(
           pg_catalog.hashtext('customer-email-access'), pg_catalog.hashtext(v_email)) then
        v_dead := v_dead || v_email;
      end if;
    end loop;

    -- Re-checked under the address locks: a request that committed first is seen with its pending
    -- job; a row another transaction holds (send worker, legacy exchange) is skipped.
    with dead as (
      select c.id
      from public.customer_booking_access_challenges c
      where pg_catalog.lower(pg_catalog.btrim(c.email)) = any (v_dead)
        and c.used_at is null
        and c.expires_at > pg_catalog.now()
        and not exists (
          select 1
          from public.external_action_jobs j
          where j.action_type = 'customer_access_email_send'
            and j.payload ->> 'challenge_id' = c.id::text
            and j.status in ('pending', 'dispatching')
        )
      for update of c skip locked
    )
    delete from public.customer_booking_access_challenges c
    using dead
    where c.id = dead.id;
    get diagnostics v_deleted = row_count;
    v_orphaned := v_orphaned + v_deleted;

    -- Step 1. request_customer_email_link and confirm_customer_email_link take the same row lock,
    -- so a locked profile gains no link and no address joins or leaves it.
    with locked as (
      select p.id
      from public.customer_profiles p
      where not exists (
        select 1
        from public.customer_profile_emails e
        join public.customer_emails_in_use() as u(email) on u.email = e.email
        where e.profile_id = p.id
      )
      order by p.id
      limit 200
      for update of p skip locked
    )
    select coalesce(pg_catalog.array_agg(locked.id), '{}'::uuid[]) into v_profiles
    from locked;

    -- Step 2. The same address lock, for the locked profiles' addresses and unused tokens without a
    -- profile row: while it is held, no token for the address can be written.
    for v_email in
      select c.email
      from (
        select e.email
        from public.customer_profile_emails e
        where e.profile_id = any (v_profiles)
        union
        select t.email
        from public.customer_booking_access_tokens t
        where not exists (
          select 1 from public.customer_profile_emails e where e.email = t.email
        )
          and not exists (
            select 1 from public.customer_emails_in_use() as u(email) where u.email = t.email
          )
      ) c
      order by c.email
      limit 400
    loop
      if pg_catalog.pg_try_advisory_xact_lock(
           pg_catalog.hashtext('customer-email-access'), pg_catalog.hashtext(v_email)) then
        v_emails := v_emails || v_email;
      end if;
    end loop;

    -- A profile is handled whole or not at all: drop those with an address step 2 did not lock.
    v_profiles := array(
      select p.id
      from pg_catalog.unnest(v_profiles) as p(id)
      where not exists (
        select 1
        from public.customer_profile_emails e
        where e.profile_id = p.id
          and not (e.email = any (v_emails))
      )
    );

    -- Step 3. Tokens of locked, unused addresses whose profile, if any, is in this run and unused.
    with in_use as materialized (
      select u.email from public.customer_emails_in_use() as u(email)
    )
    delete from public.customer_booking_access_tokens t
    where t.email = any (v_emails)
      and not exists (select 1 from in_use u where u.email = t.email)
      and not exists (
        select 1
        from public.customer_profile_emails own
        where own.email = t.email
          and (
            not (own.profile_id = any (v_profiles))
            or exists (
              select 1
              from public.customer_profile_emails sibling
              join in_use u on u.email = sibling.email
              where sibling.profile_id = own.profile_id
            )
          )
      );
    get diagnostics v_deleted = row_count;
    v_orphaned := v_orphaned + v_deleted;

    -- Step 4. Memberships of those profiles. A stored link keeps its addresses in use and step 1
    -- blocks new links, so no deleted membership is referenced by customer_email_links.
    with in_use as materialized (
      select u.email from public.customer_emails_in_use() as u(email)
    )
    delete from public.customer_profile_emails e
    where e.email = any (v_emails)
      and e.profile_id = any (v_profiles)
      and not exists (
        select 1
        from public.customer_profile_emails sibling
        join in_use u on u.email = sibling.email
        where sibling.profile_id = e.profile_id
      );
    get diagnostics v_deleted = row_count;
    v_orphaned := v_orphaned + v_deleted;

    -- Step 5. Profiles left without a membership.
    delete from public.customer_profiles p
    where p.id = any (v_profiles)
      and not exists (
        select 1 from public.customer_profile_emails e where e.profile_id = p.id
      );
    get diagnostics v_deleted = row_count;
    v_orphaned := v_orphaned + v_deleted;

    -- Last in the block, so a rolled-back block adds nothing.
    v_count := v_count + v_orphaned;
  exception when others then
    raise warning 'orphaned customer contact data was not cleaned in this run (SQLSTATE %)', sqlstate;
  end;

  return v_count;
end;
$$;

revoke all on function public.cleanup_customer_booking_access()
  from public, anon, authenticated, service_role;
