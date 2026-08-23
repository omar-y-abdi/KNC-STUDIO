#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_directory/storage-auth.sh"

usage() {
  cat <<'EOF'
Usage: storage-restore.sh --input <storage-directory> [--verify-only] [--allow-existing-buckets]

Restores and byte-verifies a Storage export created by storage-backup.sh. Requires:
  SUPABASE_URL
  SUPABASE_STORAGE_SECRET_KEY

Use only against a newly-created restore target. --allow-existing-buckets is required
when database metadata was restored before object bytes.
EOF
}

die() {
  printf 'storage restore: %s\n' "$*" >&2
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

input=''
verify_only=false
allow_existing_buckets=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      [[ $# -ge 2 ]] || die '--input requires a directory'
      input="$2"
      shift 2
      ;;
    --verify-only)
      verify_only=true
      shift
      ;;
    --allow-existing-buckets)
      allow_existing_buckets=true
      shift
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

[[ -n "$input" ]] || die '--input is required'
[[ -f "$input/buckets.json" ]] || die "missing $input/buckets.json"
[[ -f "$input/objects.ndjson" ]] || die "missing $input/objects.ndjson"
[[ -f "$input/inventory.json" ]] || die "missing $input/inventory.json"
for command_name in awk cmp curl jq mktemp sha256sum sort tr wc; do
  require_command "$command_name"
done

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_STORAGE_SECRET_KEY:?SUPABASE_STORAGE_SECRET_KEY is required}"
storage_configure_auth_headers "$SUPABASE_STORAGE_SECRET_KEY" \
  || die 'SUPABASE_STORAGE_SECRET_KEY must be an sb_secret key or legacy service_role JWT'

case "$SUPABASE_URL" in
  https://*|http://localhost:*|http://127.0.0.1:*|http://[::1]:*) ;;
  *) die 'SUPABASE_URL must be an HTTPS URL outside local restore tests' ;;
esac

jq -e 'type == "array" and all(.[]; (.type // "STANDARD") == "STANDARD" and (.id | type == "string"))' \
  "$input/buckets.json" >/dev/null || die 'invalid bucket inventory'
jq -e '.format == "bladeblend-storage-backup-v1"' "$input/inventory.json" >/dev/null \
  || die 'unsupported storage inventory format'

storage_url="${SUPABASE_URL%/}/storage/v1"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

storage_request() {
  local response_headers
  response_headers="$(mktemp "$temporary_directory/headers.XXXXXX")"
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --retry 3 \
    --retry-delay 1 \
    --retry-all-errors \
    --dump-header "$response_headers" \
    "${STORAGE_AUTH_HEADERS[@]}" \
    "$@"; then
    rm -f "$response_headers"
    return 1
  fi
  if ! storage_require_no_redirect "$response_headers"; then
    rm -f "$response_headers"
    return 1
  fi
  rm -f "$response_headers"
}

normalized_bucket() {
  jq -cS '{id, name: (.name // .id), public: (.public // false), file_size_limit: (.file_size_limit // null), allowed_mime_types: (.allowed_mime_types // null), type: (.type // "STANDARD")}'
}

ensure_bucket() {
  local bucket="$1"
  local bucket_id response status response_headers expected actual create_payload

  bucket_id="$(jq -r '.id' <<<"$bucket")"
  response="$temporary_directory/bucket-${bucket_id}.json"
  response_headers="$(mktemp "$temporary_directory/headers.XXXXXX")"
  status="$(curl \
    --silent \
    --show-error \
    --dump-header "$response_headers" \
    --output "$response" \
    --write-out '%{http_code}' \
    "${STORAGE_AUTH_HEADERS[@]}" \
    "$storage_url/bucket/$(urlencode "$bucket_id")")" || die "could not inspect target bucket $bucket_id"
  storage_require_no_redirect "$response_headers" || die "redirect refused while inspecting target bucket $bucket_id"
  rm -f "$response_headers"

  case "$status" in
    200)
      "$allow_existing_buckets" || die "target bucket already exists: $bucket_id; pass --allow-existing-buckets only for a new database-restored target"
      expected="$(normalized_bucket <<<"$bucket")"
      actual="$(normalized_bucket < "$response")"
      [[ "$expected" == "$actual" ]] || die "target bucket configuration differs: $bucket_id"
      ;;
    404)
      "$verify_only" && die "target bucket is missing: $bucket_id"
      create_payload="$(jq -c '
        {id, name: (.name // .id), public: (.public // false)}
        + if (.file_size_limit // null) != null then {file_size_limit} else {} end
        + if (.allowed_mime_types // null) != null then {allowed_mime_types} else {} end
      ' <<<"$bucket")"
      storage_request \
        --request POST \
        --header 'Content-Type: application/json' \
        --data "$create_payload" \
        "$storage_url/bucket/" >/dev/null
      ;;
    *)
      die "unexpected response while inspecting target bucket $bucket_id: HTTP $status"
      ;;
  esac
}

verify_local_object() {
  local entry="$1"
  local archive_path expected_bytes expected_sha256 actual_bytes actual_sha256

  archive_path="$(jq -r '.archive_path // empty' <<<"$entry")"
  [[ "$archive_path" =~ ^objects/[0-9]+\.bin$ ]] || die 'invalid object archive path'
  [[ -f "$input/$archive_path" ]] || die "missing object bytes: $archive_path"

  expected_bytes="$(jq -r '.bytes' <<<"$entry")"
  expected_sha256="$(jq -r '.sha256' <<<"$entry")"
  actual_bytes="$(wc -c < "$input/$archive_path" | tr -d '[:space:]')"
  actual_sha256="$(sha256sum "$input/$archive_path" | awk '{print $1}')"
  [[ "$expected_bytes" == "$actual_bytes" ]] || die "object size checksum failed: $archive_path"
  [[ "$expected_sha256" == "$actual_sha256" ]] || die "object SHA-256 checksum failed: $archive_path"
}

verify_target_object() {
  local entry="$1"
  local bucket name expected_bytes expected_sha256 destination actual_bytes actual_sha256

  bucket="$(jq -r '.bucket' <<<"$entry")"
  name="$(jq -r '.name' <<<"$entry")"
  expected_bytes="$(jq -r '.bytes' <<<"$entry")"
  expected_sha256="$(jq -r '.sha256' <<<"$entry")"
  destination="$(mktemp "$temporary_directory/object.XXXXXX")"

  storage_request \
    --request GET \
    --output "$destination" \
    "$storage_url/object/authenticated/$(urlencode "$bucket")/$(urlencode_path "$name")"

  actual_bytes="$(wc -c < "$destination" | tr -d '[:space:]')"
  actual_sha256="$(sha256sum "$destination" | awk '{print $1}')"
  [[ "$expected_bytes" == "$actual_bytes" ]] || die "restored object size checksum failed in bucket $bucket"
  [[ "$expected_sha256" == "$actual_sha256" ]] || die "restored object SHA-256 checksum failed in bucket $bucket"
}

restore_object() {
  local entry="$1"
  local bucket name archive_path mime_type cache_control
  local -a upload_headers

  verify_local_object "$entry"
  bucket="$(jq -r '.bucket' <<<"$entry")"
  name="$(jq -r '.name' <<<"$entry")"
  archive_path="$(jq -r '.archive_path' <<<"$entry")"
  mime_type="$(jq -r '.source_metadata.mimetype // "application/octet-stream"' <<<"$entry")"
  cache_control="$(jq -r '.source_metadata.cacheControl // .source_metadata.cache_control // empty' <<<"$entry")"

  upload_headers=(
    --request POST
    --header 'x-upsert: true'
    --header "Content-Type: $mime_type"
    --data-binary "@$input/$archive_path"
  )
  if [[ -n "$cache_control" ]]; then
    upload_headers+=(--header "Cache-Control: $cache_control")
  fi

  storage_request \
    "${upload_headers[@]}" \
    "$storage_url/object/$(urlencode "$bucket")/$(urlencode_path "$name")" >/dev/null
  verify_target_object "$entry"
}

list_prefix() {
  local bucket="$1"
  local prefix="$2"
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
    jq -e 'type == "array"' >/dev/null <<<"$response" || die "invalid target object listing response for bucket $bucket"
    count="$(jq 'length' <<<"$response")"
    [[ "$count" -gt 0 ]] || break

    while IFS= read -r entry; do
      name="$(jq -r '.name // empty' <<<"$entry")"
      [[ -n "$name" ]] || die "target object listing returned an unnamed entry for bucket $bucket"
      if jq -e '.metadata != null' >/dev/null <<<"$entry"; then
        jq -cn --arg bucket "$bucket" --arg name "${prefix}${name}" '{bucket: $bucket, name: $name}'
      else
        child_prefix="${prefix}${name}/"
        list_prefix "$bucket" "$child_prefix"
      fi
    done < <(jq -c '.[]' <<<"$response")

    offset=$((offset + count))
    [[ "$count" -lt 1000 ]] && break
  done
}

verify_target_inventory() {
  local expected actual bucket

  expected="$temporary_directory/expected.ndjson"
  actual="$temporary_directory/actual.ndjson"
  jq -c '{bucket, name}' "$input/objects.ndjson" | LC_ALL=C sort > "$expected"
  : > "$actual"
  while IFS= read -r bucket; do
    list_prefix "$bucket" '' >> "$actual"
  done < <(jq -r '.[].id' "$input/buckets.json")
  LC_ALL=C sort -o "$actual" "$actual"
  cmp --silent "$expected" "$actual" || die 'target Storage inventory differs from encrypted backup inventory'
}

verify_target_bucket_inventory() {
  local expected actual target_buckets

  expected="$temporary_directory/expected-buckets.json"
  actual="$temporary_directory/actual-buckets.json"
  jq -cS '[.[] | {id, name: (.name // .id), public: (.public // false), file_size_limit: (.file_size_limit // null), allowed_mime_types: (.allowed_mime_types // null), type: (.type // "STANDARD")}] | sort_by(.id)' \
    "$input/buckets.json" > "$expected"
  target_buckets="$(storage_request --request GET "$storage_url/bucket")"
  jq -e 'type == "array"' >/dev/null <<<"$target_buckets" || die 'invalid target bucket inventory response'
  jq -cS '[.[] | select((.type // "STANDARD") == "STANDARD") | {id, name: (.name // .id), public: (.public // false), file_size_limit: (.file_size_limit // null), allowed_mime_types: (.allowed_mime_types // null), type: (.type // "STANDARD")}] | sort_by(.id)' \
    <<<"$target_buckets" > "$actual"
  cmp --silent "$expected" "$actual" || die 'target bucket inventory differs from encrypted backup inventory'
}

while IFS= read -r bucket; do
  ensure_bucket "$bucket"
done < <(jq -c '.[]' "$input/buckets.json")

object_count=0
if [[ "$verify_only" == false ]]; then
  while IFS= read -r entry; do
    jq -e '(.bucket | type == "string") and (.name | type == "string") and (.bytes | type == "number") and (.sha256 | test("^[0-9a-f]{64}$"))' \
      >/dev/null <<<"$entry" || die 'invalid object manifest entry'
    restore_object "$entry"
    object_count=$((object_count + 1))
  done < "$input/objects.ndjson"
else
  while IFS= read -r entry; do
    verify_local_object "$entry"
    verify_target_object "$entry"
    object_count=$((object_count + 1))
  done < "$input/objects.ndjson"
fi

verify_target_bucket_inventory
verify_target_inventory
printf 'Storage restore verification passed for %s objects.\n' "$object_count"
