import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const root = resolve(process.argv[2])
const exec = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const prettier = createRequire(resolve(root, 'package.json'))('prettier')
const entries = readdirSync(resolve(root, 'supabase/functions'), { withFileTypes: true }).filter(item => item.isDirectory() && existsSync(resolve(root, 'supabase/functions', item.name, 'index.ts'))).map(item => `supabase/functions/${item.name}/index.ts`).sort()
for (const entry of entries) exec('deno', ['check', '--frozen=false', '--node-modules-dir=manual', entry])
const paths = [...new Set([...git('diff', '--name-only', '-z').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')])].filter(path => path && /\.(?:[cm]?js|jsx?|tsx?|jsonc?|ya?ml|md|css|html)$/.test(path) && !path.startsWith('.env') && existsSync(resolve(root,path)))
if (paths.length) exec('npm', ['exec', 'prettier', '--', '--write', '--ignore-unknown', ...paths])
for (const path of paths) {
  const file = resolve(root, path)
  const options = { ...(await prettier.resolveConfig(file)), filepath: file }
  const first = readFileSync(file, 'utf8')
  const second = await prettier.format(first, options)
  if (first !== second) {
    const a = first.split('\n'), b = second.split('\n')
    const line = a.findIndex((value, index) => value !== b[index])
    console.log('FORMAT_SECOND_PASS', JSON.stringify({ path, line: line + 1, before: a.slice(Math.max(0, line - 2), line + 6), after: b.slice(Math.max(0, line - 2), line + 6) }))
    if (await prettier.format(second, options) !== second) throw new Error(`Formatter does not converge for ${path}`)
    writeFileSync(file, second)
  }
}
console.log(`Formatted ${paths.length} changed/new text files. Original untouched paths are not reformatted.`)
for (const entry of entries) exec('deno', ['check', '--frozen', '--node-modules-dir=manual', entry])
