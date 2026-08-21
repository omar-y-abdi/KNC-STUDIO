import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

function command(command: string, args: readonly string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' })
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'backup-contract-'))
  roots.push(root)
  mkdirSync(join(root, 'storage', 'objects'), { recursive: true })
  writeFileSync(join(root, 'schema.sql'), 'CREATE TABLE IF NOT EXISTS "public"."bookings" ();\n')
  writeFileSync(
    join(root, 'data.sql'),
    'COPY "auth"."users" FROM stdin;\nCOPY "storage"."buckets" FROM stdin;\nCOPY "storage"."objects" FROM stdin;\n',
  )
  writeFileSync(
    join(root, 'history_data.sql'),
    'COPY "supabase_migrations"."schema_migrations" FROM stdin;\n',
  )
  writeFileSync(
    join(root, 'storage', 'buckets.json'),
    JSON.stringify([
      { id: 'gallery', type: 'STANDARD' },
      { id: 'barber-photos', type: 'STANDARD' },
    ]),
  )
  const bytes = Buffer.from('stored-image-bytes')
  const objectPath = join(root, 'storage', 'objects', '00000000.bin')
  writeFileSync(objectPath, bytes)
  const sha = command('sha256sum', [objectPath]).split(/\s+/)[0]
  writeFileSync(
    join(root, 'storage', 'objects.ndjson'),
    `${JSON.stringify({
      bucket: 'gallery',
      name: 'salon/image.webp',
      archive_path: 'objects/00000000.bin',
      bytes: bytes.length,
      sha256: sha,
      source_metadata: {},
    })}\n`,
  )
  writeFileSync(
    join(root, 'storage', 'inventory.json'),
    JSON.stringify({
      format: 'bladeblend-storage-backup-v1',
      bucket_count: 2,
      object_count: 1,
      total_bytes: bytes.length,
    }),
  )
  const files = command('find', ['.', '-type', 'f', '-not', '-name', 'MANIFEST.sha256'], root)
    .trim()
    .split('\n')
    .sort()
  const manifest = files.map((file) => command('sha256sum', [file], root)).join('')
  writeFileSync(join(root, 'MANIFEST.sha256'), manifest)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('backup archive contract', () => {
  it('accepts complete database, migration, metadata, and Storage-byte coverage', () => {
    const root = fixture()
    expect(command('bash', ['tools/backup/verify-backup-tree.sh', root], process.cwd())).toContain(
      'Backup verification passed',
    )
  })

  it('fails closed when object bytes change after inventory capture', () => {
    const root = fixture()
    const object = join(root, 'storage', 'objects', '00000000.bin')
    writeFileSync(object, `${readFileSync(object, 'utf8')}tampered`)
    expect(() =>
      command('bash', ['tools/backup/verify-backup-tree.sh', root], process.cwd()),
    ).toThrow()
  })

  it('fails closed when migration history is missing', () => {
    const root = fixture()
    writeFileSync(join(root, 'history_data.sql'), '')
    expect(() =>
      command('bash', ['tools/backup/verify-backup-tree.sh', root], process.cwd()),
    ).toThrow()
  })

  it('fails closed when unmanifested object bytes are present', () => {
    const root = fixture()
    writeFileSync(join(root, 'storage', 'objects', '00000001.bin'), 'unexpected')
    expect(() =>
      command('bash', ['tools/backup/verify-backup-tree.sh', root], process.cwd()),
    ).toThrow()
  })

  it('fails closed when archive tree contains a symbolic link', () => {
    const root = fixture()
    symlinkSync('schema.sql', join(root, 'schema-link.sql'))
    expect(() =>
      command('bash', ['tools/backup/verify-backup-tree.sh', root], process.cwd()),
    ).toThrow()
  })
})
