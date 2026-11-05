-- Staff enrollment has its own one-use capability. Auth recovery/OTP expiry stays unchanged.
-- Only the SHA-256 digest is stored; the random capability exists only in the invitation email.
create table public.staff_invitations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from public, anon, authenticated;
grant all on public.staff_invitations to service_role;

-- DELETE is the atomic one-use claim. A second caller cannot obtain the same user's identity.
-- There is deliberately no age predicate. Disabled or activated accounts cannot be enrolled.
create function public.consume_staff_invitation(p_token_hash text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  delete from public.staff_invitations i
  where i.token_hash = p_token_hash
    and exists (
      select 1 from public.profiles p
      join auth.users u on u.id = p.id
      where p.id = i.user_id and p.role = 'barber' and p.account_enabled
        and p.barber_id is not null and u.email_confirmed_at is null
        and (u.banned_until is null or u.banned_until <= now())
    )
  returning i.user_id;
$$;
revoke all on function public.consume_staff_invitation(text) from public, anon, authenticated;
grant execute on function public.consume_staff_invitation(text) to service_role;

-- Revocation survives later re-enabling: only a fresh owner invitation can enroll the account.
create function public.revoke_disabled_staff_invitation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not new.account_enabled or new.role <> 'barber'
    or new.barber_id is distinct from old.barber_id then
    delete from public.staff_invitations where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.revoke_disabled_staff_invitation() from public, anon, authenticated;
create trigger revoke_disabled_staff_invitation
after update of account_enabled, role, barber_id on public.profiles
for each row execute function public.revoke_disabled_staff_invitation();

update public.email_templates
set note = case lang when 'sv' then 'Länken kan bara användas en gång.'
  else 'The link can only be used once.' end
where template = 'auth_invite';
