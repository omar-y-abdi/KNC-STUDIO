# Encrypted database backup and restore

## Scope

`.github/workflows/database-backup.yml` exports PostgreSQL daily with the repository-pinned Supabase
CLI, encrypts the bundle with `age`, deletes every plaintext file, and stores only the encrypted
bundle plus SHA-256 checksum as a private GitHub Actions artifact for 30 days.

The bundle contains `schema.sql`, `data.sql`, and an internal checksum manifest. The
Supabase CLI applies Supabase-specific filtering so managed internal schemas and reserved roles do
not cause the permission failures produced by an unfiltered `pg_dump` restore.

Database dumps include application schema, database data, and Auth users. This project defines no
custom PostgreSQL roles; Supabase-managed roles come from the target project and are not restored.
They do not include Supabase Storage object bytes, project secrets, Auth configuration, Edge
Function secrets, or third-party dashboards. Export Storage objects separately before production
data depends on them.

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
4. Add repository variable `BACKUP_AGE_RECIPIENT` using the public `age1...` value printed in step 1.
5. Run **Encrypted database backup** manually once. Confirm artifact contains only `.tar.gz.age` and
   `.sha256` files.

## Restore drill

Requirements: `age`, `tar`, PostgreSQL `psql`, downloaded artifact, offline identity, and a newly
created Supabase target project. Use the direct or session-pooler connection, not transaction mode.
Never restore a production dump over staging or production without explicit signoff.

```bash
sha256sum --check bladeblend-*.tar.gz.age.sha256
age --decrypt \
  --identity /secure/offline/bladeblend-backup.agekey \
  --output /tmp/bladeblend-restore.tar.gz \
  bladeblend-*.tar.gz.age

mkdir -p /tmp/bladeblend-restore
tar --extract --gzip \
  --file /tmp/bladeblend-restore.tar.gz \
  --directory /tmp/bladeblend-restore
(cd /tmp/bladeblend-restore && sha256sum --check MANIFEST.sha256)

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file /tmp/bladeblend-restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file /tmp/bladeblend-restore/data.sql \
  --dbname "$NEW_SUPABASE_DATABASE_URL"

rm -rf /tmp/bladeblend-restore /tmp/bladeblend-restore.tar.gz
```

After restore, configure Auth URLs and SMTP, deploy Edge Functions and secrets, recreate Cron jobs,
copy Storage object bytes, and rotate credentials before traffic reaches the target project.

Verify at minimum:

```sql
select count(*) from public.barbers;
select count(*) from public.services;
select count(*) from public.bookings;
select count(*) from public.profiles;
select count(*) from public.email_templates;
```

Record drill date, operator, source artifact run ID, target, relation counts, and result in private
operations records. Repeat monthly and after material migration changes. Failed scheduled workflows
must be investigated before accepting new production bookings.
