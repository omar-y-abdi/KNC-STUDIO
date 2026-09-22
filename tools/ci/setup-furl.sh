#!/usr/bin/env bash
set -euo pipefail

# Isolate the pinned native wheel; never compile Rust on a CI runner.
python3 -m venv "$RUNNER_TEMP/knc-furl"
"$RUNNER_TEMP/knc-furl/bin/python3" -m pip install \
  --disable-pip-version-check --no-input --quiet --only-binary=:all: \
  'furl-ctx==1.4.0'
echo "$RUNNER_TEMP/knc-furl/bin" >> "$GITHUB_PATH"
