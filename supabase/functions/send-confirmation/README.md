# `send-confirmation`

Booking email function. Booking inserts and cancellations persist a delivery job in
`booking_email_delivery_jobs`; a one-minute `pg_cron` dispatcher invokes this function with only the
job ID. The function re-reads recipients and message fields through service-role-only RPCs.

## Recipients

- customer: email stored on booking
- barber: Supabase Auth email linked through `profiles.barber_id`

Missing barber login means customer email still sends. Resend calls use deterministic idempotency keys
per booking and recipient, preventing duplicate email during delivery retries.

## Reliability

- booking confirmation and cancellation jobs are committed with the booking transaction before any
  network request is attempted
- a job durably records every recipient that has sent; retries send only remaining recipients, even
  after Resend's 24-hour idempotency-key window expires
- failed jobs retry with capped exponential backoff; a dispatcher invocation lost before reaching the
  Edge Function is reclaimed after five minutes
- missing Resend configuration returns `503` and requeues the job; it never reports a skipped success
- one-day reminders keep their existing durable `booking_reminders` retry ledger and use the same
  Resend idempotency keys

The job ledger keeps only booking UUIDs, event/status, attempt timing, and short error codes. It does
not store email addresses, phone numbers, message content, provider responses, or tokens. Terminal
rows are retained for 90 days then removed by `booking-email-delivery-cleanup`.

## Security

Request must include `x-webhook-secret` matching `WEBHOOK_SECRET`. Missing or wrong secret fails
closed. Database Vault stores matching `booking_webhook_secret` plus `booking_confirmation_url`; secret
values never live in migration SQL.

Required function secrets:

```bash
npx supabase secrets set \
  RESEND_API_KEY=<active-resend-api-key> \
  WEBHOOK_SECRET=<random-long-value>
```

Set the same random value in Database Vault as `booking_webhook_secret`; that existing Vault key is
what the booking trigger reads when it sends `x-webhook-secret`. Calendar sync uses the same
`WEBHOOK_SECRET` Edge Function secret.

Verified sender domain must permit:

- `Blade & Blend Studio <booking@mail.bladeblendstudio.se>`

## Deploy

```bash
npx supabase functions deploy send-confirmation --use-api
```

After deployment, create one test booking using a real test email. Verify one customer email and one
linked-barber email, then remove test booking. In SQL Editor, confirm the related job reaches
`delivered`; temporarily removing `RESEND_API_KEY` must leave a job `pending` with
`last_error_code = 'not_configured'` instead of losing it.
