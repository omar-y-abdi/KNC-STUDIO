# Launch release — 13 September 2026

Baseline: PR59, `adfc26e`. Branch: `codex/fix-unnoticed-issues`.
The frontend requires a new PR deployment. Backend operations below already ran against
`soktgawvexeumqvtyhda`; do not repeat password rotation or replay migrations manually.

## Applied production operations

1. Owner-authorized database-password rotation; GitHub `SUPABASE_DB_URL` updated without printing it.
2. Encrypted production backup [34764434644](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/34764434644)
   succeeded. Artifact SHA256, decryption and archive inventory checked; plaintext removed.
3. Migrations applied and their exact versions read back:
   - `20260913131739_verified_customer_profiles.sql`
   - `20260913135548_tighten_private_calendar_grants.sql`
   - `20260913140731_durable_dispatch_request_budget.sql`
   - `20260913145001_cms_legal_business_identity.sql`
4. Existing booking emails have profile mappings; orphan count zero. Browser roles have no direct
   read grant on customer profiles or private calendar tokens.
5. Edge Functions deployed after the profile migration: `public-booking-actions` v14,
   `external-cleanup` v14, `send-confirmation` v53. Existing gateway/secret checks remain authoritative;
   their configured `verify_jwt=false` remains unchanged.
6. Legacy `calendar-sync` removed after no calling triggers/cron remained and actual Google create/
   delete behavior passed. Its source was saved locally in `/tmp/knc-calendar-sync-retired-source.json`.

The CLI migration-cache exporter warned that the direct IPv6 database hostname could not resolve.
Pooler migration execution succeeded; migration versions and effective grants were independently
read back through the management connection. This was not a failed migration.

## Frontend release

1. Review the new PR and require CI for its final commit, including Linux browser/visual gates.
2. Merge that PR and require main CI plus Cloudflare deployment for the same commit.
3. Check `/`, `/terms`, `/privacy`, an unknown route, and authenticated admin on the actual deployment.
   The hero opening-hours placement, cookie controls and customer-email linking UI must come from
   the new frontend; the previous production frontend does not contain these branch changes.
4. Client enters legal name, organization number, contact/address and final salon/catalog details
   in the existing owner CMS. Empty legal fields intentionally produce no invented company identity.

No new production test booking is needed merely to repeat the completed provider proof: the owned
booking was received in Gmail, opened via its actual email link, shown in Google, cancelled, confirmed
by cancellation email and removed from Google. Three real appointments remained intact.
Physical iPhone Safari was not rerun; local Chromium, Firefox and WebKit passed the full customer gate.

## Rollback boundaries

- Frontend: redeploy the previous known-good Cloudflare version. New CMS/profile data remains intact.
- Edge: deploy the previous reviewed handler source only after checking compatibility with these
  migrations. Never remove the current gateway's signature/session checks.
- Profiles: do not drop the mapping tables or silently split verified groups. Any reversal needs a
  data-preserving migration and explicit identity rules; deleting aliases would alter customer access.
- Database password: GitHub uses the new value. Recover the encrypted connection copy under
  `~/.config/bladeblend-backup/db-connection-2026-09-13.env.age` with the existing offline age identity.
  Keep both out of git, chat and cloud artifacts. Update another direct DB client only if one exists.
- Provider retry ledgers remain the completion authority. Do not force jobs complete to clear the UI.

See [backup/restore](BACKUP_RESTORE.md), [identity contract](../qa/2026-09-13-launch/customer-identity-plan.md)
and [verification log](../qa/2026-09-13-launch/pm.md).
