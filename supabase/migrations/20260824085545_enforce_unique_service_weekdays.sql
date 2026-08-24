-- Keep the week-day set unambiguous at the database boundary. The admin UI
-- writes a sorted array, and availability checks use `= any(...)`; accepting
-- duplicates would make a seven-element array look like "all days" in clients
-- while still omitting a weekday.
create function public.canonical_service_weekdays(p_weekdays smallint[])
returns smallint[]
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select coalesce(array_agg(weekday order by weekday), array[]::smallint[])
  from (
    select distinct weekday
    from unnest(p_weekdays) as weekday
  ) as unique_weekdays;
$$;

alter table public.services
  add constraint services_available_weekdays_canonical
  check (available_weekdays = public.canonical_service_weekdays(available_weekdays));
