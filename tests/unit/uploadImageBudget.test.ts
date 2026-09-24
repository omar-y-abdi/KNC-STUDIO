import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ImageValidationError,
  processImage,
} from '../../supabase/functions/upload-image/processImage'

const state = vi.hoisted(() => ({ image: null as unknown, calls: [] as string[] }))
vi.mock('@imagemagick/magick-wasm', () => ({
  Gravity: { Center: 'Center' },
  MagickFormat: { WebP: 'WEBP', Jpeg: 'JPEG' },
  MagickColors: { Transparent: 'transparent' },
  MagickReadSettings: class {
    setDefine = vi.fn()
  },
  MagickGeometry: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  ImageMagick: {
    read: (...args: unknown[]) => (args.at(-1) as (image: unknown) => void)(state.image),
  },
}))

function image(width = 3000, height = 3000, outputSize = 512001) {
  return {
    width,
    height,
    format: 'JPEG',
    quality: 0,
    autoOrient: vi.fn(),
    strip: vi.fn(),
    ping: vi.fn(),
    read: vi.fn(),
    settings: { setDefine: vi.fn() },
    resize(size: { width: number; height: number }) {
      state.calls.push(`resize:${size.width}x${size.height}`)
      this.width = size.width
      this.height = size.height
    },
    crop(size: { width: number; height: number }) {
      state.calls.push(`crop:${size.width}x${size.height}`)
      this.width = size.width
      this.height = size.height
    },
    write: vi.fn((_: unknown, receive: (bytes: Uint8Array) => void) => {
      const temporary = new Uint8Array(outputSize).fill(7)
      receive(temporary)
      // The codec owns the buffer and is free to overwrite it after the callback.
      temporary.fill(0)
    }),
  }
}

beforeEach(() => {
  state.calls = []
  vi.clearAllMocks()
})

describe('bounded server-side image processing', () => {
  it('stops expensive encoding after at most two attempts while retaining the output size cap', () => {
    const source = image()
    state.image = source
    expect(() => processImage(new Uint8Array([1]), 'gallery')).toThrow(ImageValidationError)
    expect(source.write.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('crops narrow portraits before enlarging them instead of allocating a huge intermediate image', () => {
    const source = image(3000, 20, 100)
    state.image = source
    const result = processImage(new Uint8Array([1]), 'barber_photo')
    expect(state.calls).toEqual(['crop:20x20', 'resize:800x800'])
    expect([result.width, result.height]).toEqual([800, 800])
  })

  it('copies output before the codec reuses its callback memory', () => {
    state.image = image(120, 80, 100)
    const result = processImage(new Uint8Array([1]), 'gallery')
    expect(result.bytes).toEqual(new Uint8Array(100).fill(7))
    expect([result.width, result.height]).toEqual([120, 80])
  })

  it('rejects unsupported or excessive decoded images before resizing or encoding', () => {
    for (const source of [image(6000, 6000), { ...image(), format: 'SVG' }]) {
      state.image = source
      expect(() => processImage(new Uint8Array([1]), 'gallery')).toThrow(ImageValidationError)
      expect(source.write).not.toHaveBeenCalled()
      expect(state.calls).toEqual([])
    }
  })
  it('checks original image dimensions before decoding the pixel buffer', () => {
    const source = image(6000, 6000)
    state.image = source
    expect(() => processImage(new Uint8Array([1]), 'gallery')).toThrow(ImageValidationError)
    expect(source.ping).toHaveBeenCalledOnce()
    expect(source.read).not.toHaveBeenCalled()
    expect(source.autoOrient).not.toHaveBeenCalled()
  })

  it('gives the JPEG decoder a size based on the required crop resolution', () => {
    const source = image(4000, 2000, 100)
    state.image = source
    processImage(new Uint8Array([1]), 'barber_photo')
    expect(source.read).toHaveBeenCalledOnce()
    const settings = source.read.mock.calls[0]?.[1] as { setDefine: ReturnType<typeof vi.fn> }
    expect(settings.setDefine).toHaveBeenCalledWith('JPEG', 'size', '1600x800')
  })
})
