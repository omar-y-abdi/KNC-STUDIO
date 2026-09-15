# Unified CMS setup and rollout

This guide is for the additive owner CMS at `/admin/cms/`. It does not retire the existing admin views, change booking ownership, or require destructive data cleanup. The old admin tabs and direct links remain part of the rollout until the separate acceptance procedure in `CMS-LEGACY-RETIREMENT.md` has been completed.

## Required configuration

The browser build must receive the same Supabase project settings already used by the application:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The Edge runtime already provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Supabase. Do not expose the service-role key to Vite or the browser. `cms-studio` accepts the production origins `https://bladeblendstudio.se` and `https://www.bladeblendstudio.se` by default. `CMS_ALLOWED_ORIGINS` is only needed when an additional reviewed staging origin must call the function. `PUBLIC_SUPABASE_URL` is optional; when absent, the Edge function uses `SUPABASE_URL` for public Storage references.

## 1. Preflight

Start from the reviewed commit and a clean working tree. Install the locked dependencies and run the source gates before touching production:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run deploy:dry-run
```

Take the normal encrypted production backup and verify that it is restorable using `docs/operations/BACKUP_RESTORE.md`. Do not use the production database as a test fixture. The CMS browser and database suites are designed to run against an isolated local Supabase stack.

## 2. Database migrations

The CMS rollout adds exactly these migration files after the current baseline:

- `supabase/migrations/20260915030000_unified_cms.sql`
- `supabase/migrations/20260915040000_cms_media_bridge.sql`

Use the repository's normal reviewed migration workflow. Before applying anything, perform a linked dry run and inspect the migration list. Continue only when the pending set is the reviewed set you intend to release; if unrelated migrations appear, stop and stage the release explicitly instead of applying them incidentally.

```bash
npx supabase db push --linked --dry-run
# Inspect the output before continuing.
npx supabase db push --linked --yes
```

The migrations are additive. They create CMS state/history/media structures, owner-checked internal RPCs, the public presentation projection, and the media bridge used while old and new editors coexist. They do not delete bookings, services, staff accounts, or the existing content tables.

After migration, verify that both versions are recorded in the remote migration history before deploying the CMS frontend.

## 3. Edge Functions

Deploy the new owner CMS boundary and the updated image gateway from the same reviewed source revision:

```bash
export PROJECT_REF="<your-supabase-project-ref>"
npx supabase functions deploy cms-studio --project-ref "$PROJECT_REF" --use-api
npx supabase functions deploy upload-image --project-ref "$PROJECT_REF" --use-api
```

`cms-studio` requires an authenticated, enabled owner whose forced-password-change gate is clear. Authorization is checked again in PostgreSQL. `upload-image` keeps its existing authenticated image path and adds the owner-only CMS asset path; ImageMagick decoding and `magick.wasm` remain part of that function's deployment.

Do not add `SUPABASE_SERVICE_ROLE_KEY` to frontend environment variables or repository files.

## 4. Frontend and Worker

Build with the production public Supabase values already used by the site:

```bash
export VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
export VITE_SUPABASE_ANON_KEY="<public-anon-or-publishable-key>"
npm run build
npm run deploy
```

The Worker serves the authenticated CMS application and the public CMS page projection. Existing `/admin` operational routes, booking routes, auth/customer routes, static assets and legacy admin URL parameters remain available.

## 5. Release checks

Before accepting the rollout, verify all of the following against the deployed revision:

1. An enabled owner can open `/admin/cms/`; an anonymous user and a barber cannot.
2. Every pre-existing admin tab and direct link still opens and performs its original operation.
3. Edit Swedish text, change theme/device preview, publish, reload the studio, and confirm the public page shows the committed value.
4. Upload a real image through **Bilder och typsnitt**, edit its metadata, archive it and restore it. Archiving must not delete a published or historical object.
5. Create a CMS page, check both languages and themes, publish it, open its direct URL, and confirm an unknown route still returns 404.
6. Preview an email template and confirm the delivered renderer uses the same committed template representation. Do not send test mail to real customers.
7. Open two owner sessions, make conflicting edits, and confirm the second publisher receives the compare/conflict flow rather than silently overwriting content.
8. Confirm version history can be inspected and loaded as a draft without automatically publishing or resurrecting deleted staff accounts.

The automated release gate should also run the isolated PostgreSQL/pgTAP suite, integration tests, and the authenticated CMS browser suite in Chromium, Firefox and WebKit.

## Rollback boundary

If the new CMS frontend or Edge behavior is faulty, redeploy the previous known-good Cloudflare frontend/Worker and the previous reviewed `upload-image` implementation. The additive CMS tables and migration history can remain in place while the old admin continues to operate. Do not drop CMS tables, delete media, or reverse published content with ad-hoc SQL as a rollback technique.

A later removal of the old content editors is a separate change. Follow `docs/CMS-LEGACY-RETIREMENT.md`; it requires manual acceptance, backup/restore proof, conflict tests and an independently reviewable cleanup commit.
