# send-confirmation (Edge Function)

Sends a booking confirmation **SMS** to the customer. Email is removed (PLAN §1) — every booking is
`method='sms'`. The function builds a localized message from the **DB-authoritative** booking row and
hands it to an iPhone through a **Pushcut** webhook (PLAN §4 — the user's chosen SMS path).

With **no `PUSHCUT_WEBHOOK_URL` set** it validates, logs, and returns
`{ ok: true, skipped: "no_pushcut_configured" }` (HTTP 200) — no message is sent. So the DB webhook can
be wired before the iPhone bridge exists, without retry storms.

Triggered by a **Database Webhook** on `bookings` **INSERT** — fire-and-forget, server→server, so it
receives no Supabase user JWT (`verify_jwt = false` in `supabase/config.toml`).

---

## 1. Payload shape

Accepts either a Database Webhook envelope (`{ type, table, record, ... }`, it reads `record`) or a
bare booking object (for manual `curl` tests). **Only `id` is required from the payload** — the phone
and every field used to build the message are re-read from the DB by `id`:

```jsonc
{ "id": "uuid" }            // envelope: { "record": { "id": "uuid", ... } }
```

Invalid shapes → `400 { ok: false, error: "invalid_payload", detail: "<why>" }`.

> **Recipient + content are DB-authoritative (M3).** The function re-reads `phone, customer_name,
> start_at, service_name, barber_id, lang` from the `bookings` row (service-role) and the barber's
> display name from `barbers`. The posted body is **never** used as the send target or message source,
> so a forged webhook payload can neither redirect the SMS nor rewrite it.

---

## 2. Local testing

```bash
npx supabase start                      # boots the stack (Docker)
# WEBHOOK_SECRET is REQUIRED (fail-closed). For local serve, put it in supabase/functions/.env:
echo 'WEBHOOK_SECRET=dev-secret' >> supabase/functions/.env
npx supabase functions serve send-confirmation --env-file supabase/functions/.env
# in another shell — send the secret header, and use the id of a booking that EXISTS (the function
# re-reads the recipient + message from that row). <booking-id> = a real public.bookings.id:
curl -i -X POST http://127.0.0.1:54321/functions/v1/send-confirmation \
  -H 'content-type: application/json' -H 'x-webhook-secret: dev-secret' \
  -d '{"id":"<booking-id>"}'
# -> 200 { "ok": true, "skipped": "no_pushcut_configured" }   (no PUSHCUT_WEBHOOK_URL set)
# Missing/!wrong x-webhook-secret -> 401; WEBHOOK_SECRET unset -> 503; unknown booking id -> 404.
```

---

## 3. The SMS bridge (iPhone + Pushcut)

The flow:

```
bookings INSERT
  └─ Supabase Database Webhook  ──POST { id }──▶  send-confirmation
        └─ builds { phone, message }  ──POST──▶  Pushcut webhook URL
              └─ Pushcut notification on the iPhone
                    └─ a Pushcut/Shortcuts automation opens Messages with `phone` + `message`
```

Set up:

1. Install **Pushcut** on the iPhone. Create a **Webhook** (Pushcut → *Account → Webhooks*) — copy its
   URL. It receives the JSON this function POSTs: `{ phone, message, title, text }`.
2. Make the webhook trigger a **Notification** whose action runs a **Shortcut**. The Shortcut takes the
   webhook's `phone` + `message` and runs **Send Message** (Messages) to that recipient with that body.
3. Set the URL as a secret so the function starts sending:
   `npx supabase secrets set PUSHCUT_WEBHOOK_URL=https://api.pushcut.io/<token>/notifications/<name>`
   (locally: add the same line to `supabase/functions/.env`).

### Honest iOS caveat

iOS does **not** allow a Shortcut to send an SMS **fully unattended** in the background — the *Send
Message* step generally needs a **tap to confirm** on the device, and reliable hands-off triggering
usually requires Pushcut's **Automation Server** (or an always-on iPad/Mac). So this bridge **delivers
the ready-to-send message to the phone**; the final send is **semi-automatic** (one tap) unless you run
the Automation Server. It is a low-cost personal bridge, not a carrier-grade SMS gateway — swap
`sendViaPushcut` for a 46elks/Twilio POST if you need fully automated, auditable delivery.

---

## 4. Deploy + wire the Database Webhook

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
4. Set the bridge URL: `npx supabase secrets set PUSHCUT_WEBHOOK_URL=<your-pushcut-webhook>`.

Every new `bookings` INSERT now fires this function, which builds the SMS and pushes it to the iPhone.

---

## 5. Environment variables

| Var | Source | Purpose |
|-----|--------|---------|
| `SUPABASE_URL` | auto-injected | service-role client target |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | re-reads the booking row + barber name |
| `WEBHOOK_SECRET` | `supabase secrets set` | **fail-closed** shared secret (`x-webhook-secret` header) |
| `PUSHCUT_WEBHOOK_URL` | `supabase secrets set` | Pushcut webhook to POST `{ phone, message }`. **Unset → skip.** |
