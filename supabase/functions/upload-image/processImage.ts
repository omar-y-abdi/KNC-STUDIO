import {
  Gravity,
  ImageMagick,
  MagickColors,
  MagickFormat,
  MagickGeometry,
  MagickReadSettings,
} from '@imagemagick/magick-wasm'

const MAX_OUTPUT_BYTES = 512000
const MAX_PIXELS = 25_000_000
const GALLERY_LONG_SIDE = 1600
const PROFILE_SIZE = 800
const INITIAL_WEBP_QUALITY = 82
const MIN_WEBP_QUALITY = 55
const SUPPORTED_FORMATS = new Set(['JPEG', 'PNG', 'WEBP', 'AVIF', 'HEIC', 'HEIF'])

type ProcessedImage = {
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

export class ImageValidationError extends Error {
  readonly code: 'unsupported_image' | 'image_too_large' | 'output_too_large'

  constructor(code: 'unsupported_image' | 'image_too_large' | 'output_too_large') {
    super(code)
    this.code = code
  }
}

function imageDimensions(image: { readonly width: number; readonly height: number }): {
  readonly width: number
  readonly height: number
} {
  const width = image.width
  const height = image.height

  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ImageValidationError('unsupported_image')
  }

  if (width * height > MAX_PIXELS) {
    throw new ImageValidationError('image_too_large')
  }

  return { width, height }
}

function encodeWebp(image: {
  settings: { setDefine(format: MagickFormat, name: string, value: string): void }
  quality: number
  write(format: MagickFormat, callback: (data: Uint8Array) => void): void
}): Uint8Array {
  // Edge has a CPU budget, not just a request timeout. Bound both the codec's
  // effort and our retry count; a size rejection must still return normally.
  image.settings.setDefine(MagickFormat.WebP, 'method', '0')
  for (const quality of [INITIAL_WEBP_QUALITY, MIN_WEBP_QUALITY]) {
    image.quality = quality

    const encoded: { value?: Uint8Array } = {}

    image.write(MagickFormat.WebP, (data) => {
      encoded.value = new Uint8Array(data)
    })

    if (encoded.value !== undefined && encoded.value.byteLength <= MAX_OUTPUT_BYTES) {
      return encoded.value
    }
  }

  throw new ImageValidationError('output_too_large')
}

export function processImage(
  input: Uint8Array,
  kind: 'gallery' | 'barber_photo' | 'site_logo',
): ProcessedImage {
  let output: ProcessedImage | null = null

  ImageMagick.read(MagickColors.Transparent, 1, 1, (image) => {
    // Inspect the original header before allocating pixels, including images
    // which a decoder size hint would otherwise bring below the input limit.
    image.ping(input)
    const original = imageDimensions(image)
    if (!SUPPORTED_FORMATS.has(String(image.format).toUpperCase())) {
      throw new ImageValidationError('unsupported_image')
    }

    const settings = new MagickReadSettings()
    if (image.format === MagickFormat.Jpeg) {
      // Let libjpeg discard unneeded DCT samples instead of decoding a full
      // camera image and only then shrinking it. Preserve enough resolution
      // for the central square when producing a barber portrait.
      const scale = Math.min(
        1,
        kind === 'barber_photo'
          ? PROFILE_SIZE / Math.min(original.width, original.height)
          : GALLERY_LONG_SIDE / Math.max(original.width, original.height),
      )
      settings.setDefine(
        MagickFormat.Jpeg,
        'size',
        `${Math.ceil(original.width * scale)}x${Math.ceil(original.height * scale)}`,
      )
    }
    image.read(input, settings)
    image.autoOrient()
    const { width, height } = imageDimensions(image)

    if (kind === 'gallery' || kind === 'site_logo') {
      const longSide = Math.max(width, height)

      if (longSide > GALLERY_LONG_SIDE) {
        const scale = GALLERY_LONG_SIDE / longSide

        image.resize(
          new MagickGeometry(
            Math.max(1, Math.round(width * scale)),
            Math.max(1, Math.round(height * scale)),
          ),
        )
      }
    } else {
      // Crop before enlarging. A very wide or narrow input must never allocate
      // a full-sized intermediate panorama merely to discard most of it.
      const side = Math.min(width, height)
      image.crop(new MagickGeometry(side, side), Gravity.Center)
      image.resize(new MagickGeometry(PROFILE_SIZE, PROFILE_SIZE))
    }

    image.strip()

    const processedWidth = image.width
    const processedHeight = image.height
    const bytes = encodeWebp(image)

    output = {
      bytes,
      width: processedWidth,
      height: processedHeight,
    }
  })

  if (output === null) {
    throw new ImageValidationError('unsupported_image')
  }

  return output
}
