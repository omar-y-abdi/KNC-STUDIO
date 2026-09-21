# CMS release and recovery

The CMS spans two deployments: the Cloudflare Worker/frontend and the Supabase `cms-studio`
Edge Function. A merged PR or successful Cloudflare build does not deploy Supabase Functions.

## Release order

1. If the CMS backend or its shared validators changed, run `npm run cms:stamp` and commit
   `shared/cms-release.ts` with the source. CI rejects a stale stamp. It covers the handler,
   import map, shared document and markup validators, and built-asset allowlist. Add new local
   backend dependencies to `releaseFiles` in `tools/release/cms-release.mjs`.
2. Run applicable unit, browser, type and lint checks. Database migrations require their own
   rollout; the release stamp does not certify the database schema.
3. Deploy the reviewed backend from the same checkout:

   ```bash
   npx supabase functions deploy cms-studio --project-ref soktgawvexeumqvtyhda --use-api
   npm run verify:cms-backend
   ```

4. Deploy the frontend with `npm run deploy`. In Cloudflare Workers Builds, use `npm run build`
   as the build command and `npm run deploy:frontend` as the production deploy command. The
   verifier compares the real Edge Function's `OPTIONS` header with this checkout's source
   digest. Missing headers, different code and unavailable backends block deployment. No
   management token or owner session is needed for this read-only check.
5. Verify with a real owner session: edit an existing element, publish, open a fresh public
   page, reload and check the result. Obtain consent before publishing temporary live test copy,
   then restore it. Check the panels and locked, scrolled preview too. A fixture test or
   successful upload does not prove production publication.

`verify:cms-backend` reads `VITE_SUPABASE_URL` from the environment or production Vite config.
`CMS_RELEASE_URL` can explicitly select another environment. `deploy:dry-run` does not require
this live check, so PR builds can validate an undeployed backend change.

Keep JWT verification enabled. The preflight exposes only a source digest; state, validation,
publication, history and resources still require a verified owner.

## Incident: 21 September 2026

PR #67 shipped an updated frontend while production `cms-studio` v3 still contained old shared
validators. A real exported draft had 155,986 characters in Swedish home HTML and 159,820 in
About. Save failed with `/.sv.html: Expected 0–100000 characters`. The same draft passed current
validators. Deploying the matching Function as v4 resolved the live failure. Owner publication,
fresh public reload and text restoration were verified through revisions 3, 4 and 5. The
subsequent release adds the digest check above.

Frontend defects shared a few causes:

- Non-modal `<dialog open>` let the canvas cover panels and receive their clicks. Native
  `showModal()` now provides the panels and image picker with a top-layer backdrop, keyboard
  isolation, Escape and focus restoration.
- Loading HTML before replacing CSS erased imported inline styles, expanding gallery images,
  changing the privacy control and removing new-page spacing. The editor now removes the previous
  tree, loads CSS, then imports HTML. Removing the old tree first prevents its cleanup from
  deleting the next page's ID rules.
- Opaque preview descendants lacked light/dark style metadata. They now retain it. Old uneditable
  preview subtrees are repaired from source without replacing owner-editable nodes. The repair is
  idempotent and becomes part of the recoverable draft.
- Default SVG children were unselectable and the mobile corner logo inherited pointer
  transparency. SVG selection is enabled only inside the editor. Logo text, image replacement and
  style controls retain the native component identity. Runtime actions remain code-owned.
- Source capture depended on the owner's privacy cookie. Its reopening control now renders
  consistently without changing consent storage.

## O-Y-A comparison

O-Y-A has a backend: its Cloudflare Worker stores revisions and the current pointer in D1; R2
stores media. Its `src/cms/store.mjs` reads published pages from D1, not R2. Blade & Blend uses
PostgreSQL revisions and Supabase Storage for these responsibilities. Moving bytes to R2 would
not fix stale validators, panel stacking or discarded styles.

These fixes follow O-Y-A's `src/cms/client/editor.mjs`, `dom.mjs`, `inspector.mjs` and `app.mjs`:
CSS-before-HTML import, native dialogs, explicit image picking and direct element controls.
Booking/auth components remain native to Blade & Blend.

## Verification boundaries

`cms-owner.mjs` covers desktop/mobile panels, SVG text/color, logo replacement, privacy appearance
and callback, custom-page styles, legacy-preview repair, additions, duplication, undo/redo,
selection, comparison and editing during publication in Chromium/WebKit. `cms-populated.mjs`
checks locked home scrolling with gallery tiles and public reload with a roster. `cms-native.mjs`,
`cms-projection.mjs` and `cms-conflict.mjs` cover native appearance, live callbacks and conflict
recovery. These suites use fixtures; live owner checks are a separate release step.

Lock view uses the real native app with the validated unpublished presentation in a separate
same-origin frame. Booking, customer and review writes are blocked by read-only ports, privacy
choices remain in frame-local memory, and links cannot navigate into the live booking app.
Mobile scrolling, folding navigation and privacy controls therefore retain their actual behavior.
Custom and legal pages use a sandboxed HTML/CSS preview. Physical iPhone Safari and delivered-email
pixel parity are not implied by these checks.

## Rollback

Redeploy compatible reviewed frontend and Function versions together; do not disable the release
check to force incompatible code through. CMS history restores content as a draft. Publishing
creates a new revision and retains history. Do not delete tables, revisions or media to repair
a deployment mismatch.
