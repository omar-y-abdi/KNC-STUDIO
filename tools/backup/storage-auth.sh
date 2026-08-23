#!/usr/bin/env bash

storage_configure_auth_headers() {
  local key="${1:-}"
  STORAGE_AUTH_HEADERS=()

  [[ -n "$key" ]] || return 1
  STORAGE_AUTH_HEADERS=(--header "apikey: $key")

  if [[ "$key" == sb_secret_* ]]; then
    return 0
  fi

  if [[ "$key" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]]; then
    STORAGE_AUTH_HEADERS+=(--header "Authorization: Bearer $key")
    return 0
  fi

  STORAGE_AUTH_HEADERS=()
  return 1
}

storage_response_status() {
  awk '/^HTTP\/[0-9.]+ [0-9]+/ { status = $2 } END { print status }' "$1"
}

storage_require_no_redirect() {
  local status
  status="$(storage_response_status "$1")"
  [[ "$status" =~ ^[0-9]{3}$ ]] || {
    printf 'Storage response did not include an HTTP status\n' >&2
    return 1
  }
  [[ "$status" != 3* ]] || {
    printf 'Storage redirect refused: HTTP %s\n' "$status" >&2
    return 1
  }
}
