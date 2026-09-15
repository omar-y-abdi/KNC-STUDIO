import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, copyFileSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(process.argv[2]), evidence = resolve(process.argv[3])
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const protectedPaths = [
  'src/admin/views/ScheduleView.tsx', 'src/admin/views/ScheduleDayGrid.tsx',
  'src/admin/views/BookingsView.tsx', 'src/admin/views/ServicesView.tsx',
  'src/admin/views/SettingsView.tsx', 'src/admin/adapters/bookingsAdmin.ts',
  'src/admin/adapters/schedulesAdmin.ts', 'src/admin/adapters/servicesAdmin.ts',
  'src/admin/useAdminSession.ts', 'src/admin/auth.ts',
  'supabase/functions/submit-booking/index.ts', 'supabase/functions/public-booking-actions/index.ts',
]
for (const path of protectedPaths) {
  if (git('diff', '--', path)) throw new Error(`Protected operational source was changed: ${path}`)
}
git('add', '-N', '--', '.')
const paths = git('diff', '--name-only', '-z').split('\0').filter(Boolean)
const deleted = git('diff', '--diff-filter=D', '--name-only', '-z').split('\0').filter(Boolean)
const target = resolve(evidence, '../cms-package')
mkdirSync(target, { recursive: true })
const files = []
for (const path of paths) {
  if (deleted.includes(path)) continue
  if (/^(?:\.env(?:\.|$)|\.cms-workspace\/|\.github\/workflows\/tmp-|dist\/|node_modules\/|output\/|coverage\/|artifacts\/)|\.(?:woff2?|ttf|otf)$/i.test(path)) throw new Error(`Unexpected delivery file: ${path}`)
  const from = resolve(root, path), to = resolve(target, path)
  if (!statSync(from).isFile() || relative(root, from).startsWith('..')) throw new Error(`Unsafe path ${path}`)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  chmodSync(to, statSync(from).mode & 0o777)
  const bytes = readFileSync(from)
  if (!bytes.equals(readFileSync(to))) throw new Error(`Package byte mismatch: ${path}`)
  files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
writeFileSync(resolve(evidence, 'manifest.json'), JSON.stringify({ base: '9a17e4adce3ce3997032a5dc74fd08722fe991bd', files, deleted, protectedPaths }, null, 2))
writeFileSync(resolve(evidence, 'changes.diff'), git('diff', '--binary'))
writeFileSync(resolve(evidence, 'changes-stat.txt'), git('diff', '--stat'))
console.log(`Package contains ${files.length} changed/new files; ${deleted.length} deletions. Operational files unchanged.`)
