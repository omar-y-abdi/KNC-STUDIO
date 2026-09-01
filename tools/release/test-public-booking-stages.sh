#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

supabase_cli=(npx --yes supabase@2.114.0)

stage_root="$(mktemp -d)"
trap 'rm -rf "$stage_root"' EXIT
mkdir -p "$stage_root/supabase"
rsync -a --exclude '.temp' supabase/ "$stage_root/supabase/"
rm "$stage_root/supabase/migrations/20260813123853_contract_public_booking_gateway.sql"
# The expand stage must retain the legacy functions that are retired only in the
# later contract stage. Keep these migrations out of the temporary expand copy.
rm "$stage_root/supabase/migrations/20260901011632_retire_taken_slots_contract.sql"
rm "$stage_root/supabase/migrations/20260901011908_retire_legacy_customer_lookup_overloads.sql"
rm "$stage_root/supabase/migrations/20260901012503_retire_superseded_booking_contracts.sql"

"${supabase_cli[@]}" db reset --workdir "$stage_root"
"${supabase_cli[@]}" test db "$repo_root/tools/release/expand_public_booking_gateway_test.sql" \
  --workdir "$stage_root"

"${supabase_cli[@]}" db reset
"${supabase_cli[@]}" test db supabase/tests/34_public_booking_gateway_contract_test.sql
