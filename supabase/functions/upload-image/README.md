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

## CPU and pixel budget

The processor lives in `processImage.ts` so tests execute the same codec path as the function.
Original dimensions and format are inspected before pixel decoding. JPEG decoding uses a target-size
hint; profile images retain enough source resolution for the central square, then crop before resize.
This avoids allocating an oversized intermediate panorama for narrow inputs. Auto-orientation,
metadata removal, the 25-megapixel input limit and 512,000-byte output limit remain enforced.

WebP uses method 0 and at most two encoding attempts (quality 82, then 55). An image which still
exceeds the output limit is rejected normally instead of consuming ten full encoding passes and
being terminated by the Edge CPU watchdog. The lower-effort encoder trades compression efficiency
for bounded CPU work; it is not a promise that every accepted input size can fit the output cap.
CMS uploads distinguish decoded/output-size rejection from corrupted or unsupported image data.

`node tools/e2e/upload-budget.mjs` profiles the real WASM processor on deterministic camera-sized
JPEGs and a difficult high-entropy image, checks decodable output, and preserves JSON measurements.
It runs in the existing frontend CI job. The 1,800 ms regression budget is measured on the CI runner,
not a substitute for checking the deployed Edge CPU logs. The fixtures are generated test data,
not uploaded owner photographs.
