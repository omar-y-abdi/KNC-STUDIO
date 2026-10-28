# Email delivery

The owner sees every transactional email in the CMS Studio under **Mejl → Leveransstatus**: failed booking emails first, then the log of sent and failed emails. Only the owner can open the Studio, and the database functions behind the view check `is_owner()` again. Barbers and customers have no access.

## Delivery log

`public.email_send_log` holds one row per email the Edge Functions hand to Resend:

| Kind                                             | Sent by                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `customer_confirmation`, `barber_confirmation`   | `send-confirmation` (booking confirmed)   |
| `customer_cancellation`, `barber_cancellation`   | `send-confirmation` (booking cancelled)   |
| `customer_reminder`                              | `send-confirmation` (reminder sweep)      |
| `auth_recovery`                                  | `send-recovery-email`                     |
| `auth_email_change`                              | `send-email-change`                       |
| `auth_invite`                                    | `admin-create-barber`                     |
| `customer_booking_access`, `customer_email_link` | `external-cleanup` (customer link outbox) |

Each row stores the time, kind, recipient address, subject, status (`sent` or `failed` with `send_failed_transient` or `send_failed_permanent`), the booking when there is one, and a copy of the email as sent (subject, HTML and text part).

- **Credential links are never stored.** Password recovery, email change, invite, Mina bokningar (booking confirmation, reminder, access email) and the customer email-link proof all carry a working login or access key in their button link. The stored copy is rendered by the same renderer with that link replaced by `[dold länk]`; everything else is identical to what the recipient got. The message's idempotency key is stored only as its SHA-256 (`dedupe_key`), because auth keys embed part of the token.
- **One row per email.** Retries of the same email update its row (latest status, `attempt_count`, `last_attempt_at`). A row that reached `sent` stays `sent`.
- **What is not in the log.** Emails that never reached Resend (missing configuration, a message that could not be built) have no row. For booking emails they appear in the failed list below. Emails Supabase Auth sends itself are not logged either: Auth delivers them over its own SMTP settings (`[auth.email.smtp]` in `supabase/config.toml`) with no send-email hook, so a recovery or email-change email triggered outside the app, from the Supabase dashboard or by a direct call to the Auth API such as `/auth/v1/recover`, never passes the Edge Functions (the app's own recovery, email-change and invite flows use `generateLink` and are logged).
- **Retention.** The daily cron job `email-send-log-purge` (03:29 UTC) deletes rows older than 30 days. Deleting a booking keeps its rows until then, with `booking_id` cleared; an email whose booking was deleted while it was being sent is recorded without a booking.
- **Logging.** A failed log write is reported in the Edge Function log as `email send log write failed` with the kind and a database error code only; a write still pending after 3 seconds is dropped and reported with the code `timeout`. It never fails the email, and holds up the send for at most those 3 seconds. Console logs never contain recipients, subjects or bodies.

Read the log in the SQL editor:

```sql
select l.created_at, l.kind, l.recipient, l.subject, l.status, l.error_code, l.attempt_count
from public.email_send_log l
order by l.created_at desc, l.id desc
limit 50;
```

The owner RPCs are `admin_list_email_send_log(p_before, p_limit, p_before_id)` (newest first, no bodies, at most 100 rows per page, `has_more`; the cursor is the last entry's `created_at` passed back verbatim plus its `id`) and `admin_get_email_send_log_entry(p_id)` (one stored copy, `null` once purged). Only the Edge Functions' service role can write through `internal_record_email_send`.

## Failed booking emails

`booking_email_delivery_jobs` stays the source of truth for booking emails and their retries; the log only records what was sent. Leveransstatus lists failed deliveries with the customer, the booking time and the recipients, and offers retry and mark handled.

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

1. Migrations `20261025090000_email_send_log.sql` and `20261025091000_email_send_log_deleted_booking.sql`. `admin_list_failed_booking_email_deliveries` only gains keys (`customer_name`, `customer_email`, `customer_phone`, `booking_start_at`, `barber_name`, `barber_email`, `sent_kinds`); the deployed frontend ignores unknown keys.
2. Edge Functions `send-confirmation`, `send-recovery-email`, `send-email-change`, `admin-create-barber` and `external-cleanup`. They call `internal_record_email_send`, so the migration must be applied first; before it is, every send still succeeds and logs `email send log write failed`.
3. The frontend with Leveransstatus.
