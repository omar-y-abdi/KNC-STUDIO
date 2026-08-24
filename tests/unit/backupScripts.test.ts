import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

function command(
  command: string,
  args: readonly string[],
  cwd?: string,
  env?: Readonly<NodeJS.ProcessEnv>,
): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: env === undefined ? process.env : { ...process.env, ...env },
  })
}

function refreshManifest(root: string): void {
  const files = command('find', ['.', '-type', 'f', '-not', '-name', 'MANIFEST.sha256'], root)
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort()
  const manifest = files.map((file) => command('sha256sum', [file], root)).join('')
  writeFileSync(join(root, 'MANIFEST.sha256'), manifest)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'backup-contract-'))
  roots.push(root)
  mkdirSync(join(root, 'storage', 'objects'), { recursive: true })
  writeFileSync(join(root, 'schema.sql'), 'CREATE TABLE IF NOT EXISTS "public"."bookings" ();\n')
  writeFileSync(join(root, 'data.sql'), 'COPY "auth"."users" FROM stdin;\n')
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
    join(root, 'storage', 'references.ndjson'),
    `${JSON.stringify({ bucket: 'gallery', name: 'salon/image.webp' })}\n`,
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
  refreshManifest(root)
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

  it('fails closed when SQL data includes Storage metadata', () => {
    const root = fixture()
    writeFileSync(join(root, 'data.sql'), 'COPY "storage"."objects" FROM stdin;\n')
    refreshManifest(root)

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

  it('fails closed when database metadata references uncaptured Storage bytes', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'storage', 'references.ndjson'),
      `${JSON.stringify({ bucket: 'gallery', name: 'salon/missing.webp' })}\n`,
    )
    refreshManifest(root)

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

describe('Storage backup authentication', () => {
  function headers(key: string): readonly string[] {
    return command(
      'bash',
      [
        '-c',
        'source "$1"; storage_configure_auth_headers "$2" || exit 1; printf "%s\\n" "${STORAGE_AUTH_HEADERS[@]}"',
        'storage-auth-test',
        'tools/backup/storage-auth.sh',
        key,
      ],
      process.cwd(),
    )
      .trim()
      .split('\n')
  }

  it('sends current secret keys only through the apikey header', () => {
    expect(headers('sb_secret_example_12345678')).toEqual([
      '--header',
      'apikey: sb_secret_example_12345678',
    ])
  })

  it('keeps bearer authorization only for legacy service-role JWTs', () => {
    expect(headers('eyJheader.eyJpayload.signature')).toEqual([
      '--header',
      'apikey: eyJheader.eyJpayload.signature',
      '--header',
      'Authorization: Bearer eyJheader.eyJpayload.signature',
    ])
  })

  it('rejects unknown secret formats', () => {
    expect(() => headers('not-a-supabase-secret')).toThrow()
  })

  it('refuses redirects before credentials can be forwarded to another origin', () => {
    const root = mkdtempSync(join(tmpdir(), 'backup-redirect-'))
    roots.push(root)
    const headersPath = join(root, 'headers')
    writeFileSync(headersPath, 'HTTP/1.1 302 Found\r\nLocation: https://other.invalid/\r\n')

    expect(() =>
      command(
        'bash',
        [
          '-c',
          'source "$1"; storage_require_no_redirect "$2"',
          'storage-redirect-test',
          'tools/backup/storage-auth.sh',
          headersPath,
        ],
        process.cwd(),
      ),
    ).toThrow()
  })

  it('never enables curl redirect following on authenticated Storage requests', () => {
    for (const path of [
      'tools/backup/storage-backup.sh',
      'tools/backup/storage-restore.sh',
    ] as const) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('--location')
      expect(source).toContain('storage_require_no_redirect')
    }
  })
})

describe('database Storage reference snapshot', () => {
  function fakePsqlRoot(output: string): {
    readonly root: string
    readonly env: NodeJS.ProcessEnv
  } {
    const root = mkdtempSync(join(tmpdir(), 'backup-reference-'))
    roots.push(root)
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const psql = join(bin, 'psql')
    writeFileSync(psql, '#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_PSQL_OUTPUT"\n')
    chmodSync(psql, 0o755)
    return {
      root,
      env: {
        DATABASE_URL: 'postgresql://backup.invalid/database',
        FAKE_PSQL_OUTPUT: output,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
      },
    }
  }

  it('captures a deterministic database reference set', () => {
    const fixture = fakePsqlRoot(
      [
        JSON.stringify({ bucket: 'gallery', name: 'salon/b.webp' }),
        JSON.stringify({ bucket: 'barber-photos', name: 'ada/a.webp' }),
        JSON.stringify({ bucket: 'gallery', name: 'logo/current.webp' }),
      ].join('\n'),
    )
    const output = join(fixture.root, 'references.ndjson')

    command(
      'bash',
      ['tools/backup/capture-storage-references.sh', '--output', output],
      process.cwd(),
      fixture.env,
    )

    expect(readFileSync(output, 'utf8').trim().split('\n')).toEqual([
      JSON.stringify({ bucket: 'barber-photos', name: 'ada/a.webp' }),
      JSON.stringify({ bucket: 'gallery', name: 'logo/current.webp' }),
      JSON.stringify({ bucket: 'gallery', name: 'salon/b.webp' }),
    ])
  })

  it('treats only a validated active homepage logo setting as a gallery reference', () => {
    const source = readFileSync('tools/backup/capture-storage-references.sh', 'utf8')
    expect(source).toContain("where s.key = 'homepage_logo_path'")
    expect(source).toContain("select 'gallery'::text as bucket, s.value as storage_path")
    expect(source).toContain("s.value ~ '^logo/")
  })

  it('fails closed on malformed database reference output', () => {
    const fixture = fakePsqlRoot(JSON.stringify({ bucket: 'private', name: 'secret.bin' }))
    expect(() =>
      command(
        'bash',
        [
          'tools/backup/capture-storage-references.sh',
          '--output',
          join(fixture.root, 'references.ndjson'),
        ],
        process.cwd(),
        fixture.env,
      ),
    ).toThrow()
  })
})

describe('migration history restore contract', () => {
  it('bootstraps a brand-new target before loading history data', () => {
    const sql = readFileSync('tools/backup/prepare-migration-history.sql', 'utf8')

    expect(sql).toContain('create schema if not exists supabase_migrations authorization postgres;')
    expect(sql).toContain('create table if not exists supabase_migrations.schema_migrations')
    expect(sql).toContain('version text primary key')
    expect(sql).toContain('statements text[]')
    expect(sql).toContain('create table if not exists supabase_migrations.seed_files')
    expect(sql).toContain('path text primary key')
    expect(sql).toContain('truncate table')
  })
})
