# Secure image upload gateway

Authenticated owner/barber uploads are decoded server-side, metadata-stripped, resized, and encoded
as WebP before Storage receives them. Browser clients cannot insert or update bucket objects directly.

`magick.wasm` is pinned from `@imagemagick/magick-wasm@0.0.42` and bundled through the function's
`static_files` configuration. SHA-256:
`c903248c3b66a550b74bac5ea25d359e84455b8d82aa945a16f75f6fd8be610a`. Upstream license and notice
files are vendored beside it. Deploy with local Docker bundling; API-side bundling has a lower size
limit and does not support static files.

```sh
npx supabase functions deploy upload-image
```
