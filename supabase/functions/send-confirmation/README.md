# send-confirmation (Edge Function)

Notifies the salon's iPhone on every new booking so it can text the customer **and** the barber —
**two SMS**. The function does **not** compose any message text. It re-reads the booking from the
**DB-authoritative** row and emails a **structured, raw-field JSON payload** via **Resend**. An iOS
**Shortcut** watching that mailbox parses the JSON and composes + sends both SMS on-device, so all
message wording lives in the Shortcut (copy changes never require a redeploy).

```
bookings INSERT
  └─ Supabase Database Webhook  ──POST { id }──▶  send-confirmation
        └─ re-reads the row, builds raw fields  ──Resend email (JSON body)──▶  NOTIFY_EMAIL
              └─ iPhone Mail automation triggers a Shortcut
                    └─ "Get Dictionary from Input" → composes + sends 2× SMS (customer + barber)
```

With **no `RESEND_API_KEY` set** (or no `NOTIFY_EMAIL`) it validates, logs, and returns
`{ ok: true, skipped: "no_resend_configured" }` (HTTP 200) — no email is sent. So the DB webhook can
be wired before the mail bridge exists, without retry storms.

Triggered by a **Database Webhook** on `bookings` **INSERT** — fire-and-forget, server→server, so it
receives no Supabase user JWT (`verify_jwt = false` in `supabase/config.toml`).

---

## 1. Inbound payload (from the webhook)

Accepts either a Database Webhook envelope (`{ type, table, record, ... }`, it reads `record`) or a
bare booking object (for manual `curl` tests). **Only `id` is required from the payload** — the phone
and every field below are re-read from the DB by `id`:

```jsonc
{ "id": "uuid" } // envelope: { "record": { "id": "uuid", ... } }
```

Invalid shapes → `400 { ok: false, error: "invalid_payload", detail: "<why>" }`.

> **Recipient + content are DB-authoritative (M3).** The function re-reads `phone, customer_name,
start_at, service_name, barber_name, lang` from the `bookings` row via the
> `booking_confirmation_details` RPC (service-role). The posted body is **never** used as a field
> source, so a forged webhook payload can neither redirect the SMS nor rewrite it.

---

## 2. Outbound payload (the raw fields the Shortcut composes from)

The email **TEXT body** is `JSON.stringify(payload)` — raw fields only, **no pre-built sentence**:

```jsonc
{
  "name": "Anna Andersson", // customer_name (full)
  "phone": "0701234567", // SMS recipient (customer)
  "barber": "Hassan", // barber display name
  "service": "Klippning", // service_name
  "date": "måndag 29 juni", // Stockholm date, localized by lang (en → "Monday 29 June")
  "time": "11:00", // Stockholm wall-clock HH:MM
  "lang": "sv", // "sv" | "en" — lets the Shortcut localize each SMS
}
```

Only `date`/`time` are derived here, formatted as **Stockholm** wall-clock (DST-safe via `Intl` +
`timeZone: "Europe/Stockholm"`). Everything else is passed through verbatim from the DB row. The
Shortcut composes the two messages (e.g. a confirmation to `phone`, a heads-up to the barber) however
the salon wants — this function never dictates wording.

The email itself:

| Field     | Value                                       |
| --------- | ------------------------------------------- |
| `from`    | `knc-studio@resend.dev`                     |
| `to`      | `[NOTIFY_EMAIL]`                            |
| `subject` | `Ny bokning - KNC Studio`                   |
| `text`    | `JSON.stringify(payload)` (the table above) |

---

## 3. Local testing

```bash
npx supabase start                      # boots the stack (Docker)
# WEBHOOK_SECRET is REQUIRED (fail-closed). For local serve, put it in supabase/functions/.env:
echo 'WEBHOOK_SECRET=dev-secret' >> supabase/functions/.env
npx supabase functions serve send-confirmation --env-file supabase/functions/.env
# in another shell — send the secret header, and use the id of a booking that EXISTS (the function
# re-reads the recipient + fields from that row). <booking-id> = a real public.bookings.id:
curl -i -X POST http://127.0.0.1:54321/functions/v1/send-confirmation \
  -H 'content-type: application/json' -H 'x-webhook-secret: dev-secret' \
  -d '{"id":"<booking-id>"}'
# -> 200 { "ok": true, "skipped": "no_resend_configured" }   (no RESEND_API_KEY in the local .env)
# Missing/wrong x-webhook-secret -> 401; WEBHOOK_SECRET unset -> 503; unknown booking id -> 404.
```

> **Heads-up:** if you add a real `RESEND_API_KEY` + `NOTIFY_EMAIL` to the local `.env`, the curl
> above sends a **real email**. Leave them unset locally to exercise the skip path without sending.

---

## 4. The SMS bridge (Resend → iPhone Shortcut → 2 SMS)

Set up:

1. **Resend:** verify a sender/domain (the default `knc-studio@resend.dev` works for testing) and
   create an API key. Set it as a secret: `npx supabase secrets set RESEND_API_KEY=re_...`, and set
   the destination mailbox `npx supabase secrets set NOTIFY_EMAIL=you@icloud.com` (the iPhone's
   Mail account).
2. **iPhone:** a Mail/Shortcuts **automation** triggers when an email from `knc-studio@resend.dev`
   with subject `Ny bokning - KNC Studio` arrives. The Shortcut runs **Get Dictionary from Input** on
   the email body to parse the JSON, then composes and runs **Send Message** (Messages) twice — once
   to the customer's `phone`, once to the barber — using `name/barber/service/date/time/lang`.

### Honest iOS caveat

iOS does **not** allow a Shortcut to send an SMS **fully unattended** in the background — the _Send
Message_ step generally needs a **tap to confirm** on the device, and reliable hands-off triggering
usually requires an always-on device. So this bridge **delivers the ready-to-compose fields to the
phone**; the final send is **semi-automatic** (a tap per SMS). It is a low-cost personal bridge, not a
carrier-grade SMS gateway — swap `sendViaResend` for a 46elks/Twilio POST if you need fully automated,
auditable delivery.

---

## 5. Deploy + wire the Database Webhook

The webhook needs the **deployed** function URL, so this is a post-deploy step (NOT auto-created here).

1. Deploy: `npx supabase functions deploy send-confirmation`.
   - URL: `https://<project-ref>.supabase.co/functions/v1/send-confirmation`.
2. Dashboard → **Database → Webhooks → Create a new hook**:
   - Table: `public.bookings`, Events: **Insert**.
   - Type: **Supabase Edge Functions** → select `send-confirmation` (or HTTP Request → the URL).
   - Method: `POST`.
3. **Secure it (REQUIRED — fail-closed).** The function returns `503 not_configured` until
   `WEBHOOK_SECRET` is set, then requires a matching `x-webhook-secret` header (else `401`). BEFORE
   anything else: `npx supabase secrets set WEBHOOK_SECRET=<random>`, then add a custom header
   `x-webhook-secret: <same-value>` in the webhook config.
4. Set the bridge secrets: `npx supabase secrets set RESEND_API_KEY=re_...` and
   `npx supabase secrets set NOTIFY_EMAIL=<iphone-mailbox>`.

Every new `bookings` INSERT now fires this function, which emails the raw payload to the iPhone, where
the Shortcut composes and sends the two SMS.

---

## 6. Environment variables

| Var                         | Source                 | Purpose                                                     |
| --------------------------- | ---------------------- | ----------------------------------------------------------- |
| `SUPABASE_URL`              | auto-injected          | service-role client target                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected          | re-reads the booking row via `booking_confirmation_details` |
| `WEBHOOK_SECRET`            | `supabase secrets set` | **fail-closed** shared secret (`x-webhook-secret` header)   |
| `RESEND_API_KEY`            | `supabase secrets set` | Resend API key (`Authorization: Bearer`). **Unset → skip.** |
| `NOTIFY_EMAIL`              | `supabase secrets set` | destination mailbox the iPhone watches. **Unset → skip.**   |
