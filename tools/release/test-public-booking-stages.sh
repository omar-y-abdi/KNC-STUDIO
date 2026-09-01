#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

supabase_cli=(npx --yes supabase@2.114.0)
source "$repo_root/tools/release/public-booking-migration-stages.sh"

stage_root="$(mktemp -d)"
trap 'rm -rf "$stage_root"' EXIT
public_booking_stage_migrations expand "$repo_root/supabase" "$stage_root/supabase"

"${supabase_cli[@]}" db reset --workdir "$stage_root"
"${supabase_cli[@]}" test db "$repo_root/tools/release/expand_public_booking_gateway_test.sql" \
  --workdir "$stage_root"

contract_root="$(mktemp -d)"
trap 'rm -rf "$stage_root" "$contract_root"' EXIT
public_booking_stage_migrations contract "$repo_root/supabase" "$contract_root/supabase"
"${supabase_cli[@]}" db reset --workdir "$contract_root"
"${supabase_cli[@]}" test db "$repo_root/supabase/tests/34_public_booking_gateway_contract_test.sql" \
  --workdir "$contract_root"
