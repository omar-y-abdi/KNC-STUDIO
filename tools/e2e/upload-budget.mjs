/* global document */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { ImageMagick, initializeImageMagick } from '@imagemagick/magick-wasm'
import { processImage } from '../../supabase/functions/upload-image/processImage.ts'

const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/upload-budget'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
let samples
try {
  const page = await browser.newPage()
  samples = await page.evaluate(() => {
    const result = {}
    for (const [name, width, height] of [
      ['camera', 4032, 3024],
      ['noise', 3000, 3000],
    ]) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      const pixels = context.createImageData(width, height)
      let seed = 7
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          pixels.data[i] =
            name === 'noise' ? seed & 255 : (x / 20 + y / 30 + (seed >>> 24) / 5) % 256
          pixels.data[i + 1] =
            name === 'noise' ? (seed >>> 8) & 255 : (y / 16 + (seed >>> 24) / 5) % 256
          pixels.data[i + 2] =
            name === 'noise' ? (seed >>> 16) & 255 : (x / 16 + (seed >>> 24) / 5) % 256
          pixels.data[i + 3] = 255
        }
      context.putImageData(pixels, 0, 0)
      result[name] = canvas.toDataURL('image/jpeg', name === 'noise' ? 0.5 : 0.82).split(',')[1]
    }
    return result
  })
} finally {
  await browser.close()
}
await initializeImageMagick(
  new Uint8Array(await readFile('supabase/functions/upload-image/magick.wasm')),
)
const results = []
for (const [name, encoded] of Object.entries(samples)) {
  const input = Buffer.from(encoded, 'base64')
  assert.ok(input.length <= 5 * 1024 * 1024, 'fixture exercises a supported input size')
  const cpu = process.cpuUsage()
  const started = performance.now()
  const result = { name, inputBytes: input.length }
  try {
    const image = processImage(input, 'gallery')
    result.bytes = image.bytes.length
    result.width = image.width
    result.height = image.height
    assert.ok(image.bytes.length <= 512000)
    ImageMagick.read(image.bytes, (decoded) => {
      assert.equal(decoded.width, image.width)
      assert.equal(decoded.height, image.height)
    })
    await writeFile(`${out}/${name}.webp`, image.bytes)
  } catch (error) {
    result.error = error.message
    if (error.code !== 'output_too_large') throw error
  }
  const used = process.cpuUsage(cpu)
  result.cpuMs = (used.user + used.system) / 1000
  result.wallMs = performance.now() - started
  results.push(result)
}
await writeFile(`${out}/image-budget.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
assert.ok(
  !results.find((result) => result.name === 'camera').error,
  'ordinary camera photo must upload',
)
assert.ok(
  results.every((result) => result.cpuMs < 1800),
  'processing must leave headroom below the Edge CPU limit, including rejected images',
)
