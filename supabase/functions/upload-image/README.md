# Secure image upload gateway

Authenticated owner/barber uploads are decoded server-side, metadata-stripped, resized, and encoded
as WebP before Storage receives them. Browser clients cannot insert or update bucket objects directly.

## Supported writers

`cms_asset` registers owner-uploaded media in the CMS library; Studio publication assigns gallery
images and the homepage logo to the canonical public read models. `barber_photo` remains available
to the owner and to the barber for their own profile, including exact-path deletion.

`barber_work` stores a barber's work picture outside the CMS, with the same sign-in, account and
barber scope as `barber_photo`. The multipart upload (`kind`, `file`, `barberId`) is processed like
a gallery image and stored at `barber-work/<barberId>/<uuid>.webp`, then recorded by
`internal_add_barber_work_photo`; if that fails, the object is removed again. The JSON delete
`{action: 'delete', kind: 'barber_work', barberId, storagePath}` accepts only that path shape. It
removes the object first (a missing object counts as removed) and then the row through
`internal_delete_barber_work_photo`; when the object cannot be removed, the answer is HTTP 500
`storage_failed` and the row stays, so the request can be retried. Work pictures write no admin
log entry. `admin-manage-barber` removes a deleted barber's `barber-work/<barberId>/` objects.

This gateway no longer accepts the legacy `gallery` and `site_logo` upload and JSON-delete kinds.
Even an authenticated owner receives HTTP 400 `invalid_payload` for these old-client requests,
before image decoding or Storage/metadata writes. Use the current Studio media library and publish
the assignment instead.

The database keeps the four legacy gallery/logo writer RPCs (`internal_insert_gallery_image`,
`internal_delete_gallery_image`, `internal_replace_homepage_logo`, `internal_remove_homepage_logo`)
in this release. This gateway calls none of them and the previous gateway still needs them, so a
merge may deploy this gateway and the migrations in either order. Removing them is a later release:

1. Deploy this gateway and verify it live: a Studio upload succeeds and an old `gallery` or
   `site_logo` request returns HTTP 400.
2. Then add a new forward migration that drops only those four RPCs with
   `DROP FUNCTION ... RESTRICT`. The canonical `gallery_images` and `site_settings` tables, CMS
   asset registration, barber-photo helpers, generic Storage deletion queue, retention checks,
   orphan reconciliation and fenced worker dispatch stay. Already-queued gallery and logo deletion
   jobs keep their payloads and can still be dispatched.

`index.ts` reads `magick.wasm` from the pinned `@imagemagick/magick-wasm@0.0.42` npm package, beside
the package entry that `import.meta.resolve` returns. The bundler packs the package's files into the
function bundle, the 14.7 MB WASM and the upstream license and notice files included, so the
function needs no `static_files` entry. Deploy with local Docker bundling; API-side bundling has a
lower size limit.

```sh
npx supabase functions deploy upload-image
```

For non-interactive deployment (for example GitHub Actions), provide a Supabase management
`SUPABASE_ACCESS_TOKEN`. Do not substitute `--use-api`: the bundle carries the WASM and must use the
CLI/Docker bundle path.

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

`tools/e2e/upload-budget.spec.mjs` profiles the real WASM processor on deterministic camera-sized
JPEGs and a difficult high-entropy image, checks decodable output, and preserves JSON measurements.
It runs in the existing frontend CI job. The 1,800 ms regression budget is measured on the CI runner,
not a substitute for checking the deployed Edge CPU logs. The fixtures are generated test data,
not uploaded owner photographs.
