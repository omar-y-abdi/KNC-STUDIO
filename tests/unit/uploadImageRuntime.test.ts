import { readFileSync } from 'node:fs'
import {
  ImageMagick,
  MagickFormat,
  initializeImageMagick,
} from '@imagemagick/magick-wasm'
import { beforeAll, describe, expect, it } from 'vitest'

const JPEG_FIXTURE = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7r/Zv8B+GtS/Z4+F13d+HdJuru48LaXLNPPYxPJI7WkRZmYrkkkkknrmiiivx3H/73W/xS/Nn4Fmf+/V/8cvzZ//Z', 'base64'))

describe('upload-image JPEG runtime', () => {
  beforeAll(async () => {
    const wasm = new Uint8Array(readFileSync('supabase/functions/upload-image/magick.wasm'))
    await initializeImageMagick(wasm)
  })

  it('decodes JPEG and preserves copied WebP bytes after the write callback returns', () => {
    const encoded: { value?: Uint8Array } = {}

    ImageMagick.read(JPEG_FIXTURE, (image) => {
      expect(String(image.format).toUpperCase()).toBe('JPEG')
      expect([image.width, image.height]).toEqual([2, 2])
      image.write(MagickFormat.WebP, (data) => {
        encoded.value = new Uint8Array(data)
      })
    })

    if (encoded.value === undefined) throw new Error('ImageMagick did not encode WebP')
    expect(Buffer.from(encoded.value.subarray(0, 4)).toString('ascii')).toBe('RIFF')
    expect(Buffer.from(encoded.value.subarray(8, 12)).toString('ascii')).toBe('WEBP')

    let decodedSize: readonly [number, number] | undefined
    ImageMagick.read(encoded.value, (image) => {
      decodedSize = [image.width, image.height]
    })
    expect(decodedSize).toEqual([2, 2])
  })
})
