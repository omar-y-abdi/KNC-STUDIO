-- Both authenticated resource gateways verify the chosen barber before writing
-- an immutable portrait. Service-role RLS bypass does not confer SQL privileges.
-- Grant only the ID read needed by that lookup, not roster or booking mutation.
begin;
grant select (id) on public.barbers to service_role;
commit;
