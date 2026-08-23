# Public booking actions

Customer self-service gateway for secure booking access, cancellation, and reviews.

## Security boundary

- Secure-link requests and review submissions require a valid Cloudflare Turnstile token and rate limits.
- Booking history and cancellation require a short-lived, one-time link sent to the exact booking email address. The gateway exchanges it for an opaque session scoped to both booking phone and email.
- Review submission requires that same live email-possession session. The submitted phone is only a scope cross-check; knowing a customer's phone number is not sufficient to publish a review.
- Direct anonymous execution of legacy phone-based RPCs is revoked in the rollout contract phase.
- Rate-limit keys store salted SHA-256 hashes, never raw IP addresses or phone numbers.
- Allowed browser origins default to `https://bladeblendstudio.se` and `https://www.bladeblendstudio.se`.

## Durable secure-link delivery

A successful `request_access` response means the database has committed both the one-time challenge and a `customer_access_email_send` external-action job. The response no longer depends on `EdgeRuntime.waitUntil` or a best-effort send.

The external-action worker resolves the matching challenge and booking server-side before exposing the destination email/code to the dispatch context. Transient Resend failures retry with the shared backoff/reclaim machinery. Permanent delivery errors are blocked and the stored access code is redacted; expired/used challenge jobs are cleaned up automatically.

## Secrets

Set these before deployment:

```sh
npx supabase secrets set \
  TURNSTILE_SECRET=<cloudflare-secret> \
  PUBLIC_ACTION_HASH_SALT=<random-long-value> \
  RESEND_API_KEY=<active-resend-api-key> \
  PUBLIC_SITE_ORIGINS=https://bladeblendstudio.se,https://www.bladeblendstudio.se
```

`RESEND_API_KEY` is consumed by `external-cleanup` for queued secure-link mail. `PUBLIC_SITE_ORIGINS` is optional unless another deployment origin must call the gateway.
