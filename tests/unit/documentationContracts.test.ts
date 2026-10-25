import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const documents = [
  'CODEBASE-MAP.md',
  'README.md',
  'src/admin/cms/UX-CONTRACT.md',
  'src/admin/cms/DESIGN.md',
]

// Routes, commands, CSS properties and ignored local config are not repository paths.
// Recognize root directories even when a referenced file has no extension, plus bare
// filenames used relative to a document. Do not filter candidates by whether they exist:
// that would hide precisely the stale links this guard needs to catch.
const repositoryPath = /^(?:src|shared|tests|tools|supabase|public|docs|\.github)\//
const filename =
  /^(?:[\w.-]+\.(?:tsx?|m?[jc]s|[mc]ts|jsonc?|md|css|html|sh|toml|ya?ml|sql|txt|py|svg|png|webp|woff2)|\.env)$/

it('keeps every backticked repository path in the navigation docs resolvable', () => {
  const missing: string[] = []
  let checked = 0
  for (const document of documents) {
    const source = readFileSync(resolve(root, document), 'utf8')
    for (const match of source.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
      const path = match[1]
      if (!path || path.startsWith('/') || /[^\w./-]/.test(path)) continue
      if (!repositoryPath.test(path) && !filename.test(path.split('/').at(-1) ?? '')) continue
      checked++
      const absolute = repositoryPath.test(path)
        ? resolve(root, path)
        : resolve(root, dirname(document), path)
      if (!existsSync(absolute) && !existsSync(resolve(root, path)))
        missing.push(`${document}: ${path}`)
    }
  }
  expect(checked).toBeGreaterThan(documents.length)
  expect(missing, 'Update paths when moving or renaming mapped files').toEqual([])
})
