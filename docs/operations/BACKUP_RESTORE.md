# Encrypted production backup and restore

## Scope

`.github/workflows/database-backup.yml` runs daily at `02:17 UTC`, exports PostgreSQL and every
standard Supabase Storage bucket, encrypts one bundle with `age`, deletes plaintext before the job
finishes, and stores only encrypted bytes plus an archive SHA-256 checksum as a private GitHub
Actions artifact for 30 days.

The encrypted bundle contains:

- `schema.sql` and `data.sql` for application data;
- `history_data.sql` for `supabase_migrations` lineage;
- `storage/buckets.json`, dynamically inventoried from every current standard bucket;
- `storage/objects.ndjson`, containing every object path, byte size, SHA-256 checksum, and content
  metadata;
- `storage/references.ndjson`, containing database references to business-owned Storage objects;
- `storage/objects/*.bin`, the actual object bytes; and
- `storage/inventory.json` plus `MANIFEST.sha256`.

`gallery` and `barber-photos` are required. Any future standard bucket is discovered and included
automatically. A non-standard bucket fails the backup rather than being silently omitted.
Storage inventory is captured before and after object download; any object, metadata, or timestamp
change aborts the backup. Database image references are captured before the SQL dump and after the
Storage export. Any changed reference or reference without captured bytes aborts the backup. Database
and Storage still do not share one transaction, so schedule the first production backup during a quiet
window and repeat immediately after any maintenance import.

Database dumps include application schema, database data, and Auth users. This project defines no
custom PostgreSQL roles; Supabase-managed roles come from the target project and are not restored.
The Storage export covers object bytes and bucket configuration, not project secrets, Auth
configuration, Edge Function secrets, Google credentials, Resend configuration, Cloudflare settings,
or other third-party dashboards.

## One-time setup

1. Generate an offline age identity on a trusted machine:

   ```bash
   age-keygen -o bladeblend-backup.agekey
   age-keygen -y bladeblend-backup.agekey
   ```

2. Store `bladeblend-backup.agekey` in an encrypted password manager and one separate offline copy.
   Never add it to GitHub, Supabase, source control, or cloud deployment variables.
3. Add repository secret `SUPABASE_DB_URL` using the direct/session database connection URI. Percent-
   encode special characters in the password.
4. Add repository variable `SUPABASE_URL` with the production project URL, for example
   `https://PROJECT_REF.supabase.co`.
5. Add repository secret `SUPABASE_STORAGE_SECRET_KEY` with the production project's current
   `sb_secret_...` key. A legacy `service_role` JWT remains compatible during migration. New secret
   keys are sent only as `apikey`; they are not JWTs and must not be sent as bearer tokens. Either key
   bypasses Storage RLS and must never be exposed to browser code or workflow output.
6. Add repository variable `BACKUP_AGE_RECIPIENT` using the public `age1...` value printed in step 1.
7. Run **Encrypted production backup** manually once. Confirm artifact contains only `.tar.gz.age`
   and `.sha256` files. Check the job log reports both required buckets and expected object count,
   without listing object paths or credentials.

## Restore drill

Requirements: `age`, `tar`, PostgreSQL `psql`, `bash`, `curl`, `jq`, `sha256sum`, downloaded
artifact, offline identity, and a newly-created Supabase target project. Use the direct or
session-pooler connection, not transaction mode. Never restore over an existing environment; this
drill proves recovery only in a newly-created target.

```bash
sha256sum --check bladeblend-*.tar.gz.age.sha256
age --decrypt \
  --identity /secure/offline/bladeblend-backup.agekey \
  --output /tmp/bladeblend-restore.tar.gz \
  bladeblend-*.tar.gz.age

mkdir -p /tmp/bladeblend-restore
tar --extract --gzip \
  --no-same-owner \
  --file /tmp/bladeblend-restore.tar.gz \
  --directory /tmp/bladeblend-restore
(cd /tmp/bladeblend-restore && sha256sum --check MANIFEST.sha256)
bash tools/backup/verify-backup-tree.sh /tmp/bladeblend-restore

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file /tmp/bladeblend-restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file /tmp/bladeblend-restore/data.sql \
  --dbname "$NEW_SUPABASE_DATABASE_URL"

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file tools/backup/prepare-migration-history.sql \
  --file /tmp/bladeblend-restore/history_data.sql \
  --dbname "$NEW_SUPABASE_DATABASE_URL"

export SUPABASE_URL='https://NEW_PROJECT_REF.supabase.co'
export SUPABASE_STORAGE_SECRET_KEY='new-project-secret-key'

# Database restore can recreate Storage metadata first. This explicit flag is safe only for this
# brand-new target and lets the script reconcile those bucket records before writing object bytes.
bash tools/backup/storage-restore.sh \
  --input /tmp/bladeblend-restore/storage \
  --allow-existing-buckets

# Downloads every restored object again, checks every SHA-256 and byte count, and proves target
# inventory has no missing or extra object relative to the encrypted backup.
bash tools/backup/storage-restore.sh \
  --input /tmp/bladeblend-restore/storage \
  --allow-existing-buckets \
  --verify-only

unset SUPABASE_STORAGE_SECRET_KEY
rm -rf /tmp/bladeblend-restore /tmp/bladeblend-restore.tar.gz
```

After byte verification, configure Auth URLs and SMTP, deploy Edge Functions and secrets, recreate
Cron jobs, configure third-party integrations, and rotate credentials before traffic reaches the
target project.

Verify at minimum:

```sql
select count(*) from public.barbers;
select count(*) from public.services;
select count(*) from public.bookings;
select count(*) from public.profiles;
select count(*) from public.email_templates;
select count(*) from storage.buckets;
select count(*) from storage.objects;
select count(*) from supabase_migrations.schema_migrations;
```

Record drill date, operator, source artifact run ID, target project ref, relation counts, migration
history count, bucket count, object count, byte-verification result, and cleanup result in private
operations records. Repeat monthly and after material migration or Storage changes. Failed scheduled
workflows must be investigated before accepting new production bookings.
