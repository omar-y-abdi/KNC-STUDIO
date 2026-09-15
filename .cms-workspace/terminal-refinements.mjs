import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(process.argv[2])
const patch = (path, action) => {
  const file = resolve(root, path)
  const before = readFileSync(file, 'utf8')
  const after = action(before)
  if (after === before) throw new Error(`Expected correction did not apply: ${path}`)
  writeFileSync(file, after)
}
patch('tools/e2e/cms-studio.mjs', source => source
  .replace("import assert from 'node:assert/strict'", "import assert from 'node:assert/strict'\nimport { randomUUID } from 'node:crypto'")
  .replaceAll('crypto.randomUUID()', 'randomUUID()')
  .replaceAll('location.origin', 'globalThis.location.origin')
  .replaceAll('navigator.locks', 'globalThis.navigator.locks')
  .replaceAll('sessionStorage.', 'globalThis.sessionStorage.')
  .replace(/\binnerWidth\b/g, 'globalThis.innerWidth')
  .replace('} catch {}', '} catch { /* The local Worker may still be starting. */ }')
  .replaceAll('.catch(() => {})', '.catch(() => undefined)'))
patch('docs/CMS-IMPLEMENTATION.md', source => source.replace(
  'Owner navigation becomes Editing, My schedule, My bookings, Services, All bookings, Settings. The existing operational views and account/session gate remain. `/admin/cms/` is owner-only. Barber self-service retains its existing profile and operational permissions. Old owner content links resolve into the studio instead of silently selecting another panel.',
  'The owner receives one additional Editing / Redigering entry at `/admin/cms/`. Every existing admin tab, legacy URL parameter, operational view and account/session gate remains available. No old link is redirected into the studio. Barber self-service keeps its existing profile and operational permissions. The possible later six-entry navigation is explicitly deferred to the separate acceptance and retirement procedure in `docs/CMS-LEGACY-RETIREMENT.md`.'))
