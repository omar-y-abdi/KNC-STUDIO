# `submit-booking`

Public booking gateway. Browser never executes `create_booking` directly.

## Request

```json
{
  "booking": {
    "barberId": "hassan",
    "serviceId": "<service-uuid>",
    "startAt": "2040-03-14T12:30:00.000Z",
    "phone": "0701234567",
    "email": "customer@example.com",
    "lang": "sv",
    "customerName": "Test Kund"
  },
  "turnstileToken": "<single-use-token>"
}
```

`startAt` must come from `localWallClockToStockholmIso(...)`. Service name, price, and duration are
not accepted from browser; database derives them from active service row.

## Security

- Function has `verify_jwt = false` because booking is public.
- Turnstile is fail-closed. Missing `TURNSTILE_SECRET`, missing `IP_SALT`, or empty token cannot create
  production booking.
- IP and phone limits backstop Turnstile.
- Final contracted state grants `create_booking` only to `service_role`. A short rollout expand
  window keeps legacy anonymous clients working; follow
  `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` and contract immediately after verification.

Required secrets:

```bash
npx supabase secrets set TURNSTILE_SECRET=<secret> IP_SALT=<random-long-value>
```

## Responses

Expected business outcomes use HTTP 200 because `supabase-js` converts non-2xx function responses to
transport errors:

- success: `{ "ok": true, "booking": { ... } }`
- rejected: `{ "ok": false, "error": "failed_challenge" | "rate_limited" | "slot_taken" | "outside_hours" | "invalid" | "invalid_time" | "invalid_contact" }`
- malformed request: HTTP 400
- missing server config/unhandled fault: HTTP 500

## Deploy

```bash
npx supabase functions deploy submit-booking --use-api
```
