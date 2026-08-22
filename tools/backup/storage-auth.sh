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
