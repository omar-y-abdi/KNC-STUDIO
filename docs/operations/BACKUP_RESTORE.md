# Encrypted database backup and restore

## Scope

`.github/workflows/database-backup.yml` exports PostgreSQL daily with PostgreSQL 17, encrypts the
archive with `age`, deletes the plaintext dump, and stores only the encrypted archive plus SHA-256
checksum as a private GitHub Actions artifact for 30 days.

Database dumps include PostgreSQL data and schema. They do not include Supabase Storage object
bytes, project secrets, Auth SMTP configuration, or third-party dashboards. Export Storage objects
separately before production data depends on them.

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
5. Run **Encrypted database backup** manually once. Confirm artifact contains only `.dump.age` and
   `.sha256` files.

## Restore drill

Requirements: `age`, PostgreSQL 17 `pg_restore`, downloaded artifact, offline identity, and an empty
target database. Never restore a production dump over staging or production without explicit signoff.

```bash
sha256sum --check bladeblend-*.dump.age.sha256
age --decrypt \
  --identity /secure/offline/bladeblend-backup.agekey \
  --output /tmp/bladeblend-restore.dump \
  bladeblend-*.dump.age

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname "$EMPTY_TARGET_DATABASE_URL" \
  /tmp/bladeblend-restore.dump

rm /tmp/bladeblend-restore.dump
```

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
