# `send-confirmation`

Booking email function. Database insert trigger calls it asynchronously. Request supplies only booking
ID; function re-reads recipients and message fields through service-role-only
`booking_confirmation_details`.

## Recipients

- customer: email stored on booking
- barber: Supabase Auth email linked through `profiles.barber_id`

Missing barber login means customer email still sends. Resend calls use deterministic idempotency keys
per booking and recipient, preventing duplicate email during trigger retries.

## Security

Request must include `x-webhook-secret` matching `BOOKING_WEBHOOK_SECRET`. Missing or wrong secret fails
closed. Database Vault stores matching `booking_webhook_secret` plus `booking_confirmation_url`; secret
values never live in migration SQL.

Required function secrets:

```bash
npx supabase secrets set \
  RESEND_API_KEY=<active-resend-api-key> \
  BOOKING_WEBHOOK_SECRET=<random-long-value>
```

Verified sender domain must permit:

- `Blade & Blend Studio <no-reply@bladeblendstudio.se>`

## Deploy

```bash
npx supabase functions deploy send-confirmation --use-api
```

After deployment, create one test booking using a real test email. Verify one customer email and one
linked-barber email, then remove test booking.
