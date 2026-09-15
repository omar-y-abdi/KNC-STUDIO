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
if [[ "$PHASE" == model ]]; then
  npm exec vitest -- run tests/unit/cmsModel.test.ts
  deno check --config supabase/functions/cms-studio/deno.json supabase/functions/cms-studio/index.ts
  exit
fi
if [[ -f "$CONTROL/integrate.mjs" ]]; then node "$CONTROL/integrate.mjs" "$ROOT"; fi
npm run lint
npm run typecheck
npm test
npm run build
npm run deploy:dry-run
