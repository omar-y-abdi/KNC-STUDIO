# Google Calendar-sync — setup

Per-barber Google Calendar push. A barber taps **Koppla kalender** in "Mina bokningar"; their future
bookings are pushed as events into their Google Calendar and kept in sync in near-real-time. The
Google Calendar app (iOS **and** Android) delivers the notification — Apple Calendar has no push API, so
an iPhone barber uses the Google Calendar app too.

Pieces:

| Edge function             | Trigger                                | verify_jwt | Auth                       |
| ------------------------- | -------------------------------------- | ---------- | -------------------------- |
| `calendar-oauth-start`    | barber taps Koppla (app → invoke)      | true       | JWT → `profiles.barber_id` |
| `calendar-oauth-callback` | Google redirect (top-level)            | false      | HMAC-signed `state`        |
| `calendar-sync`           | bookings INSERT/UPDATE/DELETE webhook  | false      | `WEBHOOK_SECRET` header    |
| `calendar-disconnect`     | barber taps Koppla loss (app → invoke) | true       | JWT → `profiles.barber_id` |

The Google **refresh token is a credential**: it lives in `public.barber_calendar_tokens` (RLS on, no
anon/authenticated policies) and is reachable only by `service_role` through the definer RPCs in
`migrations/20260724170000_calendar_sync.sql`. The browser never sees it.

---

## 1. Google Cloud console (OAuth client — you already created the Web client)

**Authorised redirect URIs** — add exactly (replace `<PROJECT_REF>` with your project ref):

```
https://<PROJECT_REF>.supabase.co/functions/v1/calendar-oauth-callback
```

**Authorised JavaScript origins** — leave empty (this is a server-side authorization-code flow; JS
origins are only needed for a browser token flow, which we don't use).

**OAuth consent screen — scopes:** `openid`, `email`, and
`https://www.googleapis.com/auth/calendar.events.owned` (the last is a _sensitive_ scope). This
limits the connection to calendars owned by the barber.

**Publishing status — pick ONE (this is the only real dependency):**

- **A — Internal (best, if you have a Google Workspace domain):** set User type = _Internal_. No
  verification, refresh tokens never expire. Requires every barber to be a user in that Workspace.
- **B — External / consumer Gmail:** to get durable tokens you must publish the app **In production**
  and pass Google verification for `calendar.events.owned` (privacy-policy URL + brand review;
  days–weeks).
  In **Testing** status everything works immediately, BUT **refresh tokens expire after 7 days** — a
  barber would have to re-tap Koppla kalender weekly. Fine for a pilot, not for production.

## 2. Supabase secrets

```bash
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="<client id>" \
  GOOGLE_OAUTH_CLIENT_SECRET="<client secret>" \
  CALENDAR_STATE_SECRET="$(openssl rand -hex 32)"
# WEBHOOK_SECRET is already set (used by send-confirmation); calendar-sync reuses it.
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. **Never** put the client
secret or service-role key in the frontend / a `VITE_` var / chat.

## 3. Deploy

```bash
supabase db push                       # applies 20260724170000_calendar_sync.sql
supabase functions deploy calendar-oauth-start calendar-oauth-callback calendar-sync calendar-disconnect
```

## 4. Database Webhook (same recipe as send-confirmation)

Dashboard → Database → Webhooks → **Create**:

- Table: `public.bookings`
- Events: **Insert, Update, Delete**
- Type: **Supabase Edge Function** → `calendar-sync`
- HTTP header: `x-webhook-secret: <the WEBHOOK_SECRET value>`

`calendar-sync` re-reads every booking field from the DB by id (the webhook body is untrusted) and is
fail-closed: with no/incorrect `x-webhook-secret` it does nothing.

---

## Notes / limits

- **Notification timing:** the event carries a 30-min popup reminder; the "new booking" ding depends on
  the barber enabling notifications in the Google Calendar app. A guaranteed instant push (web/PWA) can
  be added later.
- **Backfill** runs inside the callback right after connect for confirmed future bookings only. This
  bounds the work and avoids creating historical calendar noise.
- **Cancellation, hard deletion, and disconnect** queue external event deletions in the durable action
  ledger. The mapping and event identifier remain until Google deletion succeeds, then credentials are
  revoked and removed after a disconnect queue drains. A retryable failure cannot silently orphan a
  Calendar event.
