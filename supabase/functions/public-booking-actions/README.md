# Public booking actions

Customer self-service gateway for booking history, cancellation, and reviews.

## Security boundary

- Secure-link requests and review submissions require a valid Cloudflare Turnstile token.
- Booking history and cancellation require a short-lived, one-time link sent to the exact booking
  email address. The gateway exchanges it for an opaque, email-scoped session token.
- Direct anonymous execution of legacy phone-based RPCs is revoked only in rollout contract phase.
- Rate-limit keys store salted SHA-256 hashes, never raw IP addresses or phone numbers.
- Allowed browser origins default to `https://bladeblendstudio.se` and
  `https://www.bladeblendstudio.se`.

## Secrets

Set these before deployment:

```sh
npx supabase secrets set \
  TURNSTILE_SECRET=<cloudflare-secret> \
  PUBLIC_ACTION_HASH_SALT=<random-long-value> \
  PUBLIC_SITE_ORIGINS=https://bladeblendstudio.se,https://www.bladeblendstudio.se
```

`PUBLIC_SITE_ORIGINS` is optional unless another deployment origin must call the function.
