#!/usr/bin/env bash
set -euo pipefail
ROOT="$1"
EVIDENCE="$2"
CONTROL="$(pwd)/.cms-workspace"
PHASE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).phase' "$CONTROL/run.json")"
cd "$ROOT"
npm ci
if [[ "$PHASE" == red ]]; then
  npm exec vitest -- run tests/unit/cmsContract.test.ts
  exit
fi
if [[ "$PHASE" == routes-red ]]; then
  npm exec vitest -- run tests/unit/cmsPublicationRoutes.test.ts
  exit
fi
node "$CONTROL/run-integration.mjs" "$ROOT"
if [[ "$PHASE" == inspect ]]; then
  failed=0
  check() {
    local label="$1"
    shift
    if "$@" > "$EVIDENCE/$label.log" 2>&1; then
      printf 'PASS %s\n' "$label"
      tail -n 4 "$EVIDENCE/$label.log"
    else
      printf 'FAIL %s\n' "$label"
      tail -n 100 "$EVIDENCE/$label.log"
      failed=1
    fi
  }
  check typecheck npm run typecheck
  check cms-model npm exec vitest -- run tests/unit/cmsModel.test.ts tests/unit/cmsPublicationRoutes.test.ts tests/unit/cmsLegacyCoexistence.test.ts
  check unit npm test
  check lint npm run lint
  check build npm run build
  check edge deno check --config supabase/functions/cms-studio/deno.json supabase/functions/cms-studio/index.ts
  printf 'INSPECTION_FAILURE=%s\n' "$failed"
  exit "$failed"
fi
if [[ "$PHASE" == model ]]; then
  npm exec vitest -- run tests/unit/cmsModel.test.ts
  deno check --config supabase/functions/cms-studio/deno.json supabase/functions/cms-studio/index.ts
  exit
fi
if [[ "$PHASE" == database ]]; then
  trap 'npx supabase stop --no-backup || true' EXIT
  npx supabase start
  npx supabase test db --local
  exit
fi
node "$CONTROL/finalize-source.mjs" "$ROOT"
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run deploy:dry-run
