import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'tests/integration/admin.owner.test.ts')
  let source = readFileSync(path, 'utf8')
  const before = `    // The object 404s after delete.
    const gone = await fetch(uploaded.value.url, { method: 'GET' })
    expect(gone.ok).toBe(false)`
  const after = `    // The placement is gone, but the additive CMS registry retains immutable bytes for
    // drafts and historical publications. Physical deletion of unretained objects has a
    // separate regression test; these are intentionally different lifecycle contracts.
    const retained = await fetch(uploaded.value.url, { method: 'GET' })
    expect(retained.ok).toBe(true)
    const env = readAdminStackEnv()
    if (env === null) throw new Error('Missing local integration database')
    const db = new Client({ connectionString: env.dbUrl })
    await db.connect()
    try {
      const path = new URL(uploaded.value.url).pathname.split('/gallery/')[1]
      const rows = await db.query('select path from public.cms_assets where bucket=$1 and path=$2', ['gallery', path])
      expect(rows.rowCount).toBe(1)
      const placements = await db.query('select id from public.gallery_images where storage_path=$1', [path])
      expect(placements.rowCount).toBe(0)
    } finally { await db.end() }`
  if (!source.includes(before)) throw new Error('Missing original gallery lifecycle assertion')
  source = source.replace(before, after).replace('// Delete removes the row AND the object.', '// Delete removes the gallery placement; CMS retains its recoverable media object.')
  writeFileSync(path, source)
}
