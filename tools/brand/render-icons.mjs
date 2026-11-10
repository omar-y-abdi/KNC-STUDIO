// Rasterises public/favicon.svg into the icons the pages and public/site.webmanifest link.
// Usage: node tools/brand/render-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const file = (path) => new URL(`../../public/${path}`, import.meta.url)
const svg = readFileSync(file('favicon.svg'), 'utf8')
// The light theme-color of index.html: the one place that names the surface of an opaque icon.
const SURFACE =
  /<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: light\)"/.exec(
    readFileSync(new URL('../../index.html', import.meta.url), 'utf8'),
  )?.[1]
if (SURFACE === undefined) throw new Error('index.html has no light theme-color')
// `mark`: share of the canvas the SVG's 64-unit box takes. iOS shows the touch icon as an opaque
// rounded tile, so it gets the site surface and a margin; the others stay transparent.
const ICONS = [
  { path: 'favicon.ico', size: 32, mark: 1, background: null },
  { path: 'apple-touch-icon.png', size: 180, mark: 0.8, background: SURFACE },
  { path: 'icons/icon-192.png', size: 192, mark: 1, background: null },
  { path: 'icons/icon-512.png', size: 512, mark: 1, background: null },
]
const ICO_HEADER_BYTES = 22

/** A single-image ICO whose image is the PNG itself: ICONDIR, one ICONDIRENTRY, the PNG bytes. */
function ico(png, size) {
  const header = Buffer.alloc(ICO_HEADER_BYTES)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // number of images
  header.writeUInt8(size, 6) // width
  header.writeUInt8(size, 7) // height
  header.writeUInt16LE(1, 10) // colour planes
  header.writeUInt16LE(32, 12) // bits per pixel
  header.writeUInt32LE(png.length, 14) // bytes of image data
  header.writeUInt32LE(ICO_HEADER_BYTES, 18) // offset of the image data
  return Buffer.concat([header, png])
}

/** Width and height as the IHDR chunk of the PNG starting at `offset` states them. */
const dimensions = (bytes, offset) =>
  `${bytes.readUInt32BE(offset + 16)}x${bytes.readUInt32BE(offset + 20)}`

const browser = await chromium.launch()
try {
  for (const { path, size, mark, background } of ICONS) {
    const ctx = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
      // The favicon's stripes roll unless motion is reduced; the raster is its still frame.
      reducedMotion: 'reduce',
    })
    const page = await ctx.newPage()
    const side = size * mark
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;height:100%;background:${background ?? 'transparent'}}` +
        `body{display:grid;place-items:center}svg{display:block;width:${side}px;height:${side}px}</style>${svg}`,
    )
    const png = await page.screenshot({ omitBackground: background === null })
    const container = path.endsWith('.ico')
    writeFileSync(file(path), container ? ico(png, size) : png)
    await ctx.close()
    const written = readFileSync(file(path))
    console.log(
      `${path}: ${dimensions(written, container ? ICO_HEADER_BYTES : 0)}, ${written.length} bytes`,
    )
  }
} finally {
  await browser.close()
}
