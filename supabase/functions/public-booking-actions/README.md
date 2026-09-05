# Public booking actions

Customer self-service gateway for secure booking access, cancellation, and reviews.

## Security boundary

- Secure-link requests and review submissions require a valid Cloudflare Turnstile token and rate limits.
- Booking history and cancellation require the current permanent token sent to the exact booking email. Tokens are email-scoped, have no time expiry, and are replaced only by a fresh-link request. Legacy one-time fragment links remain exchangeable during migration.
- Review submission requires that same live email-possession session. The submitted phone is only a scope cross-check; knowing a customer's phone number is not sufficient to publish a review.
- Direct anonymous execution of legacy phone-based RPCs is revoked in the rollout contract phase.
- Rate-limit keys store salted SHA-256 hashes, never raw IP addresses, emails, or phone numbers.
- Allowed browser origins default to `https://bladeblendstudio.se` and `https://www.bladeblendstudio.se`.

## Durable secure-link delivery

A successful `request_access` response remains enumeration-safe. For a matching email, the database atomically rotates the permanent token and commits its `customer_access_email_send` external-action job. The response does not depend on `EdgeRuntime.waitUntil` or a best-effort send.

The external-action worker resolves the matching challenge and booking server-side before exposing the destination email and canonical encrypted token ciphertext to the dispatch context. The ciphertext is decrypted only immediately before the worker constructs the email. Transient Resend failures retry with the shared backoff/reclaim machinery and the stable Resend idempotency key. The dispatch-only challenge is consumed only after a successful send; expired/used challenge jobs are cleaned up automatically.

## Secrets

Set these before deployment:

```sh
npx supabase secrets set \
  TURNSTILE_SECRET=<cloudflare-secret> \
  PUBLIC_ACTION_HASH_SALT=<random-long-value> \
  RESEND_API_KEY=<active-resend-api-key> \
  PUBLIC_SITE_ORIGINS=https://bladeblendstudio.se,https://www.bladeblendstudio.se
```

`RESEND_API_KEY` is consumed by `external-cleanup` for queued secure-link mail. Run
`PROJECT_REF=<ref> npm run verify:production-secrets` before deployment; it verifies required Edge
and Vault names, rejects legacy secret aliases, and checks webhook-secret digest parity without
printing secret material.
