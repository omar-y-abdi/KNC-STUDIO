import { readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const control = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2])
for (const name of readdirSync(resolve(control, 'steps')).filter(name => name.endsWith('.mjs')).sort()) {
  const step = await import(pathToFileURL(resolve(control, 'steps', name)).href)
  await step.integrate(root)
}
execFileSync(process.execPath, [resolve(control, 'integrate.mjs'), root], { stdio: 'inherit' })
