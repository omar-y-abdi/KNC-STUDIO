#!/usr/bin/env bash
set -Eeuo pipefail

input="${1:-}"
[[ -n "$input" && -d "$input" ]] || { echo 'usage: verify-backup-tree.sh <plaintext-backup-directory>' >&2; exit 1; }

die() {
  printf 'backup verification: %s\n' "$*" >&2
  exit 1
}

for command_name in awk cmp comm find grep jq mktemp sed sha256sum sort tr wc; do
  command -v "$command_name" >/dev/null 2>&1 || die "missing required command: $command_name"
done

required_files=(
  schema.sql
  data.sql
  history_data.sql
  storage/buckets.json
  storage/objects.ndjson
  storage/references.ndjson
  storage/inventory.json
  MANIFEST.sha256
)
for path in "${required_files[@]}"; do
  [[ -f "$input/$path" ]] || die "missing required file: $path"
done
find "$input" -type l -print -quit | grep -q . && die 'symbolic links are not permitted'

grep -Fq 'CREATE TABLE IF NOT EXISTS "public"."bookings"' "$input/schema.sql" \
  || die 'application schema is absent'
grep -Fq 'COPY "auth"."users"' "$input/data.sql" || die 'Auth users are absent'
grep -Fq 'COPY "storage"."buckets"' "$input/data.sql" || die 'Storage bucket metadata is absent'
grep -Fq 'COPY "storage"."objects"' "$input/data.sql" || die 'Storage object metadata is absent'
grep -Fq 'COPY "supabase_migrations"."schema_migrations"' "$input/history_data.sql" \
  || die 'migration history is absent'

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT
(
  cd "$input"
  sha256sum --check MANIFEST.sha256 >/dev/null
  find . -type f -not -name MANIFEST.sha256 -print | LC_ALL=C sort > "$temporary_directory/actual-files"
  awk '{sub(/^\*/, "", $2); print $2}' MANIFEST.sha256 | LC_ALL=C sort > "$temporary_directory/manifest-files"
)
cmp --silent "$temporary_directory/actual-files" "$temporary_directory/manifest-files" \
  || die 'checksum manifest does not cover exactly every backup file'

jq -e 'type == "array" and all(.[]; (.id | type == "string") and ((.type // "STANDARD") == "STANDARD"))' \
  "$input/storage/buckets.json" >/dev/null || die 'invalid Storage bucket inventory'
jq -e '.format == "bladeblend-storage-backup-v1" and (.bucket_count | type == "number") and (.object_count | type == "number") and (.total_bytes | type == "number")' \
  "$input/storage/inventory.json" >/dev/null || die 'invalid Storage inventory summary'

required_buckets="${REQUIRED_STORAGE_BUCKETS:-gallery,barber-photos}"
while IFS= read -r bucket; do
  [[ -z "$bucket" ]] && continue
  jq -e --arg bucket "$bucket" 'any(.[]; .id == $bucket)' "$input/storage/buckets.json" >/dev/null \
    || die "required Storage bucket missing: $bucket"
done < <(tr ',' '\n' <<<"$required_buckets")

: > "$temporary_directory/referenced-objects"
object_count=0
total_bytes=0
while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  jq -e '(.bucket | type == "string" and length > 0) and (.name | type == "string" and length > 0) and (.archive_path | test("^objects/[0-9]{8}\\.bin$")) and (.bytes | type == "number" and . >= 0) and (.sha256 | test("^[0-9a-f]{64}$"))' \
    >/dev/null <<<"$entry" || die 'invalid Storage object manifest entry'
  archive_path="$(jq -r '.archive_path' <<<"$entry")"
  object_file="$input/storage/$archive_path"
  [[ -f "$object_file" ]] || die "missing Storage object bytes: $archive_path"
  expected_bytes="$(jq -r '.bytes' <<<"$entry")"
  expected_sha="$(jq -r '.sha256' <<<"$entry")"
  actual_bytes="$(wc -c < "$object_file" | tr -d '[:space:]')"
  actual_sha="$(sha256sum "$object_file" | awk '{print $1}')"
  [[ "$actual_bytes" == "$expected_bytes" ]] || die "Storage object size mismatch: $archive_path"
  [[ "$actual_sha" == "$expected_sha" ]] || die "Storage object checksum mismatch: $archive_path"
  printf './%s\n' "$archive_path" >> "$temporary_directory/referenced-objects"
  object_count=$((object_count + 1))
  total_bytes=$((total_bytes + actual_bytes))
done < "$input/storage/objects.ndjson"

find "$input/storage/objects" -type f -print \
  | sed "s#^$input/storage/#./#" \
  | LC_ALL=C sort > "$temporary_directory/actual-objects"
LC_ALL=C sort -o "$temporary_directory/referenced-objects" "$temporary_directory/referenced-objects"
cmp --silent "$temporary_directory/actual-objects" "$temporary_directory/referenced-objects" \
  || die 'Storage byte files and object manifest differ'

jq -e -s '
  all(.[];
    (.bucket == "gallery" or .bucket == "barber-photos")
    and (.name | type == "string" and length > 0 and length <= 300)
  )
' "$input/storage/references.ndjson" >/dev/null || die 'invalid database Storage reference snapshot'
jq -r '[.bucket, .name] | @tsv' "$input/storage/references.ndjson" \
  | LC_ALL=C sort -u > "$temporary_directory/database-references"
jq -r '[.bucket, .name] | @tsv' "$input/storage/objects.ndjson" \
  | LC_ALL=C sort -u > "$temporary_directory/storage-inventory"
comm -23 "$temporary_directory/database-references" "$temporary_directory/storage-inventory" \
  > "$temporary_directory/missing-references"
[[ ! -s "$temporary_directory/missing-references" ]] \
  || die 'database references Storage objects absent from backup bytes'

expected_bucket_count="$(jq -r '.bucket_count' "$input/storage/inventory.json")"
actual_bucket_count="$(jq 'length' "$input/storage/buckets.json")"
expected_object_count="$(jq -r '.object_count' "$input/storage/inventory.json")"
expected_total_bytes="$(jq -r '.total_bytes' "$input/storage/inventory.json")"
[[ "$actual_bucket_count" == "$expected_bucket_count" ]] || die 'Storage bucket count mismatch'
[[ "$object_count" == "$expected_object_count" ]] || die 'Storage object count mismatch'
[[ "$total_bytes" == "$expected_total_bytes" ]] || die 'Storage byte total mismatch'

printf 'Backup verification passed: %s buckets, %s objects, %s bytes.\n' \
  "$actual_bucket_count" "$object_count" "$total_bytes"
