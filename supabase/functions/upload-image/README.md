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

For non-interactive deployment (for example GitHub Actions), provide a Supabase management
`SUPABASE_ACCESS_TOKEN`. Do not substitute `--use-api`: this function's vendored WASM is a
configured static file and must use the CLI/Docker bundle path.

## JPEG/WebP corruption guard

`ImageMagick.write()` exposes a temporary WASM-owned byte buffer. The upload gateway must copy those
bytes inside the write callback before returning them to asynchronous Storage code. Retaining the
callback buffer by reference can produce intermittent corrupted WebP uploads, with JPEG inputs being
especially likely to expose the issue.
