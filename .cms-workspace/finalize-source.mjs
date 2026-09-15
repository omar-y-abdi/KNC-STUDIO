import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(process.argv[2])
const exec = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const entries = readdirSync(resolve(root, 'supabase/functions'), { withFileTypes: true }).filter(item => item.isDirectory() && existsSync(resolve(root, 'supabase/functions', item.name, 'index.ts'))).map(item => `supabase/functions/${item.name}/index.ts`).sort()
for (const entry of entries) exec('deno', ['check', '--frozen=false', '--node-modules-dir=manual', entry])
const paths = [...new Set([...git('diff', '--name-only', '-z').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')])].filter(path => path && /\.(?:[cm]?js|jsx?|tsx?|jsonc?|ya?ml|md|css|html)$/.test(path) && !path.startsWith('.env') && existsSync(resolve(root,path)))
if (paths.length) exec('npm', ['exec', 'prettier', '--', '--write', '--ignore-unknown', ...paths])
console.log(`Formatted ${paths.length} changed/new text files. Original untouched paths are not reformatted.`)
for (const entry of entries) exec('deno', ['check', '--frozen', '--node-modules-dir=manual', entry])
