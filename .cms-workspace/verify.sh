#!/usr/bin/env bash
set -euo pipefail
ROOT="$1"
EVIDENCE="$2"
CONTROL="$(pwd)/.cms-workspace"
PHASE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).phase' "$CONTROL/run.json")"
cd "$ROOT"
npm ci
if [[ "$PHASE" == inspect ]]; then
  set +e
  npm run typecheck > "$EVIDENCE/typecheck.log" 2>&1
  types=$?
  npm exec vitest -- run tests/unit/cmsModel.test.ts > "$EVIDENCE/cms-model.log" 2>&1
  model=$?
  cat "$EVIDENCE/typecheck.log" "$EVIDENCE/cms-model.log"
  printf 'TYPECHECK_EXIT=%s\nCMS_MODEL_EXIT=%s\n' "$types" "$model"
  if [[ "$types" != 0 || "$model" != 0 ]]; then exit 1; fi
  exit 0
fi
if [[ "$PHASE" == red ]]; then
  npm exec vitest -- run tests/unit/cmsContract.test.ts
  exit
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
if [[ -f "$CONTROL/integrate.mjs" ]]; then node "$CONTROL/integrate.mjs" "$ROOT"; fi
npm run lint
npm run typecheck
npm test
npm run build
npm run deploy:dry-run
