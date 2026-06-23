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
npx supabase functions serve send-confirmation
# in another shell:
curl -i -X POST http://127.0.0.1:54321/functions/v1/send-confirmation \
  -H 'content-type: application/json' \
  -d '{"id":"00000000-0000-0000-0000-000000000001","method":"email","email":"test@example.com","phone":null,"start_at":"2026-07-01T09:00:00+02:00","barber_id":"hassan","service_name":"Hår & Skägg"}'
# -> 200 { "ok": true, "skipped": "no_provider_configured" }
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
3. **Secure it** (recommended): add a custom header `x-webhook-secret: <value>` in the webhook
   config, store it via `npx supabase secrets set WEBHOOK_SECRET=<value>`, and uncomment the
   `TODO(security)` check in `index.ts` so the function rejects requests without the header.

That's it: every new `bookings` INSERT now fires this function, which sends the confirmation.
