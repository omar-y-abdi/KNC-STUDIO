-- Orphaned customer contact data (checklist item 68, gap 2).
--
-- A customer's e-mail address is stored in three places besides the bookings themselves: the
-- permanent access token (customer_booking_access_tokens, which also holds a phone number), the
-- profile membership (customer_profile_emails) and the profile (customer_profiles). When the last
-- booking of an address is deleted, by the owner or by the retention job, nothing removed those
-- rows. The nightly customer-booking-access-cleanup job now does.
--
-- An e-mail address is IN USE while any of these exists:
--   * a booking with that address, whatever its status or date,
--   * an access session for it that has not expired,
--   * an unused, unexpired access challenge for it,
--   * an unexpired device receipt that names it as the parent address,
--   * a customer_email_links row that names it as source or target. Every stored link counts, not
--     only a pending one: the existing statement in this function removes a link one day after it
--     expires, and the foreign keys from a link to customer_profile_emails forbid deleting an
--     address a stored link names.
-- Addresses that share a profile (the customer linked them) are one group: the access functions
-- give each address in a group the bookings of all of them. A group is in use while any address in
-- it is in use. An address without a profile row is a group of its own.
--
-- The job deletes, for a group that is not in use: its access tokens, its profile memberships, and
-- then the profile once it has no membership left. It deletes nothing of a group that is in use, so
-- a customer with at least one booking keeps the token, the membership and the profile. Phone
-- numbers are not an access key in this schema; a token is found by its e-mail address only.
--
-- Deployment order: old application code calls nothing that changes here, and nothing here needs
-- new application code. The cron schedule and the grants of the function are not touched.

-- Every normalised e-mail address that is in use, as defined above. Internal: callable by no API
-- role; it runs with the rights of the cleanup function that calls it.
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

-- The first four statements are the baseline's, unchanged. The baseline ended with
-- "return v_count + v_deleted;"; that sum is now kept in v_count and the orphan steps follow.
--
-- The orphan steps run in a block of their own. If anything in them raises, that block alone is
-- rolled back, a warning that carries only the SQLSTATE is logged (an error message can quote an
-- e-mail address), and the function returns what the four statements above deleted. The nightly
-- expiry of challenges, sessions, receipts and links therefore never depends on the new steps.
--
-- One race is left open, because closing it would mean taking a lock in the booking path: a booking
-- that commits for an address while this run is deleting that address's rows can leave the address
-- without its access token, its profile membership and its profile. The booking is untouched and
-- is still found by its address; the token is written again by the next confirmation, cancellation
-- or access e-mail for the address, and the profile the next time the address is booked or linked.
create or replace function public.cleanup_customer_booking_access()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer := 0; v_deleted integer := 0;
  v_orphaned integer := 0;
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
    -- Orphaned contact data. Each step is its own statement, so each sees what was committed
    -- before it started; the locks taken in steps 1 and 2 keep the functions that write these rows
    -- out until this transaction ends, and every delete decides again from its own, later view.

    -- Step 1. Lock up to 200 profiles none of whose addresses is in use. A profile another
    -- transaction holds (a customer is linking or merging addresses right now) is skipped, never
    -- waited for. request_customer_email_link and confirm_customer_email_link take the same row
    -- lock before they add a link or move an address, so from here on no link can appear for a
    -- locked profile and no address can join or leave it.
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

    -- Step 2. Take the per-address lock the token functions take (lock_customer_access_emails) for
    -- up to 400 addresses: those of the locked profiles, and those of unused tokens that have no
    -- profile row. An address whose lock is held (its token is being issued or rotated right now)
    -- is skipped, never waited for. While this transaction holds the lock, no token for the
    -- address can be created, replaced or rotated.
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

    -- A profile is handled whole or not at all. Take out of this run every locked profile that has
    -- an address whose lock step 2 did not obtain: its token is being written right now, or the
    -- address fell outside the 400 of this run. A later run handles the profile.
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

    -- Step 3. Delete the access token of an address when, as seen now:
    --   the address is locked by step 2, and
    --   the address is not in use, and
    --   the address has no profile row, or its profile is still in this run's list and no address
    --   of that profile is in use.
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

    -- Step 4. Delete the profile membership of an address when, as seen now:
    --   the address is locked by step 2 and its profile is still in this run's list, and
    --   no address of that profile (this one included) is in use.
    -- A stored link keeps both of its addresses in use, so no deleted membership is referenced by
    -- customer_email_links, and step 1 keeps a new link from appearing before this commits.
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

    -- Step 5. Delete a profile of this run's list that has no membership left.
    delete from public.customer_profiles p
    where p.id = any (v_profiles)
      and not exists (
        select 1 from public.customer_profile_emails e where e.profile_id = p.id
      );
    get diagnostics v_deleted = row_count;
    v_orphaned := v_orphaned + v_deleted;

    -- Nothing after this line can raise, so the count is added only for steps that are kept.
    v_count := v_count + v_orphaned;
  exception when others then
    raise warning 'orphaned customer contact data was not cleaned in this run (SQLSTATE %)', sqlstate;
  end;

  return v_count;
end;
$$;

-- CREATE OR REPLACE keeps the owner and the privileges of the existing function; the baseline
-- grants it to no API role. Stated again so a re-run ends in the same place.
revoke all on function public.cleanup_customer_booking_access()
  from public, anon, authenticated, service_role;
