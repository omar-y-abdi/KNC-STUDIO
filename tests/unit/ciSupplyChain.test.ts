import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CI supply-chain pins', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  const workflows = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => readFileSync(`.github/workflows/${name}`, 'utf8'))
    .concat(
      readdirSync('.github/actions').map((name) =>
        readFileSync(`.github/actions/${name}/action.yml`, 'utf8'),
      ),
    )

  it('pins Deno runtime to an exact release', () => {
    expect(workflow).toMatch(/deno-version:\s+v\d+\.\d+\.\d+/)
    expect(workflow).not.toMatch(/deno-version:\s+v?\d+\.x/)
  })

  it('keeps frozen dependency resolution on every Edge Function check', () => {
    const edge = workflow.split('\n  edge-functions:\n')[1]?.split('\n  database-current:\n')[0]
    expect(edge).toContain('working-directory: supabase/functions')
    expect(edge).toContain('deno check --config deno.json --frozen "$file"')
    expect(edge).not.toContain('--node-modules-dir=manual')
    expect(edge).toContain('find . -mindepth 2 -maxdepth 2 -name index.ts')
  })

  it('isolates frozen Deno resolution from the root npm tree and locks required Node types', () => {
    const config = JSON.parse(readFileSync('supabase/functions/deno.json', 'utf8')) as {
      imports: Record<string, string>
      lock: string
      nodeModulesDir: string
    }
    const lock = JSON.parse(readFileSync('supabase/functions/deno.lock', 'utf8')) as {
      specifiers: Record<string, string>
      npm: Record<string, { integrity: string; dependencies?: string[] }>
      workspace: { dependencies: string[]; packageJson?: { dependencies: string[] } }
    }
    expect(config.nodeModulesDir).toBe('none')
    expect(existsSync('supabase/functions/package.json')).toBe(false)
    expect(config.lock).toBe('./deno.lock')
    expect(lock.workspace.packageJson).toBeUndefined()
    expect(Object.keys(lock.npm).some((name) => name.startsWith('@types/node@'))).toBe(true)
    for (const [name, entry] of Object.entries(lock.npm))
      expect(entry.integrity, name).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/)
    expect(lock.workspace.dependencies).toEqual(
      Object.values(config.imports)
        .filter((specifier) => specifier.startsWith('npm:'))
        .sort(),
    )
    expect(existsSync('deno.lock')).toBe(false)
    for (const entry of readdirSync('supabase/functions', { withFileTypes: true })) {
      const path = `supabase/functions/${entry.name}/deno.json`
      if (!entry.isDirectory() || !existsSync(path)) continue
      const member = JSON.parse(readFileSync(path, 'utf8')) as { imports: Record<string, string> }
      for (const [name, target] of Object.entries(member.imports))
        expect(config.imports[name], `${entry.name}: ${name}`).toBe(target)
    }
  })

  it('updates the Worker tooling and ambient types together', () => {
    const dependabot = readFileSync('.github/dependabot.yml', 'utf8')
    expect(dependabot).toMatch(/package-ecosystem: npm/)
    expect(dependabot).toMatch(
      /cloudflare-workers:\s+patterns:\s+- wrangler\s+- '@cloudflare\/workers-types'/,
    )
  })

  it('keeps the workflows and every composite action directory under Dependabot', () => {
    const dependabot = readFileSync('.github/dependabot.yml', 'utf8').split('\n')
    const entry = dependabot.indexOf('  - package-ecosystem: github-actions')
    expect(entry).toBeGreaterThan(-1)
    // The entry's own list: it ends at the first line that is not a list item, and no other
    // entry starts before it.
    const start = dependabot.indexOf('    directories:', entry)
    expect(start).toBeGreaterThan(entry)
    expect(dependabot.slice(entry + 1, start).filter((line) => line.startsWith('  - '))).toEqual([])
    const rest = dependabot.slice(start + 1)
    const end = rest.findIndex((line) => !line.startsWith('      - '))
    const directories = rest
      .slice(0, end === -1 ? rest.length : end)
      .map((line) => line.slice('      - '.length))
    // `/` covers .github/workflows only, so a composite action that is not listed keeps stale pins.
    const actions = readdirSync('.github/actions', { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => `/.github/actions/${item.name}`)
    expect(actions.length).toBeGreaterThan(0)
    expect(directories.sort()).toEqual(['/', ...actions].sort())
  })

  it('locks every explicit npm import and deno-types reference in Edge and shared source', () => {
    const lock = JSON.parse(readFileSync('supabase/functions/deno.lock', 'utf8')) as {
      specifiers: Record<string, string>
      npm: Record<string, { integrity: string }>
    }
    const specifiers = new Set(
      [
        'supabase/functions',
        'packages/content-contracts/src',
        'packages/backend-contracts/src',
      ].flatMap((directory) =>
        readdirSync(directory, { recursive: true })
          .map(String)
          .filter((file) => file.endsWith('.ts'))
          .flatMap((file) =>
            Array.from(
              readFileSync(`${directory}/${file}`, 'utf8').matchAll(/["'`](npm:[^"'`\s]+)["'`]/g),
              (match) => match[1] as string,
            ),
          ),
      ),
    )
    expect(specifiers.size).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      const version = lock.specifiers[specifier]
      expect(version, specifier).toBeDefined()
      const name = specifier.slice('npm:'.length).replace(/@[^@]+$/, '')
      expect(lock.npm[`${name}@${version}`]?.integrity, specifier).toMatch(/^sha512-/)
    }
  })

  it('pins every GitHub Action to an immutable commit SHA', () => {
    const actionRefs = workflows.flatMap((source) =>
      Array.from(source.matchAll(/\buses:\s*([^\s#]+)/g), (match) => {
        const actionRef = match[1]
        if (actionRef === undefined) throw new Error('Expected `uses:` to capture an action ref')
        return actionRef
      }),
    )
    expect(actionRefs.length).toBeGreaterThan(0)
    for (const actionRef of actionRefs) {
      if (actionRef.startsWith('./.github/actions/')) {
        expect(existsSync(`${actionRef}/action.yml`)).toBe(true)
        continue
      }
      expect(actionRef).toMatch(/@[0-9a-f]{40}$/)
    }
  })

  it('pins the test runner and browser library to the same exact release', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly devDependencies: Readonly<Record<string, string>>
    }
    const version = packageJson.devDependencies['playwright']
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.devDependencies['@playwright/test']).toBe(version)
  })

  it('pins local Supabase CLI resolution to an exact release', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly devDependencies?: Readonly<Record<string, string>>
    }
    expect(packageJson.devDependencies?.['supabase']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
