-- A booking deleted while its email was in flight (a reminder sent, then the booking cancelled and
-- purged) made the log insert fail on the booking foreign key, and the record of a delivered email
-- was dropped. The attempt is now recorded without a booking. The key-share lock is the one the
-- foreign key check takes anyway, taken before the insert, so a delete committing between the
-- lookup and the check cannot fail the insert either.
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
declare
  v_booking_id uuid;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.id = p_booking_id
  for key share;

  insert into public.email_send_log as l (
    dedupe_key, kind, recipient, subject, html, text_body, status, error_code, booking_id
  )
  values (
    p_dedupe_key, p_kind, p_recipient, p_subject, p_html, p_text_body, p_status, p_error_code,
    v_booking_id
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
