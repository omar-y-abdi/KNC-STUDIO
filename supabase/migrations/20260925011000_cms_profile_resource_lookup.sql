-- Both authenticated resource gateways verify the chosen barber before writing
-- an immutable portrait. Local stacks may not pre-grant service_role table access;
-- ensure at least the ID lookup is available without changing existing managed grants.
begin;
grant select (id) on public.barbers to service_role;
commit;
