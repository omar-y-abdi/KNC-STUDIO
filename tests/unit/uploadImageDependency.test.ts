import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('upload image runtime dependency', () => {
  it('keeps ImageMagick in production dependencies at the exact Edge Function version', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly dependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }
    const edgeSource = readFileSync('supabase/functions/upload-image/index.ts', 'utf8')

    expect(packageJson.dependencies?.['@imagemagick/magick-wasm']).toBe('0.0.42')
    expect(packageJson.devDependencies?.['@imagemagick/magick-wasm']).toBeUndefined()
    expect(edgeSource).toContain('npm:@imagemagick/magick-wasm@0.0.42')
  })
  it('copies ImageMagick output before the WASM callback buffer is released', () => {
    const edgeSource = readFileSync('supabase/functions/upload-image/index.ts', 'utf8')

    expect(edgeSource).toContain('encoded.value = new Uint8Array(data)')
    expect(edgeSource).not.toContain('encoded.value = data')
  })

  it('initializes ImageMagick only after CORS, method, and JSON deletion paths', () => {
    const edgeSource = readFileSync('supabase/functions/upload-image/index.ts', 'utf8')
    const handlerStart = edgeSource.indexOf('Deno.serve(async (req: Request)')
    const corsBranch = edgeSource.indexOf("if (req.method === 'OPTIONS')", handlerStart)
    const methodBranch = edgeSource.indexOf("if (req.method !== 'POST')", handlerStart)
    const deleteBranch = edgeSource.indexOf(
      "if (contentType.startsWith('application/json'))",
      handlerStart,
    )
    const multipartBranch = edgeSource.indexOf(
      "if (!contentType.startsWith('multipart/form-data'))",
      handlerStart,
    )
    const initialization = edgeSource.indexOf('await ensureImageMagickReady()', handlerStart)

    expect(handlerStart).toBeGreaterThan(-1)
    expect(corsBranch).toBeGreaterThan(handlerStart)
    expect(methodBranch).toBeGreaterThan(corsBranch)
    expect(deleteBranch).toBeGreaterThan(methodBranch)
    expect(multipartBranch).toBeGreaterThan(deleteBranch)
    expect(initialization).toBeGreaterThan(multipartBranch)
  })
})
