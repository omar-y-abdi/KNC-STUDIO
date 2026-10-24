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
    expect(edge).toContain(
      'deno check --config deno.json --frozen --node-modules-dir=manual "$file"',
    )
    expect(edge).toContain('find . -mindepth 2 -maxdepth 2 -name index.ts')
  })

  it('scopes the Deno lock to pinned function imports and required Node types', () => {
    const config = JSON.parse(readFileSync('supabase/functions/deno.json', 'utf8')) as {
      imports: Record<string, string>
      lock: string
    }
    const lock = JSON.parse(readFileSync('supabase/functions/deno.lock', 'utf8')) as {
      workspace: { dependencies: string[]; packageJson?: { dependencies: string[] } }
    }
    // Manual type-reference resolution reads this manifest for fontkit's Node declarations.
    const types = JSON.parse(readFileSync('supabase/functions/package.json', 'utf8')) as {
      private: boolean
      type: string
      devDependencies: Record<string, string>
    }
    expect(types.private).toBe(true)
    expect(types.type).toBe('module')
    expect(types.devDependencies).toEqual({ '@types/node': '24.13.2' })
    expect(config.lock).toBe('./deno.lock')
    expect(lock.workspace.packageJson?.dependencies).toEqual(['npm:@types/node@24.13.2'])
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
