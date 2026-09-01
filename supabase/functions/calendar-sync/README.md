# Google Calendar-sync — setup

Per-barber Google Calendar push. A barber taps **Koppla kalender** in "Mina bokningar"; confirmed
bookings are mirrored into the barber's Google Calendar.

## Durability model

Calendar correctness does **not** depend on Database Webhook delivery. The booking transaction itself
queues a `calendar_event_sync` row in `public.external_action_jobs` whenever a confirmed booking is
created or its Calendar-relevant fields change. The external-action dispatcher claims that row,
resolves the current booking and OAuth credential server-side, then patches or inserts Google
Calendar idempotently. Transient failures back off and retry; a later booking change re-queues a
blocked or stale sync with current data.

Cancellation, hard deletion and disconnect use the same durable ledger for Google event deletion.
`calendar_record_event` re-checks booking status after the Google write, so a sync racing a
cancellation immediately queues cleanup rather than orphaning the event.

`calendar-sync` remains as a compatibility endpoint for an already-configured Supabase Database
Webhook. It only re-queues the same deduplicated action and never calls Google directly. The webhook
must remain until the merged durable path is verified and the owner coordinates external webhook and
shared-secret maintenance; only then may it be removed.

## Components

- `calendar-oauth-start`: barber connect action; authenticated by JWT and `profiles.barber_id`.
- `calendar-oauth-callback`: Google redirect; authenticated by HMAC-signed OAuth `state`.
- Booking DB trigger: confirmed booking insert/update; queues work inside the database transaction.
- `external-cleanup`: durable outbox dispatcher; authenticated by `WEBHOOK_SECRET`.
- `calendar-sync`: optional legacy Database Webhook compatibility endpoint; authenticated by
  `WEBHOOK_SECRET`.
- `calendar-disconnect`: barber disconnect action; authenticated by JWT and `profiles.barber_id`.

The Google refresh token is a credential. It stays in `public.barber_calendar_tokens` behind RLS and
service-role-only definer RPCs; the browser never receives it.

## Google Cloud

Authorised redirect URI:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/calendar-oauth-callback
```

Leave Authorised JavaScript origins empty. Configure `openid`, `email`, and exactly:

```text
https://www.googleapis.com/auth/calendar.events.owned
```

For consumer Gmail accounts the OAuth app must be **In production** and verified for this sensitive
scope before launch. Testing-mode refresh tokens expire after seven days.

## Secrets

```bash
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="<client id>" \
  GOOGLE_OAUTH_CLIENT_SECRET="<client secret>" \
  CALENDAR_STATE_SECRET="$(openssl rand -hex 32)"
```

`WEBHOOK_SECRET` is also required by `external-cleanup`, and by `calendar-sync` only while the
compatibility webhook remains. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by
Supabase.

## Deploy

Use `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` for production database rollout. Do **not**
replace its expand → Edge → frontend → verify → contract sequence with an unrestricted
`supabase db push`.

During the Edge Function phase deploy the Calendar surface and durable worker:

```bash
supabase functions deploy \
  calendar-oauth-start calendar-oauth-callback calendar-disconnect \
  external-cleanup calendar-sync
```

After deployment, verify that the external-action cron drains `calendar_event_sync` jobs and that a
real create/update/cancel cycle reaches Google. An existing `public.bookings` Database Webhook may
remain during rollout, but it is no longer required for correctness. Do not remove it from the
Dashboard until the merged durable path is verified and the coordinated external maintenance is
complete.

## Notes

- Events use a deterministic booking-derived Google event id, making retried inserts idempotent.
- The event carries a 30-minute popup reminder; device notification behavior still depends on the
  barber's Google Calendar settings.
- OAuth callback backfill covers confirmed future bookings (those with end time after now) that
  predate connection.
- Revoked Google grants block affected Calendar jobs for explicit same-account reauthorization
  instead of discarding the durable mapping.
