import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CI supply-chain pins', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  const workflows = readdirSync('.github/workflows')
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => readFileSync(`.github/workflows/${name}`, 'utf8'))

  it('pins Deno runtime to an exact release', () => {
    expect(workflow).toMatch(/deno-version:\s+v\d+\.\d+\.\d+/)
    expect(workflow).not.toMatch(/deno-version:\s+v?\d+\.x/)
  })

  it('keeps frozen dependency resolution on every Edge Function check', () => {
    expect(workflow).toContain('deno check --frozen --node-modules-dir=manual "$file"')
  })

  it('pins every GitHub Action to an immutable commit SHA', () => {
    const actionRefs = workflows.flatMap((source) =>
      Array.from(source.matchAll(/\buses:\s*([^\s#]+)/g), (match) => match[1]),
    )
    expect(actionRefs.length).toBeGreaterThan(0)
    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(/@[0-9a-f]{40}$/)
    }
  })

  it('pins local Supabase CLI resolution to an exact release', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly devDependencies?: Readonly<Record<string, string>>
    }
    expect(packageJson.devDependencies?.['supabase']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
