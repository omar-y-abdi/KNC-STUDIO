# Unified KNC CMS — implementation and verification plan

## Baselines and scope

KNC main: `9a17e4adce3ce3997032a5dc74fd08722fe991bd`. Reference o-y-a main: `e89397d7afbcfc281151ef8bce80501f374727b9`.

This is an isolated implementation. No production data, authentication settings, booking state or main branch is mutated by its development or automated tests. Supabase remains the authentication, database and media backend. R2 is not a prerequisite.

The owner receives one additional Editing / Redigering entry at `/admin/cms/`. Every existing admin tab, legacy URL parameter, operational view and account/session gate remains available. No old link is redirected into the studio. Barber self-service keeps its existing profile and operational permissions. The possible later six-entry navigation is explicitly deferred to the separate acceptance and retirement procedure in `docs/CMS-LEGACY-RETIREMENT.md`.

## Architecture

One full-screen studio contains a page/resource navigator, the actual rendered KNC preview, and contextual inspector. The top toolbar selects Swedish/English and light/dark independently of saved content. Desktop/mobile previews, zoom, selection, inline text editing, image selection, typography, spacing, position, borders, responsive overrides, undo/redo, local recovery, import/export, version history, comparison and explicit publication share one draft.

The existing interactive KNC components stay native Preact. Their editable text and presentation are bound to stable source-owned node identifiers, not rewritten into inert HTML. Booking actions and review submission cannot execute from the editor preview. Newly authored pages use a constrained document editor and the same validated representation in editing and public rendering. Functional booking/authentication behavior is not editable content.

Supabase stores immutable publication snapshots and the small public presentation document separately from owner-only state. A new authenticated Edge endpoint validates all writes and invokes a service-only transactional publication function. It verifies the current enabled owner, retains optimistic concurrency and idempotency, and never exposes service credentials to the client. Publication updates existing content tables so booking mail and public adapters continue reading their existing sources.

Email preview and sending share one pure renderer. Subject, preheader, body, notes, button label, contact text and safe presentation settings are editable. Recipient selection, booking facts, authentication links, cancellation enforcement and delivery idempotency remain server-owned. All nine template families and their supported languages remain reachable. Failed-delivery inspection/retry/discard is retained inside the studio.

The existing server image decoder is reused. New library uploads do not silently change the homepage, galleries or profile assignments. Library removal is archival; historical assets are retained. Current public Supabase Storage buckets remain public by URL, as before; adding an image to the library is distinct from publishing its placement on a page. No destructive media migration occurs.

## Content coverage

- Homepage: brand/logo, kicker, hours/address/contact, calls to action, public UI copy, SEO and business identity.
- About: headings/body, salon and haircut galleries/order/alts, staff names/roles/biographies/Instagram/photos, review form labels and all display states.
- Booking and customer views: all localized interface copy and safe presentation; existing schedule/service/booking data and submission contracts remain intact.
- Media: existing library inventory, decoded upload, selection, metadata, reference visibility, archived items and recovery.
- Staff: public profile editing plus existing account creation/invitation/enable/disable/delete operations in an explicitly immediate management panel. Account operations are not falsely represented as undoable content edits.
- Mail: all nine template families, SV/EN, actual previews, safe appearance, contact links, failed-delivery controls.
- Pages: add, duplicate, rename, route/metadata edit, archive/remove with confirmation, reusable content blocks and live public routing. Reserved system/customer paths cannot be shadowed.
- History: inspect prior versions without publishing; restore into a draft and explicitly publish. Removed staff accounts are never resurrected by a content restore.

## Execution gates

1. Inventory current code, Supabase table shapes/migrations and content privileges. Verify the unchanged baseline. Record live-inspection limitations rather than infer hidden policies.
2. Add failing model, transaction, authorization, unsafe-content, reserved-route and conflict tests. Implement the document model, Edge boundary and additive migration. Run actual isolated PostgreSQL/Supabase tests, including rollback and simultaneous publication.
3. Integrate the owner route and common studio without changing operational view implementations. Exercise owner, barber, expired session, forced-password and unconfigured states.
4. Bind actual public components, localized copy and presentation. Verify the no-override website is visually unchanged. Implement new-page public delivery and metadata/404 behavior.
5. Implement media and mail integration. Verify the actual renderer, existing upload decoder and existing failed-delivery actions; no live messages are sent by tests.
6. Run unit, lint, typecheck, frontend build, Edge checks, database tests, Worker tests and browser flows in Chromium, Firefox and WebKit. Test save/reload/public read, language/theme/device switching, undo/redo, local recovery, quota/network errors, concurrent editors, history, keyboard input and real image selection.
7. Generate the delivery from Git's actual changed/new paths. Exclude untouched files, generated assets, dependencies, credentials, fonts and temporary execution files. Verify the archive on a separate pristine baseline, preserve executable modes, list deletions, and retain concrete test evidence. A failed or unexecuted test is never called green.

## Known inspection boundary

The connected project's table shapes and migration inventory were read without mutation. Live policy-catalog introspection was denied by the connector safety boundary; intended RLS behavior is therefore inspected from migrations and must be tested in the isolated database. The production database is not used as a test fixture.
