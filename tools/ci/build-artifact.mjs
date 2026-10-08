import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const digest = (value) => createHash('sha256').update(value).digest('hex')
export function sourceIdentity() {
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    patch: digest(execFileSync('git', ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-color'])),
  }
}

async function files(root, relative = '') {
  const hashes = {}
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (name === 'artifact.json') continue
    if (entry.isDirectory()) Object.assign(hashes, await files(root, name))
    else {
      assert.ok(entry.isFile(), `Unexpected artifact entry: ${name}`)
      hashes[name] = digest(await readFile(join(root, name)))
    }
  }
  return hashes
}

export async function recordArtifact(root) {
  const hashes = await files(root)
  assert.ok(Object.keys(hashes).length > 0, 'Empty build artifact')
  await writeFile(
    join(root, 'artifact.json'),
    JSON.stringify({ source: sourceIdentity(), files: hashes }, null, 2) + '\n',
  )
}

export async function verifyArtifact(root) {
  const manifest = JSON.parse(await readFile(join(root, 'artifact.json'), 'utf8'))
  assert.deepEqual(manifest.source, sourceIdentity(), 'Build belongs to a different source tree')
  const actual = await files(root)
  assert.ok(Object.keys(actual).length > 0, 'Empty build artifact')
  assert.deepEqual(actual, manifest.files, 'Missing, extra or corrupted build files')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, root] = process.argv.slice(2)
  assert.ok(root, 'Artifact directory required')
  if (command === 'record') await recordArtifact(root)
  else if (command === 'verify') await verifyArtifact(root)
  else if (command === 'source')
    await writeFile(join(root, 'source.json'), JSON.stringify(sourceIdentity()))
  else if (command === 'verify-source')
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'source.json'), 'utf8')),
      sourceIdentity(),
      'Formatted source mismatch',
    )
  else throw new Error(`Unknown artifact command: ${command}`)
}
