import { describe, expect, it, vi } from 'vitest'
import { handleCmsUpload } from '../../supabase/functions/upload-image/cmsUpload'
import { ImageValidationError } from '../../supabase/functions/upload-image/processImage'

const request = (): FormData => {
  const form = new globalThis.FormData()
  form.set('kind', 'cms_asset')
  form.set('purpose', 'library')
  form.set('file', new globalThis.File(['image bytes'], 'photo.jpg', { type: 'image/jpeg' }))
  return form
}
const json = (body: unknown, status: number): Response =>
  new globalThis.Response(JSON.stringify(body), { status })

function backend(forbidden = false) {
  const storage = vi.fn(() => {
    throw new Error('Rejected uploads must never reach storage')
  })
  const service = {
    rpc: vi.fn(async () => ({ error: forbidden ? { code: '42501' } : null })),
    storage: { from: storage },
  }
  return { storage, service: service as unknown as Parameters<typeof handleCmsUpload>[2] }
}

describe('CMS upload boundary errors', () => {
  it.each(['output_too_large', 'image_too_large'] as const)(
    'retains the %s diagnosis instead of reporting valid image data as undecodable',
    async (code) => {
      const { service, storage } = backend()
      const decode = vi.fn(async () => {
        throw new ImageValidationError(code)
      })
      const response = await handleCmsUpload(request(), 'owner', service, decode, json)
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ ok: false, error: code })
      expect(storage).not.toHaveBeenCalled()
    },
  )

  it('rejects unauthorized requests before decoding or storage', async () => {
    const { service, storage } = backend(true)
    const decode = vi.fn()
    const response = await handleCmsUpload(request(), 'barber', service, decode, json)
    expect(response.status).toBe(403)
    expect(decode).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
  })
})
