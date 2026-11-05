-- The server needs row operations only, never TRUNCATE or schema/trigger privileges.
revoke all on public.staff_invitations from service_role;
grant select, insert, update, delete on public.staff_invitations to service_role;
