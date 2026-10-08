import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { recordArtifact, verifyArtifact, sourceIdentity } from './build-artifact.mjs'

test('protected gate executable rejects absent, skipped, failed and cancelled dependencies', () => {
  const script = resolve('tools/ci/check-gate.mjs')
  const run = (needs) =>
    spawnSync(process.execPath, [script, 'format', 'cms'], {
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
      encoding: 'utf8',
    })
  assert.equal(run({ format: { result: 'success' }, cms: { result: 'success' } }).status, 0)
  for (const result of ['failure', 'skipped', 'cancelled', 'neutral', undefined])
    assert.notEqual(run({ format: { result: 'success' }, cms: { result } }).status, 0)
  assert.notEqual(run({ format: { result: 'success' } }).status, 0)
  assert.notEqual(
    run({
      format: { result: 'success' },
      cms: { result: 'success' },
      surprise: { result: 'success' },
    }).status,
    0,
  )
})

test('shared build verification rejects corrupt, missing, extra and stale-source artifacts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knc-build-artifact-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'assets'))
  const path = join(root, 'assets', 'app.js')
  const content = 'console.log("fixture")'
  await writeFile(path, content)
  await recordArtifact(root)
  await verifyArtifact(root)
  await writeFile(path, 'corrupt')
  await assert.rejects(verifyArtifact(root), /corrupted/)
  await rm(path)
  await assert.rejects(verifyArtifact(root), /Empty|Missing/)
  await writeFile(path, content)
  await writeFile(join(root, 'extra.js'), 'extra')
  await assert.rejects(verifyArtifact(root), /extra/)
  await rm(join(root, 'extra.js'))
  const manifest = JSON.parse(await readFile(join(root, 'artifact.json'), 'utf8'))
  assert.deepEqual(manifest.source, sourceIdentity())
  manifest.source.commit = '0'.repeat(40)
  await writeFile(join(root, 'artifact.json'), JSON.stringify(manifest))
  await assert.rejects(verifyArtifact(root), /different source/)
})
