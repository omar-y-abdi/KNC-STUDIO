import { ImageMagick, MagickColors, MagickFormat, MagickReadSettings } from '@imagemagick/magick-wasm'

// Diagnostic only. Compare decoder-native downsampling on the same fixtures,
// output dimensions and unchanged CPU gate, without changing production code.
const read = ImageMagick.read.bind(ImageMagick)
ImageMagick.read = (input, callback) => read(MagickColors.Transparent, 1, 1, image => {
  image.ping(input)
  const settings = new MagickReadSettings()
  if (image.format === MagickFormat.Jpeg) {
    settings.setDefine(MagickFormat.Jpeg, 'size', '1600x1600')
  }
  image.read(input, settings)
  return callback(image)
})
await import('./upload-budget.mjs')
