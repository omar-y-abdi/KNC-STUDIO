import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
export function integrate(root) {
  const path = resolve(root, 'tests/unit/externalActions.test.ts'), source = readFileSync(path, 'utf8')
  const anchor = "it('removes a Storage object idempotently through service-role Storage', async () => {"
  if (!source.includes(anchor)) throw new Error('Missing original Storage deletion test')
  writeFileSync(path, source.replace(anchor, anchor + "\n    rpc.mockResolvedValueOnce({ data: false, error: null })"))
}
