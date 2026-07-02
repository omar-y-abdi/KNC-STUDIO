# submit-booking (Edge Function)

The public booking **gateway**. The browser (anon) POSTs here instead of calling `create_booking`
directly, so spam protection (Cloudflare Turnstile + per-IP + per-phone backstops) runs **server-side**
before the booking insert. It then calls `create_booking` (9-arg) via the **service_role** key and
returns that RPC's Result **verbatim**.

Browser-invoked, cross-origin → CORS-enabled and `verify_jwt = false` (`supabase/config.toml`).

---

## 1. Payload

```jsonc
{
  "booking": {
    "barberId": "hassan", // 'hassan' | 'victor' | 'salman'
    "serviceId": "h",
    "serviceName": "Hår & Skägg",
    "price": 350, // integer SEK
    "durationMin": 45,
    "startAt": "2040-03-14T12:30:00.000Z", // ISO string, ALREADY Stockholm-correct (PLAN §3 H2)
    "phone": "0701234567", // ^07[0-9]{8}$
    "lang": "sv", // 'sv' | 'en'
    "customerName": "Test Kund",
  },
  "turnstileToken": "...", // optional; "" when the widget is offline/unconfigured
}
```

> **H2 regression guard:** `startAt` must be the **string** produced by
> `localWallClockToStockholmIso(...)` on the client. Do NOT drop a raw `Date` into the body —
> `JSON.stringify` would serialize it in the browser's timezone and re-introduce the H2 bug for
> non-Stockholm visitors.

---

## 2. Responses (HTTP-status discipline)

`functions.invoke` turns any non-2xx into a `FunctionsHttpError` (`data:null`), so **every expected
outcome is HTTP 200** with a Result body the adapter parses:

| HTTP | Body                                                                                                            | When                                  |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 200  | `{ "ok": true, "booking": { … } }`                                                                              | booked                                |
| 200  | `{ "ok": false, "error": "failed_challenge" }`                                                                  | Turnstile rejected the token          |
| 200  | `{ "ok": false, "error": "rate_limited" }`                                                                      | per-IP or per-phone backstop tripped  |
| 200  | `{ "ok": false, "error": "slot_taken" \| "outside_hours" \| "invalid" \| "invalid_time" \| "invalid_contact" }` | passed through from `create_booking`  |
| 400  | `{ "ok": false, "error": "invalid_json" \| "invalid_payload", "detail": "…" }`                                  | bad/garbage body                      |
| 405  | `{ "ok": false, "error": "method_not_allowed" }`                                                                | not POST/OPTIONS                      |
| 500  | `{ "ok": false, "error": "server_error" \| "not_configured" }`                                                  | unhandled fault / missing service env |

`OPTIONS` preflight → `200 "ok"` with the CORS headers.

---

## 3. Turnstile is FAIL-OPEN (read this before go-live)

If `TURNSTILE_SECRET` is **unset**, the function **skips** the challenge (logs a `console.warn`) and
proceeds — so booking works before the key is configured. **This means a deploy that forgets the secret
has ZERO bot protection from Turnstile** (the IP/phone backstops still apply). Set it at go-live:

```bash
npx supabase secrets set TURNSTILE_SECRET=0x...        # Cloudflare → Turnstile → your widget
```

Once set, a token that fails `siteverify` → `200 { ok:false, error:"failed_challenge" }`, and a
network error talking to Cloudflare fails **closed** (also `failed_challenge`).

---

## 4. Environment variables

| Var                         | Source                 | Purpose                                                          |
| --------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`              | auto-injected          | service-role client target                                       |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected          | calls `create_booking` + reads `booking_attempts`/`bookings`     |
| `TURNSTILE_SECRET`          | `supabase secrets set` | Turnstile siteverify secret. **Unset → fail-open skip.**         |
| `IP_SALT`                   | `supabase secrets set` | salt mixed into the SHA-256 IP hash stored in `booking_attempts` |

Tunable backstops (constants in `index.ts`): `MAX_PER_IP=10` / 10 min, `MAX_PER_PHONE=5` / 24 h.
They are GENEROUS on purpose — Turnstile is the real gate; these must not false-positive on shared
CGNAT / salon Wi-Fi or a parent booking self + 2 kids.

---

## 5. Local testing

```bash
npx supabase start                  # boots the stack (Docker)
# Put a dev IP salt (and NO Turnstile secret, to exercise the fail-open skip path) in the env file:
printf 'IP_SALT=devsalt\n' > supabase/functions/.env
npx supabase functions serve submit-booking --no-verify-jwt --env-file supabase/functions/.env

# In another shell — use a barber that EXISTS in seed (hassan/victor/salman) and a startAt that is a
# valid working-hours future slot (Mon–Sat 09:00–18:00 Europe/Stockholm). 2040-03-14 is a Wednesday;
# 12:30Z = 13:30 Stockholm.
curl -s -X POST http://127.0.0.1:54321/functions/v1/submit-booking \
  -H 'content-type: application/json' \
  -d '{"booking":{"barberId":"hassan","serviceId":"h","serviceName":"Hår","price":350,"durationMin":45,"startAt":"2040-03-14T12:30:00.000Z","phone":"0701234567","lang":"sv","customerName":"Test Kund"},"turnstileToken":""}'
# -> { "ok": true, "booking": { … } }

curl -i -s -X OPTIONS http://127.0.0.1:54321/functions/v1/submit-booking   # -> 200 + CORS headers
```

---

## 6. Deploy

```bash
npx supabase functions deploy submit-booking
npx supabase secrets set IP_SALT=<random> TURNSTILE_SECRET=<cloudflare-secret>
```

The function is called by `src/booking/adapters/supabaseBooking.ts` via
`getSupabase().functions.invoke('submit-booking', { body: { booking, turnstileToken } })`.
