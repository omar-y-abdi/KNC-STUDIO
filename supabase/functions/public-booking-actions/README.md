# Public booking actions

Customer self-service gateway for booking lookup, listing, cancellation, and reviews.

## Security boundary

- Browser requests require a valid Cloudflare Turnstile token.
- Direct anonymous execution of the underlying phone-based RPCs is revoked.
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
