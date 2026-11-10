-- Owner review moderation. Hiding keeps the row, so reviews_one_per_booking still blocks a second
-- review of that booking; deleting the review makes the booking reviewable again.

create or replace function public.admin_list_reviews(
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
            'name', page.name,
            'rating', page.rating,
            'text', page.text,
            'published', page.published
          ) order by page.position) filter (where page.position <= v_limit),
          '[]'::jsonb
        ),
        'has_more', pg_catalog.count(*) > v_limit
      )
      from (
        select r.id, r.created_at, r.name, r.rating, r.text, r.published,
               pg_catalog.row_number() over (order by r.created_at desc, r.id desc) as position
        from public.reviews r
        order by r.created_at desc, r.id desc
        limit v_limit + 1
      ) page
    );
  end if;

  if p_before is null or p_before_id is null then
    raise exception using errcode = '22023',
      message = 'a review cursor needs both p_before and p_before_id';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'entries', coalesce(
        pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', page.id,
          'created_at', page.created_at,
          'name', page.name,
          'rating', page.rating,
          'text', page.text,
          'published', page.published
        ) order by page.position) filter (where page.position <= v_limit),
        '[]'::jsonb
      ),
      'has_more', pg_catalog.count(*) > v_limit
    )
    from (
      select r.id, r.created_at, r.name, r.rating, r.text, r.published,
             pg_catalog.row_number() over (order by r.created_at desc, r.id desc) as position
      from public.reviews r
      where (r.created_at, r.id) < (p_before, p_before_id)
      order by r.created_at desc, r.id desc
      limit v_limit + 1
    ) page
  );
end;
$$;

revoke all on function public.admin_list_reviews(timestamptz, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reviews(timestamptz, integer, uuid)
  to authenticated;

-- Setting the value a review already has succeeds.
create or replace function public.admin_set_review_published(p_id uuid, p_published boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_id is null or p_published is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  update public.reviews r
  set published = p_published
  where r.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_review_published(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_review_published(uuid, boolean)
  to authenticated;

create or replace function public.admin_delete_review(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  delete from public.reviews r
  where r.id = p_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_delete_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_review(uuid)
  to authenticated;
