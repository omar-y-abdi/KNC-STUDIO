#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: storage-backup.sh --output <directory>

Exports every STANDARD Supabase Storage bucket, including gallery and barber-photos,
to <directory>. Requires:
  SUPABASE_URL
  SUPABASE_STORAGE_SECRET_KEY

Optional:
  REQUIRED_STORAGE_BUCKETS  Comma-separated bucket ids. Defaults to gallery,barber-photos.
EOF
}

die() {
  printf 'storage backup: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

urlencode() {
  jq -nr --arg value "$1" '$value | @uri'
}

urlencode_path() {
  local remaining="$1"
  local segment encoded_segment encoded_path=''

  [[ -n "$remaining" ]] || die 'Storage object path cannot be empty'

  while :; do
    if [[ "$remaining" == */* ]]; then
      segment="${remaining%%/*}"
      remaining="${remaining#*/}"
    else
      segment="$remaining"
      remaining=''
    fi

    encoded_segment="$(urlencode "$segment")"
    if [[ -n "$encoded_path" ]]; then
      encoded_path+='/'
      encoded_path+="$encoded_segment"
    else
      encoded_path="$encoded_segment"
    fi

    [[ -n "$remaining" ]] || break
  done

  printf '%s' "$encoded_path"
}

output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || die '--output requires a directory'
      output="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$output" ]] || die '--output is required'
for command_name in awk cmp curl find grep jq mktemp sha256sum sort tr uniq wc; do
  require_command "$command_name"
done

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_STORAGE_SECRET_KEY:?SUPABASE_STORAGE_SECRET_KEY is required}"

case "$SUPABASE_URL" in
  https://*|http://localhost:*|http://127.0.0.1:*|http://[::1]:*) ;;
  *) die 'SUPABASE_URL must be an HTTPS URL outside local restore tests' ;;
esac

if [[ -e "$output" ]] && find "$output" -mindepth 1 -print -quit | grep -q .; then
  die "output directory is not empty: $output"
fi

mkdir -p "$output/objects"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

storage_url="${SUPABASE_URL%/}/storage/v1"
required_buckets="${REQUIRED_STORAGE_BUCKETS:-gallery,barber-photos}"
started_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
object_count=0
total_bytes=0
object_index=0

storage_request() {
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 3 \
    --retry-delay 1 \
    --retry-all-errors \
    --header "apikey: $SUPABASE_STORAGE_SECRET_KEY" \
    --header "Authorization: Bearer $SUPABASE_STORAGE_SECRET_KEY" \
    "$@"
}

backup_object() {
  local source_entry="$1"
  local bucket path
  local archive_path destination actual_bytes expected_bytes sha256

  bucket="$(jq -r '.bucket' <<<"$source_entry")"
  path="$(jq -r '.name' <<<"$source_entry")"

  printf -v archive_path 'objects/%08d.bin' "$object_index"
  destination="$output/$archive_path"

  storage_request \
    --request GET \
    --output "$destination" \
    "$storage_url/object/authenticated/$(urlencode "$bucket")/$(urlencode_path "$path")"

  actual_bytes="$(wc -c < "$destination" | tr -d '[:space:]')"
  expected_bytes="$(jq -r '.source_metadata.size // empty' <<<"$source_entry")"
  if [[ -n "$expected_bytes" && "$expected_bytes" != "$actual_bytes" ]]; then
    die "object changed while backing up bucket $bucket; retry after writes settle"
  fi

  sha256="$(sha256sum "$destination" | awk '{print $1}')"
  jq -cn \
    --argjson source "$source_entry" \
    --arg archive_path "$archive_path" \
    --arg sha256 "$sha256" \
    --argjson bytes "$actual_bytes" \
    '$source + {archive_path: $archive_path, bytes: $bytes, sha256: $sha256}' \
    >> "$output/objects.ndjson"

  object_count=$((object_count + 1))
  total_bytes=$((total_bytes + actual_bytes))
  object_index=$((object_index + 1))
}

inventory_prefix() {
  local bucket="$1"
  local prefix="$2"
  local destination="$3"
  local offset=0 response count entry name child_prefix payload

  while :; do
    payload="$(jq -cn \
      --arg prefix "$prefix" \
      --argjson offset "$offset" \
      '{prefix: $prefix, limit: 1000, offset: $offset, sortBy: {column: "name", order: "asc"}}')"
    response="$(storage_request \
      --request POST \
      --header 'Content-Type: application/json' \
      --data "$payload" \
      "$storage_url/object/list/$(urlencode "$bucket")")"
    jq -e 'type == "array"' >/dev/null <<<"$response" || die "invalid object listing response for bucket $bucket"
    count="$(jq 'length' <<<"$response")"
    [[ "$count" -gt 0 ]] || break

    while IFS= read -r entry; do
      name="$(jq -r '.name // empty' <<<"$entry")"
      [[ -n "$name" ]] || die "object listing returned an unnamed entry for bucket $bucket"
      if jq -e '.metadata != null' >/dev/null <<<"$entry"; then
        jq -cS \
          --arg bucket "$bucket" \
          --arg name "${prefix}${name}" \
          '{
            bucket: $bucket,
            name: $name,
            source_id: (.id // null),
            source_created_at: (.created_at // null),
            source_updated_at: (.updated_at // null),
            source_metadata: (.metadata // {})
          }' <<<"$entry" >> "$destination"
      else
        child_prefix="${prefix}${name}/"
        inventory_prefix "$bucket" "$child_prefix" "$destination"
      fi
    done < <(jq -c '.[]' <<<"$response")

    offset=$((offset + count))
    [[ "$count" -lt 1000 ]] && break
  done
}

capture_inventory() {
  local destination="$1"
  local bucket

  : > "$destination"
  while IFS= read -r bucket; do
    inventory_prefix "$bucket" '' "$destination"
  done < <(jq -r '.[].id' <<<"$standard_buckets")
  LC_ALL=C sort -o "$destination" "$destination"
}

buckets="$(storage_request --request GET "$storage_url/bucket")"
jq -e 'type == "array"' >/dev/null <<<"$buckets" || die 'invalid bucket inventory response'

unsupported_buckets="$(jq '[.[] | select((.type // "STANDARD") != "STANDARD")]' <<<"$buckets")"
if [[ "$(jq 'length' <<<"$unsupported_buckets")" -ne 0 ]]; then
  die 'unsupported non-STANDARD Storage bucket found; extend backup coverage before accepting production data'
fi

standard_buckets="$(jq '[.[] | select((.type // "STANDARD") == "STANDARD")]' <<<"$buckets")"
while IFS= read -r required_bucket; do
  [[ -z "$required_bucket" ]] && continue
  jq -e --arg id "$required_bucket" 'any(.[]; .id == $id)' >/dev/null <<<"$standard_buckets" \
    || die "required Storage bucket is missing: $required_bucket"
done < <(tr ',' '\n' <<<"$required_buckets")

jq -S '.' <<<"$standard_buckets" > "$output/buckets.json"
: > "$output/objects.ndjson"

capture_inventory "$temporary_directory/inventory-before.ndjson"

duplicate_count="$(jq -r '[.bucket, .name] | @base64' "$temporary_directory/inventory-before.ndjson" \
  | LC_ALL=C sort \
  | uniq -d \
  | wc -l \
  | tr -d '[:space:]')"
[[ "$duplicate_count" == '0' ]] || die 'duplicate object inventory entry detected; retry after writes settle'

while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  backup_object "$entry"
done < "$temporary_directory/inventory-before.ndjson"

capture_inventory "$temporary_directory/inventory-after.ndjson"
cmp --silent \
  "$temporary_directory/inventory-before.ndjson" \
  "$temporary_directory/inventory-after.ndjson" \
  || die 'Storage inventory changed during backup; retry after writes settle'

jq -n \
  --arg format 'bladeblend-storage-backup-v1' \
  --arg captured_at "$started_at" \
  --arg completed_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --argjson bucket_count "$(jq 'length' <<<"$standard_buckets")" \
  --argjson object_count "$object_count" \
  --argjson total_bytes "$total_bytes" \
  '{format: $format, captured_at: $captured_at, completed_at: $completed_at, bucket_count: $bucket_count, object_count: $object_count, total_bytes: $total_bytes}' \
  > "$output/inventory.json"

printf 'Storage backup captured %s buckets, %s objects, %s bytes.\n' \
  "$(jq 'length' <<<"$standard_buckets")" "$object_count" "$total_bytes"
