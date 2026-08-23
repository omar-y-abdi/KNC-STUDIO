create or replace function public.fail_booking_email_delivery(
  p_id uuid,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in (
    'not_configured',
    'message_build_failed',
    'send_failed',
    'send_failed_transient',
    'send_failed_permanent'
  ) then
    return false;
  end if;

  update public.booking_email_delivery_jobs j
  set status = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          then 'failed'
        when j.attempt_count >= 5 then 'failed'
        else 'pending'
      end,
      next_attempt_at = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          or j.attempt_count >= 5 then j.next_attempt_at
        else pg_catalog.now() + pg_catalog.make_interval(
          secs => least(
            3600,
            (60 * pg_catalog.power(2, least(greatest(j.attempt_count - 1, 0), 6)))::integer
          )
        )
      end,
      failed_at = case
        when p_error_code in ('not_configured', 'message_build_failed', 'send_failed_permanent')
          or j.attempt_count >= 5 then pg_catalog.now()
        else null
      end,
      last_error_code = p_error_code
  where j.id = p_id
    and j.status = 'dispatching';

  return found;
end;
$$;
