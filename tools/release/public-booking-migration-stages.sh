#!/usr/bin/env bash

# Explicit migration manifest for the current production rollout boundary.
#
# The linked production history was verified through 20260827170300, including the
# 20260813123853 gateway contract. PR #55 must be merged/deployed first; after that,
# rebase this branch and refresh this manifest from a new linked migration-list check.

set -euo pipefail

readonly PUBLIC_BOOKING_REMOTE_BASELINE='20260827170300'
readonly PUBLIC_BOOKING_EXPAND_MIGRATIONS=(
  '20260831222332_customer_access_outbox_ciphertext.sql'
  '20260831220511_decimal_service_prices_and_duration_contract.sql'
  '20260831221442_service_ordering_contract.sql'
  '20260901013601_calendar_customer_contact_payload.sql'
  '20260901014248_relocate_btree_gist_to_extensions.sql'
  '20260902005645_calendar_reassignment_cleanup.sql'
  '20260905154608_customer_http_only_session.sql'
)
readonly PUBLIC_BOOKING_CONTRACT_MIGRATIONS=(
  '20260901011632_retire_taken_slots_contract.sql'
  '20260901011908_retire_legacy_customer_lookup_overloads.sql'
  '20260901012503_retire_superseded_booking_contracts.sql'
)

public_booking_stage_migrations() {
  if [[ "$#" -ne 3 ]]; then
    echo 'usage: public_booking_stage_migrations <expand|contract> <source-supabase> <target-supabase>' >&2
    return 2
  fi

  local mode="$1"
  local source_root="$2"
  local target_root="$3"
  case "$mode" in
    expand|contract) ;;
    *)
      echo "unsupported public booking stage: $mode" >&2
      return 2
      ;;
  esac

  if [[ ! -d "$source_root/migrations" ]]; then
    echo "missing migration source: $source_root/migrations" >&2
    return 1
  fi

  mkdir -p "$target_root"
  rsync -a --exclude '.temp' --exclude 'migrations/' "$source_root/" "$target_root/"
  mkdir -p "$target_root/migrations"

  local file name version
  while IFS= read -r -d '' file; do
    name="${file##*/}"
    version="${name%%_*}"
    if [[ "$version" =~ ^[0-9]{14}$ ]] && ((10#$version <= 10#$PUBLIC_BOOKING_REMOTE_BASELINE)); then
      cp "$file" "$target_root/migrations/$name"
    fi
  done < <(find "$source_root/migrations" -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)

  local migration
  for migration in "${PUBLIC_BOOKING_EXPAND_MIGRATIONS[@]}"; do
    if [[ ! -f "$source_root/migrations/$migration" ]]; then
      echo "manifest migration is missing from source: $migration" >&2
      return 1
    fi
    cp "$source_root/migrations/$migration" "$target_root/migrations/$migration"
  done

  if [[ "$mode" == 'contract' ]]; then
    for migration in "${PUBLIC_BOOKING_CONTRACT_MIGRATIONS[@]}"; do
      if [[ ! -f "$source_root/migrations/$migration" ]]; then
        echo "manifest migration is missing from source: $migration" >&2
        return 1
      fi
      cp "$source_root/migrations/$migration" "$target_root/migrations/$migration"
    done
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo 'source this file, then call public_booking_stage_migrations' >&2
  exit 2
fi
