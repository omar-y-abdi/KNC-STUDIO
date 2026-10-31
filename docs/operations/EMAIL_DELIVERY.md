# Email delivery

The owner sees failed booking deliveries and the app's recorded email attempts in the CMS Studio under **Mejl → Leveransstatus**. Only the owner can open the Studio, and the database functions behind the view check `is_owner()` again. Barbers and customers have no access.

## Delivery log

The Edge Functions attempt to write one `public.email_send_log` row per message sent through Resend. Logging is best effort; a missing row does not prove that an email was not sent. These app email kinds are covered:

| Kind                                             | Sent by                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `customer_confirmation`, `barber_confirmation`   | `send-confirmation` (booking confirmed)   |
| `customer_cancellation`, `barber_cancellation`   | `send-confirmation` (booking cancelled)   |
| `customer_reminder`                              | `send-confirmation` (reminder sweep)      |
| `auth_recovery`                                  | `send-recovery-email`                     |
| `auth_email_change`                              | `send-email-change`                       |
| `auth_invite`                                    | `admin-create-barber`                     |
| `customer_booking_access`, `customer_email_link` | `external-cleanup` (customer link outbox) |

Each row stores the time, kind, recipient address, subject, status (`sent` or `failed` with `send_failed_transient` or `send_failed_permanent`), the booking when there is one, and the attempted message's subject, HTML and text part. `sent` means Resend accepted the message and returned a valid message ID; it does not confirm inbox delivery. A transport error or an invalid provider response is recorded as a transient failure even when provider acceptance is uncertain.

- **Credential links are never stored.** Password recovery, email change, invite, Mina bokningar (booking confirmation, reminder, access email) and the customer email-link proof all carry a working login or access key in their button link. The stored copy is rendered by the same renderer with that link replaced by `[dold länk]`; everything else is identical to the outgoing message. The message's idempotency key is stored only as its SHA-256 (`dedupe_key`), because auth keys embed part of the token.
- **One row per email.** While the row is `failed`, a recorded retry replaces the attempted message and outcome, increments `attempt_count`, and updates `last_attempt_at`. `created_at` remains the first recorded attempt. Once a recorded attempt reaches `sent`, the entire row is final: later attempts change neither its copy nor its status, counters or timestamps. Attempts whose log write failed are not counted.
- **What is not in the log.** Failures before the provider call (missing configuration or a message that could not be built) have no row. Terminal booking delivery jobs appear in the failed list below. A failed log write may also leave a provider attempt absent. Emails Supabase Auth sends itself are excluded: Auth delivers them over its own SMTP settings (`[auth.email.smtp]` in `supabase/config.toml`) with no send-email hook, so a recovery or email-change email triggered outside the app, from the Supabase dashboard or by a direct call to the Auth API such as `/auth/v1/recover`, never passes the Edge Functions. The app's own recovery, email-change and invite flows use `generateLink` and the logged sender.
- **Retention.** The daily cron job `email-send-log-purge` (03:29 UTC) deletes rows strictly older than 30 days from their first recorded attempt. A row exactly at the cutoff remains until a later run; the daily cadence can leave an expired row visible until the next purge. Deleting a booking keeps its rows until then, with `booking_id` cleared; an email whose booking was deleted while it was being sent is recorded without a booking.
- **Logging.** A failed log write is reported as `email send log write failed` with the email kind and a database error code or caught exception name. The sender waits up to 3 seconds for the log RPC, then reports `timeout` and continues; the outstanding RPC may still complete later. A logging failure never changes the provider outcome or prevents the booking dispatch from persisting a reached recipient. The log helper never prints recipients, subjects, bodies or credential links.

Read the log in the SQL editor:

```sql
select l.created_at, l.kind, l.recipient, l.subject, l.status, l.error_code, l.attempt_count
from public.email_send_log l
order by l.created_at desc, l.id desc
limit 50;
```

The owner RPCs are `admin_list_email_send_log(p_before, p_limit, p_before_id)` (newest first, no bodies, at most 100 rows per page, `has_more`; the cursor is the last entry's `created_at` passed back verbatim plus its `id`) and `admin_get_email_send_log_entry(p_id)` (one stored copy, `null` once purged). Only the Edge Functions' service role can write through `internal_record_email_send`.

## Failed booking emails

`booking_email_delivery_jobs` stays the source of truth for booking emails and their retries; the log is a record of provider attempts. Leveransstatus lists failed deliveries with the customer, the booking time and the recipients still owed the message, and offers retry and mark handled. Retrying queues another attempt; deletion stays blocked until all unresolved deliveries have completed or been marked handled.

A booking with a `failed`, `pending` or `dispatching` row in `booking_email_delivery_jobs` cannot be deleted, purged or removed with its barber (trigger `bookings_prevent_unresolved_email_delete`).

List failed deliveries (SQL editor):

```sql
select j.id, j.booking_id, j.event, j.attempt_count, j.last_error_code, j.failed_at,
       b.customer_name, b.email, b.phone, b.start_at
from public.booking_email_delivery_jobs j
join public.bookings b on b.id = j.booking_id
where j.status = 'failed'
order by j.failed_at desc, j.created_at desc;
```

The owner RPCs `admin_retry_failed_booking_email_delivery` and `admin_discard_failed_booking_email_delivery` require the owner's session (`is_owner()`), so they cannot be called from the SQL editor. Use Leveransstatus, or run the same updates directly:

```sql
-- retry one delivery
update public.booking_email_delivery_jobs
set status = 'pending', attempt_count = 0, next_attempt_at = now(),
    last_attempt_at = null, last_error_code = null, failed_at = null
where id = '<delivery id>' and status = 'failed';

-- mark one delivery handled (never sent again)
update public.booking_email_delivery_jobs
set status = 'skipped', completed_at = now()
where id = '<delivery id>' and status = 'failed';
```

## Rollout order

1. Migrations `20261028100000_email_send_log.sql` and `20261028101000_email_send_log_deleted_booking.sql`, ordered after the shipped `20261027173553` migration. `admin_list_failed_booking_email_deliveries` only gains keys (`customer_name`, `customer_email`, `customer_phone`, `booking_start_at`, `barber_name`, `barber_email`, `sent_kinds`); the deployed frontend ignores unknown keys.
2. Edge Functions `send-confirmation`, `send-recovery-email`, `send-email-change`, `admin-create-barber` and `external-cleanup`. They call `internal_record_email_send`, so the migrations must be applied first. Before that, sends retain their provider outcome but each attempted log write reports `email send log write failed`.
3. The frontend with Leveransstatus.
