#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

supabase_cli=(npx --yes supabase@2.114.0)

"${supabase_cli[@]}" db reset --version 20260813123852
"${supabase_cli[@]}" test db tools/release/expand_public_booking_gateway_test.sql

"${supabase_cli[@]}" db reset
"${supabase_cli[@]}" test db supabase/tests/34_public_booking_gateway_contract_test.sql
