import { describe, expect, it, vi } from 'vitest'
import { copyCmsAsset } from '../../supabase/functions/cms-studio/copyAsset'

const asset = {
  id: '22222222-2222-4222-8222-222222222222',
  bucket: 'cms-library',
  path: 'images/original.webp',
  name: 'Photo',
  alt: 'Original alt',
  mime: 'image/webp',
  width: 600,
  height: 400,
  bytes: 1200,
  archived: false,
  trashed_at: null,
  deleting_at: null,
  version: 1,
}
function fixture(source = asset) {
  const rows: Record<string, unknown>[] = [{ ...source }]
  const copy = vi.fn(
    async (_path: string, target: string, options: { destinationBucket: string }) => {
      rows.push({
        ...source,
        id: '33333333-3333-4333-8333-333333333333',
        bucket: options.destinationBucket,
        path: target,
        version: 0,
      })
      return { data: { path: target }, error: null }
    },
  )
  const service = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let patch: Record<string, unknown> | undefined
      let columns = '*'
      const project = (row: Record<string, unknown> | undefined | null) =>
        row && columns !== '*'
          ? Object.fromEntries(columns.split(',').map((key) => [key, row[key]]))
          : (row ?? null)
      const query = {
        select: (value: string) => {
          columns = value
          return query
        },
        update: (value: Record<string, unknown>) => {
          patch = value
          return query
        },
        eq: (key: string, value: unknown) => {
          filters[key] = value
          return query
        },
        maybeSingle: async () => ({
          data:
            table === 'barbers'
              ? null
              : project(
                  rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)),
                ),
          error: null,
        }),
        single: async () => {
          const row = rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
          if (row && patch) Object.assign(row, patch)
          return { data: project(row), error: null }
        },
      }
      return query
    },
    storage: { from: () => ({ copy }) },
  }
  return { service: service as unknown as Parameters<typeof copyCmsAsset>[1], copy, rows }
}
const request = { operation: 'asset_copy', id: asset.id, version: 1, purpose: 'cuts' }
describe('owner resource copy', () => {
  it('copies an already-processed immutable object into the destination scope, then reuses it', async () => {
    const { service, copy } = fixture()
    const result = await copyCmsAsset(request, service)
    expect(result).toMatchObject({
      bucket: 'gallery',
      path: `cuts/${asset.id}.webp`,
      mime: 'image/webp',
      alt: asset.alt,
    })
    expect(await copyCmsAsset(request, service)).toEqual(result)
    expect(copy).toHaveBeenCalledTimes(1)
    expect(asset.path).toBe('images/original.webp')
  })
  it.each([
    { ...asset, archived: true },
    { ...asset, version: 2 },
  ])('rejects unavailable/stale source before storage', async (source) => {
    const { service, copy } = fixture(source)
    await expect(copyCmsAsset(request, service)).rejects.toThrow()
    expect(copy).not.toHaveBeenCalled()
  })
  it('rejects path injection and unknown destination persons', async () => {
    const { service, copy } = fixture()
    await expect(
      copyCmsAsset({ ...request, sourceUrl: 'https://external.invalid/x' }, service),
    ).rejects.toThrow()
    await expect(
      copyCmsAsset({ ...request, purpose: 'profile', barberId: 'missing' }, service),
    ).rejects.toThrow()
    expect(copy).not.toHaveBeenCalled()
  })
})

it('refuses an existing destination reserved for deletion', async () => {
  const { service, copy, rows } = fixture()
  rows.push({
    ...asset,
    id: '33333333-3333-4333-8333-333333333333',
    bucket: 'gallery',
    path: `cuts/${asset.id}.webp`,
    deleting_at: '2026-09-25T00:00:00Z',
  })
  await expect(copyCmsAsset(request, service)).rejects.toThrow()
  expect(copy).not.toHaveBeenCalled()
})
it('uses a concurrently completed immutable copy instead of failing a duplicate request', async () => {
  const { service, copy, rows } = fixture()
  copy.mockImplementationOnce(async (_path, target, options) => {
    rows.push({
      ...asset,
      id: '33333333-3333-4333-8333-333333333333',
      bucket: options.destinationBucket,
      path: target,
      version: 0,
    })
    return {
      data: null,
      error: { statusCode: '409', message: 'The resource already exists' },
    } as unknown as Awaited<ReturnType<typeof copy>>
  })
  const result = await copyCmsAsset(request, service)
  expect(result.path).toBe(`cuts/${asset.id}.webp`)
  expect(copy).toHaveBeenCalledTimes(1)
})
it('rejects a source archived while its bytes were being copied', async () => {
  const { service, copy, rows } = fixture()
  copy.mockImplementationOnce(async (_path, target) => {
    const source = rows[0]
    if (!source) throw new Error('Missing fixture source')
    source.archived = true
    return { data: { path: target }, error: null }
  })
  await expect(copyCmsAsset(request, service)).rejects.toThrow()
})
