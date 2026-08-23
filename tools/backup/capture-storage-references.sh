#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: capture-storage-references.sh --output <file>

Captures current database references to business-owned Supabase Storage objects.
Requires DATABASE_URL.
EOF
}

die() {
  printf 'storage reference snapshot: %s\n' "$*" >&2
  exit 1
}

output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || die '--output requires a file'
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
command -v jq >/dev/null 2>&1 || die 'missing required command: jq'
command -v psql >/dev/null 2>&1 || die 'missing required command: psql'
command -v sort >/dev/null 2>&1 || die 'missing required command: sort'
: "${DATABASE_URL:?DATABASE_URL is required}"

mkdir -p "$(dirname "$output")"
temporary="$(mktemp "${output}.tmp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT

psql \
  --no-psqlrc \
  --quiet \
  --tuples-only \
  --no-align \
  --set ON_ERROR_STOP=1 \
  --dbname "$DATABASE_URL" \
  --command "
    select pg_catalog.jsonb_build_object(
      'bucket', referenced.bucket,
      'name', referenced.storage_path
    )::text
    from (
      select 'gallery'::text as bucket, g.storage_path
      from public.gallery_images g
      union all
      select 'barber-photos'::text as bucket, p.storage_path
      from public.barber_photos p
    ) referenced
    order by referenced.bucket, referenced.storage_path
  " > "$temporary"

jq -e -s '
  all(.[];
    (.bucket == "gallery" or .bucket == "barber-photos")
    and (.name | type == "string" and length > 0 and length <= 300)
  )
' "$temporary" >/dev/null || die 'database returned invalid Storage references'

LC_ALL=C sort "$temporary" > "$output"
