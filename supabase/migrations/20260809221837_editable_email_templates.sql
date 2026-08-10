-- Owner-editable copy for every transactional email sent to customers and barbers. Brand mark,
-- booking facts, contact number, and salon address remain code-owned so copy edits cannot corrupt
-- identity or booking data. Delivery reads use a narrow service-role RPC; browser writes stay
-- owner-only through RLS.

create table public.email_templates (
  template      text not null,
  lang          text not null check (lang in ('sv', 'en')),
  subject       text not null,
  preheader     text not null,
  title         text not null,
  intro         text not null,
  section_title text,
  note          text not null,
  cta_label     text not null,
  contact_lead  text,
  updated_at    timestamptz not null default pg_catalog.now(),
  primary key (template, lang),
  constraint email_templates_template_check check (template in (
    'customer_confirmation',
    'barber_confirmation',
    'customer_cancellation',
    'barber_cancellation',
    'customer_reminder',
    'auth_recovery',
    'auth_email_change'
  )),
  constraint email_templates_subject_len check (char_length(subject) between 1 and 120),
  constraint email_templates_preheader_len check (char_length(preheader) between 1 and 180),
  constraint email_templates_title_len check (char_length(title) between 1 and 120),
  constraint email_templates_intro_len check (char_length(intro) between 1 and 800),
  constraint email_templates_section_title_len check (
    section_title is null or char_length(section_title) between 1 and 120
  ),
  constraint email_templates_note_len check (char_length(note) between 1 and 800),
  constraint email_templates_cta_len check (char_length(cta_label) between 1 and 80),
  constraint email_templates_contact_len check (
    contact_lead is null or char_length(contact_lead) between 1 and 240
  )
);

alter table public.email_templates enable row level security;
grant select, insert, update, delete on public.email_templates to authenticated;

create policy email_templates_select_owner on public.email_templates
  for select to authenticated using (public.is_owner());
create policy email_templates_insert_owner on public.email_templates
  for insert to authenticated with check (public.is_owner());
create policy email_templates_update_owner on public.email_templates
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy email_templates_delete_owner on public.email_templates
  for delete to authenticated using (public.is_owner());

insert into public.email_templates (
  template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead
) values
  (
    'customer_confirmation', 'sv', 'Bokningsbekräftelse',
    'Din tid hos {barber_name} är bokad.', 'Din tid är bokad',
    E'Hej {customer_name},\nTack för din bokning, du är varmt välkommen till oss!',
    'Din bokade tid', 'Din tid kan följas under "Mina bokningar", avbokningsvillkor 24h.',
    'Mina bokningar', 'Om du har frågor, kontakta oss på'
  ),
  (
    'customer_confirmation', 'en', 'Booking confirmation',
    'Your appointment with {barber_name} is confirmed.', 'Your appointment is confirmed',
    E'Hi {customer_name},\nThank you for your booking. You are warmly welcome to visit us!',
    'Your appointment', 'Follow your appointment under "My appointments". Cancellation policy: 24 hours.',
    'My appointments', 'Questions? Call us on'
  ),
  (
    'barber_confirmation', 'sv', 'Ny bokning',
    'Ny bokning {booking_date} {booking_time}.', 'En ny tid är bokad',
    '{customer_name} har bokat en tid hos {barber_name}.',
    'Bokningsuppgifter', 'Bokningen finns i adminpanelen tillsammans med kundens kontaktuppgifter.',
    'Öppna adminpanelen', 'Vid frågor, kontakta studion på'
  ),
  (
    'customer_cancellation', 'sv', 'Avbokningsbekräftelse',
    'Din tid hos {barber_name} är avbokad.', 'Din tid är avbokad',
    E'Hej {customer_name},\nDin avbokning är bekräftad.',
    'Din avbokade tid', 'Tiden är inte längre aktiv under "Mina bokningar".',
    'Boka en ny tid', 'Om du har frågor, kontakta oss på'
  ),
  (
    'customer_cancellation', 'en', 'Cancellation confirmation',
    'Your appointment with {barber_name} is cancelled.', 'Your appointment is cancelled',
    E'Hi {customer_name},\nYour cancellation is confirmed.',
    'Your cancelled appointment', 'The appointment is no longer active under "My appointments".',
    'Book a new appointment', 'Questions? Call us on'
  ),
  (
    'barber_cancellation', 'sv', 'Avbokad tid',
    'Avbokad tid {booking_date} {booking_time}.', 'En tid har avbokats',
    '{customer_name}s tid hos {barber_name} har avbokats.',
    'Avbokningsuppgifter', 'Tiden har tagits bort från kommande bokningar.',
    'Öppna adminpanelen', 'Vid frågor, kontakta studion på'
  ),
  (
    'customer_reminder', 'sv', 'Påminnelse inför din bokning',
    'Din tid hos {barber_name} är i morgon.', 'Vi ses i morgon',
    E'Hej {customer_name},\nDetta är en påminnelse om din bokade tid i morgon.',
    'Din bokade tid', 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor 24h.',
    'Mina bokningar', 'Om du har frågor, kontakta oss på'
  ),
  (
    'customer_reminder', 'en', 'Appointment reminder',
    'Your appointment with {barber_name} is tomorrow.', 'See you tomorrow',
    E'Hi {customer_name},\nThis is a reminder about your appointment tomorrow.',
    'Your appointment', 'Need to cancel? Open "My appointments". Cancellation policy: 24 hours.',
    'My appointments', 'Questions? Call us on'
  ),
  (
    'auth_recovery', 'sv', 'Återställ lösenord',
    'Välj ett nytt lösenord till ditt konto.', 'Återställ ditt lösenord',
    'Vi har fått en begäran om att återställa lösenordet för ditt konto.',
    null, 'Länken gäller i 60 minuter. Om du inte begärde återställningen kan du ignorera mejlet.',
    'Välj nytt lösenord', 'Behöver du hjälp? Kontakta oss på'
  ),
  (
    'auth_recovery', 'en', 'Reset password',
    'Choose a new password for your account.', 'Reset your password',
    'We received a request to reset the password for your account.',
    null, 'The link is valid for 60 minutes. Ignore this email if you did not request the reset.',
    'Choose new password', 'Need help? Call us on'
  ),
  (
    'auth_email_change', 'sv', 'Bekräfta ny e-postadress',
    'Bekräfta din nya e-postadress.', 'Bekräfta din nya e-postadress',
    'Bekräfta {new_email} som ny e-postadress för ditt konto.',
    null, 'Länken gäller i 60 minuter och kan bara användas en gång. Ignorera mejlet om du inte begärde ändringen.',
    'Bekräfta e-postadress', 'Behöver du hjälp? Kontakta oss på'
  ),
  (
    'auth_email_change', 'en', 'Confirm new email address',
    'Confirm your new email address.', 'Confirm your new email address',
    'Confirm {new_email} as the new email address for your account.',
    null, 'The link is valid for 60 minutes and can only be used once. Ignore this email if you did not request the change.',
    'Confirm email address', 'Need help? Call us on'
  );

create or replace function public.email_template_for_delivery(
  p_template text,
  p_lang text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.to_jsonb(t) - 'updated_at'
  from public.email_templates t
  where t.template = p_template
    and t.lang = p_lang;
$$;

revoke execute on function public.email_template_for_delivery(text, text)
from public, anon, authenticated;
grant execute on function public.email_template_for_delivery(text, text) to service_role;

-- Custom recovery/email-change senders use admin.generateLink(), which bypasses normal end-user
-- mail rate limits. This ledger restores a strict one-message-per-minute limit without storing raw
-- email addresses or IP addresses.
create table public.auth_email_rate_limits (
  kind         text not null check (kind in ('recovery', 'email_change')),
  scope_hash   text not null check (char_length(scope_hash) = 64),
  last_sent_at timestamptz not null default pg_catalog.now(),
  primary key (kind, scope_hash)
);

alter table public.auth_email_rate_limits enable row level security;
revoke all on public.auth_email_rate_limits from anon, authenticated;

create or replace function public.consume_auth_email_send(
  p_kind text,
  p_scope_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if p_kind not in ('recovery', 'email_change') or char_length(p_scope_hash) <> 64 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_kind || ':' || p_scope_hash));

  select r.last_sent_at into v_last
  from public.auth_email_rate_limits r
  where r.kind = p_kind and r.scope_hash = p_scope_hash;

  if v_last is not null and v_last > pg_catalog.now() - interval '1 minute' then
    return false;
  end if;

  insert into public.auth_email_rate_limits (kind, scope_hash, last_sent_at)
  values (p_kind, p_scope_hash, pg_catalog.now())
  on conflict (kind, scope_hash) do update set last_sent_at = excluded.last_sent_at;

  return true;
end;
$$;

revoke execute on function public.consume_auth_email_send(text, text)
from public, anon, authenticated;
grant execute on function public.consume_auth_email_send(text, text) to service_role;
