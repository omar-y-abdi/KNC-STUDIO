# send-confirmation (Edge Function)

Sends a booking confirmation to the customer over their chosen channel — **SMS** (46elks or Twilio)
or **email** (Resend). It is a **skeleton**: with no provider key set it validates the payload, logs,
and returns `{ ok: true, skipped: "no_provider_configured" }` (HTTP 200). No message is sent yet.

It is designed to be triggered by a **Database Webhook** on `bookings` **INSERT** — fire-and-forget,
server→server, so it receives no Supabase user JWT (`verify_jwt = false` in `supabase/config.toml`).

---

## 1. Payload shape

The handler accepts either a Database Webhook envelope (`{ type, table, record, ... }`, it reads
`record`) or a bare booking object (handy for manual `curl` tests). The booking it needs:

```jsonc
{
  "id": "uuid",
  "method": "sms" | "email",
  "phone": "07XXXXXXXX" | null,   // required when method = "sms"
  "email": "a@b.se"   | null,     // required when method = "email"
  "start_at": "2026-07-01T09:00:00+02:00",
  "barber_id": "hassan" | "victor" | "salman",
  "service_name": "Hår & Skägg"
}
```

Invalid shapes → `400 { ok: false, error: "invalid_payload", detail: "<why>" }`.

> Note: the `bookings` row also has `customer_name`, `lang`, etc. The webhook posts the **whole**
> row in `record`; the handler simply ignores the extra fields. When you implement the provider
> send, pull `lang` from `record` too if you want a localized message.

---

## 2. Local testing

```bash
npx supabase start                      # boots the stack (Docker)
# WEBHOOK_SECRET is REQUIRED (fail-closed). For local serve, put it in supabase/functions/.env:
echo 'WEBHOOK_SECRET=dev-secret' >> supabase/functions/.env
npx supabase functions serve send-confirmation --env-file supabase/functions/.env
# in another shell — send the secret header, and use the id of a booking that EXISTS (the function
# re-reads the recipient from that row). <booking-id> = a real public.bookings.id:
curl -i -X POST http://127.0.0.1:54321/functions/v1/send-confirmation \
  -H 'content-type: application/json' -H 'x-webhook-secret: dev-secret' \
  -d '{"id":"<booking-id>","method":"email","email":"ignored@example.com","phone":null,"start_at":"2026-07-01T09:00:00+02:00","barber_id":"hassan","service_name":"Hår & Skägg"}'
# -> 200 { "ok": true, "skipped": "no_provider_configured" }   (no provider key set)
# Missing/!wrong x-webhook-secret -> 401; WEBHOOK_SECRET unset -> 503; unknown booking id -> 404.
```

---

## 3. Where to add the provider key

Keys are **secrets** — never commit them. Set them on the deployed project:

```bash
# Email (Resend):
npx supabase secrets set RESEND_API_KEY=re_xxx
# SMS (46elks):
npx supabase secrets set ELKS_API_USERNAME=uXXX ELKS_API_PASSWORD=XXXX
#   (Twilio alternative: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)
```

Then implement the two `TODO(...)` call sites in `index.ts`:

- **email** → `RESEND_API_KEY` → `POST https://api.resend.com/emails`
  (docs: <https://resend.com/docs/api-reference/emails/send-email>).
- **sms** → `ELKS_API_USERNAME` / `ELKS_API_PASSWORD` → `POST https://api.46elks.com/a1/sms`
  (docs: <https://46elks.com/docs/send-sms>).

Locally, put the same vars in `supabase/functions/.env` (gitignored) and pass
`--env-file supabase/functions/.env` to `functions serve`.

---

## 4. Deploy + wire the Database Webhook

The webhook needs the **deployed** function URL + the **service role** key, so this is a
post-deploy step (NOT auto-created by this repo).

1. Deploy: `npx supabase functions deploy send-confirmation`.
   - The URL is `https://<project-ref>.supabase.co/functions/v1/send-confirmation`.
2. In the dashboard → **Database → Webhooks → Create a new hook**:
   - Table: `public.bookings`, Events: **Insert**.
   - Type: **Supabase Edge Functions** → select `send-confirmation` (or HTTP Request → the URL).
   - Method: `POST`. The webhook auto-attaches the project's auth header.
3. **Secure it (REQUIRED — fail-closed).** The function rejects **every** request with
   `503 not_configured` until `WEBHOOK_SECRET` is set, and then requires a matching `x-webhook-secret`
   header (else `401 unauthorized`). This is enforced in code (no TODO to uncomment), so the function
   can never be an open relay. BEFORE configuring any provider key:
   `npx supabase secrets set WEBHOOK_SECRET=<random-value>`, then add a custom header
   `x-webhook-secret: <same-value>` in the webhook config.

That's it: every new `bookings` INSERT now fires this function, which sends the confirmation.

> **Recipient is DB-authoritative.** The function re-reads the customer's phone/email from the
> `bookings` row by `id` (service-role) and sends ONLY there — the posted `phone`/`email` are validated
> for shape but never used as the send target, so a forged webhook payload cannot redirect the message.
