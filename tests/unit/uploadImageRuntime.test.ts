import { readFileSync } from 'node:fs'
import {
  Gravity,
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  initializeImageMagick,
} from '@imagemagick/magick-wasm'
import { beforeAll, describe, expect, it } from 'vitest'

const JPEG_FIXTURE = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCABQAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5f07SOny10mnaP0+Wt7TtH6fLXSadpHT5aKVUMkzvbUwtO0jp8tdJp2kdPkre07R+ny10mnaR0+WvRpVT9eyTO9tTlNO0jp8tdJp2j9Plre07SOnyV0mnaR0+WvnaVU/kPJM721MLTtI6fLXSado/T5a3tO0fp8tdJp2kdPlr0aVU/XskzvbU/9k=',
    'base64',
  ),
)
describe('upload-image JPEG runtime', () => {
  beforeAll(async () => {
    const wasm = new Uint8Array(readFileSync('supabase/functions/upload-image/magick.wasm'))
    await initializeImageMagick(wasm)
  })

  it('decodes JPEG and preserves copied WebP bytes after the write callback returns', () => {
    const encoded: { value?: Uint8Array } = {}

    ImageMagick.read(JPEG_FIXTURE, (image) => {
      expect(String(image.format).toUpperCase()).toBe('JPEG')
      expect([image.width, image.height]).toEqual([120, 80])
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
    expect(decodedSize).toEqual([120, 80])
  })
  it('keeps the barber-profile resize/crop output decodable', () => {
    const encoded: { value?: Uint8Array } = {}

    ImageMagick.read(JPEG_FIXTURE, (image) => {
      const scale = Math.max(800 / image.width, 800 / image.height)
      image.resize(
        new MagickGeometry(
          Math.max(800, Math.round(image.width * scale)),
          Math.max(800, Math.round(image.height * scale)),
        ),
      )
      image.crop(new MagickGeometry(800, 800), Gravity.Center)
      image.write(MagickFormat.WebP, (data) => {
        encoded.value = new Uint8Array(data)
      })
    })

    if (encoded.value === undefined) throw new Error('ImageMagick did not encode profile WebP')
    let decodedSize: readonly [number, number] | undefined
    ImageMagick.read(encoded.value, (image) => {
      decodedSize = [image.width, image.height]
    })
    expect(decodedSize).toEqual([800, 800])
  })

})