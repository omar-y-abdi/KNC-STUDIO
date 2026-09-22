#!/usr/bin/env bash
set -euo pipefail

# Formatting only: unsupported/ignored files stay untouched; parse errors stay fatal.
npm run format -- --ignore-unknown --log-level warn
npm run format:check
# Share the formatted tree with every job without pushing commits or widening permissions.
git diff --binary --no-ext-diff > "$RUNNER_TEMP/format.patch"
