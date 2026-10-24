import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const created: string[] = []

/** A build output: `index.html` plus assets of the given sizes, random so gzip cannot shrink them. */
function build(html: string, assets: Readonly<Record<string, number>>): string {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-budget-'))
  created.push(dist)
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), html)
  for (const [name, bytes] of Object.entries(assets))
    writeFileSync(join(dist, 'assets', name), randomBytes(bytes))
  return dist
}

/** Runs the tool; without `limitKb` it uses its built-in budget. */
function budget(dist: string, limitKb?: number) {
  const args = limitKb === undefined ? [dist] : [dist, String(limitKb)]
  const run = spawnSync(process.execPath, ['tools/bundle-budget.mjs', ...args], {
    encoding: 'utf8',
  })
  return { code: run.status, out: run.stdout, err: run.stderr }
}

const entry = '<script type="module" crossorigin src="/assets/entry.js"></script>'
const preload = (name: string) => `<link rel="modulepreload" crossorigin href="/assets/${name}">`

afterEach(() => {
  for (const dist of created.splice(0)) rmSync(dist, { recursive: true, force: true })
})

describe('public boot budget', () => {
  it('adds up the entry script and its preloaded chunks, and passes within the budget', () => {
    const dist = build(`${entry}${preload('a.js')}`, { 'entry.js': 3000, 'a.js': 2000 })
    const result = budget(dist, 10)
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/public boot JS: 5\.\d kB gzip in 2 files \(budget 10 kB\)/)
  })

  it('fails when the boot JavaScript grows past the budget', () => {
    const dist = build(`${entry}${preload('a.js')}`, { 'entry.js': 3000, 'a.js': 2000 })
    const result = budget(dist, 4)
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/over budget/)
  })

  it('counts neither stylesheets, nor lazy chunks, nor scripts of another origin', () => {
    const html = [
      entry,
      '<script type="module" src="https://example.com/remote.js"></script>',
      '<link rel="stylesheet" href="/assets/style.css">',
    ].join('')
    const dist = build(html, { 'entry.js': 1000, 'style.css': 9000, 'lazy.js': 9000 })
    const result = budget(dist, 2)
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/in 1 files/)
  })

  it('fails when index.html has no entry script', () => {
    const result = budget(build(preload('a.js'), { 'a.js': 100 }), 10)
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/no entry script/)
  })

  it('fails when a referenced chunk is missing from the build', () => {
    const result = budget(build(`${entry}${preload('gone.js')}`, { 'entry.js': 100 }), 10)
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/gone\.js is referenced by index\.html but missing/)
  })

  it('allows 114 kB against the default budget of 115 kB', () => {
    const result = budget(build(entry, { 'entry.js': 114_000 }))
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/public boot JS: 114\.\d kB gzip in 1 files \(budget 115 kB\)/)
  })

  it('fails 116 kB against the default budget of 115 kB', () => {
    const result = budget(build(entry, { 'entry.js': 116_000 }))
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/over budget/)
  })
})
